import {
  NodeOAuthClient,
  NodeSavedState,
  NodeSavedSession,
} from '@atproto/oauth-client-node';
import { JoseKey } from '@atproto/jwk-jose';
import { generateKeyPairSync, webcrypto } from 'crypto';

const getBaseUrl = () => {
  if (process.env.APPVIEW_DID) {
    const appviewDid = process.env.APPVIEW_DID;
    return appviewDid.startsWith('did:web:')
      ? `https://${appviewDid.replace('did:web:', '')}`
      : appviewDid;
  }

  if (process.env.REPLIT_DOMAINS) {
    const domain = process.env.REPLIT_DOMAINS.split(',')[0];
    return `https://${domain}`;
  }

  return 'http://127.0.0.1:5000';
};

const BASE_URL = getBaseUrl();
const CLIENT_ID = `${BASE_URL}/client-metadata.json`;
const CALLBACK_URL = `${BASE_URL}/api/auth/callback`;

class DatabaseStateStore {
  private readonly STATE_TTL = 10 * 60 * 1000;

  constructor() {
    setInterval(() => this.cleanup(), 60000);
  }

  private async cleanup() {
    const { storage } = await import('../storage');
    await storage.deleteExpiredOAuthStates();
  }

  async set(key: string, state: NodeSavedState): Promise<void> {
    const { storage } = await import('../storage');
    const expiresAt = new Date(Date.now() + this.STATE_TTL);
    await storage.saveOAuthState(key, state, expiresAt);
  }

  async get(key: string): Promise<NodeSavedState | undefined> {
    const { storage } = await import('../storage');
    return await storage.getOAuthState(key);
  }

  async del(key: string): Promise<void> {
    const { storage } = await import('../storage');
    await storage.deleteOAuthState(key);
  }
}

class DatabaseSessionStore {
  private locks = new Map<string, Promise<void>>();

  async lock<T>(key: string, fn: () => T | PromiseLike<T>): Promise<T> {
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(key, lockPromise);

    try {
      return await fn();
    } finally {
      this.locks.delete(key);
      releaseLock!();
    }
  }

  async set(sub: string, session: NodeSavedSession): Promise<void> {
    return this.lock(sub, async () => {
      const { storage } = await import('../storage');
      const { encryptionService } = await import('./encryption');

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const existingUser = await storage.getUser(sub);
      if (!existingUser) {
        await storage.createUser({
          did: sub,
          handle: sub,
        });
        console.log(`[OAUTH] Created user record for ${sub}`);
      }

      const existingSession = await storage.getSession(sub);

      if (existingSession) {
        await storage.updateSession(sub, {
          accessToken: await encryptionService.encrypt(JSON.stringify(session)),
          refreshToken: session.tokenSet.refresh_token
            ? await encryptionService.encrypt(session.tokenSet.refresh_token)
            : '',
          expiresAt,
        });
      } else {
        await storage.createSession({
          id: sub,
          userDid: sub,
          accessToken: await encryptionService.encrypt(JSON.stringify(session)),
          refreshToken: session.tokenSet.refresh_token
            ? await encryptionService.encrypt(session.tokenSet.refresh_token)
            : '',
          pdsEndpoint: session.tokenSet.iss || '',
          expiresAt,
        });
      }
    });
  }

  async get(sub: string): Promise<NodeSavedSession | undefined> {
    return this.lock(sub, async () => {
      const { storage } = await import('../storage');
      const { encryptionService } = await import('./encryption');

      const dbSession = await storage.getSession(sub);
      if (!dbSession) return undefined;

      try {
        const savedSession = JSON.parse(
          await encryptionService.decrypt(dbSession.accessToken)
        );
        return savedSession as NodeSavedSession;
      } catch (error) {
        console.error('[OAUTH] Failed to decrypt session:', error);
        return undefined;
      }
    });
  }

  async del(sub: string): Promise<void> {
    return this.lock(sub, async () => {
      const { storage } = await import('../storage');
      await storage.deleteSession(sub);
    });
  }
}

export class OAuthService {
  private client: NodeOAuthClient | null = null;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.initialize();
  }

  private async initialize() {
    try {
      const keysetPath = process.env.OAUTH_KEYSET_PATH;

      if (!keysetPath) {
        throw new Error(
          'OAUTH_KEYSET_PATH environment variable is required. ' +
            'Generate keys using oauth-keyset-json.sh and mount oauth-keyset.json'
        );
      }

      console.log(`[OAUTH] Loading keyset from file: ${keysetPath}`);
      const fs = await import('fs/promises');
      const keysetData = JSON.parse(await fs.readFile(keysetPath, 'utf-8'));

      if (!keysetData.privateKeyPem || !keysetData.kid) {
        throw new Error(
          'Invalid oauth-keyset.json: missing privateKeyPem or kid'
        );
      }

      const keyset = [
        await JoseKey.fromImportable(keysetData.privateKeyPem, keysetData.kid),
      ];
      console.log('[OAUTH] Loaded keyset from file successfully');

      const sessionStore = new DatabaseSessionStore();

      // Runtime implementation functions for OAuth client
      const requestLock = <T>(
        key: string,
        fn: () => T | PromiseLike<T>
      ): Promise<T> => {
        return sessionStore.lock(key, fn);
      };

      const getRandomValues = (byteLength: number): Uint8Array => {
        const array = new Uint8Array(byteLength);
        webcrypto.getRandomValues(array);
        return array;
      };

      const digest = async (
        data: Uint8Array,
        algorithm: { name: string }
      ): Promise<Uint8Array> => {
        const algoName = algorithm.name.toUpperCase().replace(/(\d+)/, '-$1');
        const hash = await webcrypto.subtle.digest(algoName, data);
        return new Uint8Array(hash);
      };

      const createKey = async (algs: string[]): Promise<any> => {
        // Generate ES256 key pair using crypto
        const { privateKey } = generateKeyPairSync('ec', {
          namedCurve: 'P-256',
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        });

        // Convert to JoseKey format
        return await JoseKey.fromImportable(privateKey, 'dpop');
      };

      this.client = new NodeOAuthClient({
        clientMetadata: {
          client_id: CLIENT_ID,
          client_name: 'AT Protocol AppView',
          client_uri: BASE_URL,
          redirect_uris: [CALLBACK_URL],
          grant_types: ['authorization_code', 'refresh_token'],
          scope: 'atproto transition:generic',
          response_types: ['code'],
          application_type: 'web',
          token_endpoint_auth_method: 'private_key_jwt',
          token_endpoint_auth_signing_alg: 'ES256',
          dpop_bound_access_tokens: true,
          jwks_uri: `${BASE_URL}/jwks.json`,
        },
        keyset,
        stateStore: new DatabaseStateStore(),
        sessionStore,
        runtimeImplementation: {
          requestLock,
          getRandomValues,
          digest,
          createKey,
        },
      });

      console.log('[OAUTH] Client initialized successfully');
    } catch (error) {
      console.error('[OAUTH] Failed to initialize client:', error);
      throw error;
    }
  }

  async ensureInitialized() {
    await this.initPromise;
    if (!this.client) {
      throw new Error('OAuth client not initialized');
    }
    return this.client;
  }

  get clientMetadata() {
    return this.client?.clientMetadata;
  }

  get jwks() {
    return this.client?.jwks;
  }

  async initiateLogin(handle: string, state: string): Promise<string> {
    const client = await this.ensureInitialized();
    const url = await client.authorize(handle, { state });
    return url.toString();
  }

  async handleCallback(params: URLSearchParams): Promise<{
    success: boolean;
    session?: {
      did: string;
      handle?: string;
    };
    state?: string | null;
    error?: string;
  }> {
    try {
      const client = await this.ensureInitialized();
      const result = await client.callback(params);

      return {
        success: true,
        session: {
          did: result.session.did,
        },
        state: result.state,
      };
    } catch (error) {
      console.error('[OAUTH] Callback error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth callback failed',
      };
    }
  }

  async getSession(did: string) {
    const client = await this.ensureInitialized();
    try {
      return await client.restore(did);
    } catch (error) {
      console.error('[OAUTH] Failed to restore session:', error);
      return null;
    }
  }

  async revokeSession(did: string) {
    const client = await this.ensureInitialized();
    try {
      await client.revoke(did);
    } catch (error) {
      console.error('[OAUTH] Failed to revoke session:', error);
    }
  }
}

export const oauthService = new OAuthService();
