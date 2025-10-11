/**
 * PDS Client Service for AT Protocol
 * 
 * Handles communication with Personal Data Servers (PDS)
 * - Token verification
 * - Proxying write operations
 * - API requests with authentication
 */

import { didResolver } from "./did-resolver";

interface XRPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export class PDSClient {
  /**
   * Verify an access token by calling an authenticated endpoint
   * Returns the DID associated with the token if valid, null otherwise
   */
  async verifyToken(
    expectedDid: string,
    pdsEndpoint: string,
    accessToken: string
  ): Promise<string | null> {
    try {
      // Use com.atproto.server.getSession - requires valid auth
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.server.getSession`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        console.error(`[PDS_CLIENT] Token verification failed: ${response.status}`);
        return null;
      }

      const session = await response.json();
      
      // Verify the DID in the session matches the expected DID
      if (!session.did) {
        console.error('[PDS_CLIENT] Session response missing DID');
        return null;
      }

      if (session.did !== expectedDid) {
        console.error(
          `[PDS_CLIENT] DID mismatch: expected=${expectedDid}, got=${session.did}`
        );
        return null;
      }

      return session.did;
    } catch (error) {
      console.error(`[PDS_CLIENT] Error verifying token for ${expectedDid}:`, error);
      return null;
    }
  }

  /**
   * Create a post on the user's PDS
   */
  async createPost(
    pdsEndpoint: string,
    accessToken: string,
    did: string,
    record: {
      text: string;
      createdAt: string;
      reply?: {
        root: { uri: string; cid: string };
        parent: { uri: string; cid: string };
      };
      embed?: any;
    }
  ): Promise<XRPCResponse<{ uri: string; cid: string }>> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.createRecord`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repo: did,
            collection: 'app.bsky.feed.post',
            record: {
              ...record,
              $type: 'app.bsky.feed.post',
            },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `PDS returned ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data: {
          uri: data.uri,
          cid: data.cid,
        },
      };
    } catch (error) {
      console.error('[PDS_CLIENT] Error creating post:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a like on the user's PDS
   */
  async createLike(
    pdsEndpoint: string,
    accessToken: string,
    did: string,
    subject: { uri: string; cid: string }
  ): Promise<XRPCResponse<{ uri: string; cid: string }>> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.createRecord`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repo: did,
            collection: 'app.bsky.feed.like',
            record: {
              subject,
              createdAt: new Date().toISOString(),
              $type: 'app.bsky.feed.like',
            },
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `PDS returned ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data: {
          uri: data.uri,
          cid: data.cid,
        },
      };
    } catch (error) {
      console.error('[PDS_CLIENT] Error creating like:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete a record (like, post, follow, etc.) from the user's PDS
   */
  async deleteRecord(
    pdsEndpoint: string,
    accessToken: string,
    did: string,
    collection: string,
    rkey: string
  ): Promise<XRPCResponse> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.deleteRecord`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repo: did,
            collection,
            rkey,
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `PDS returned ${response.status}: ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      console.error('[PDS_CLIENT] Error deleting record:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Create a follow on the user's PDS
   */
  async createFollow(
    pdsEndpoint: string,
    accessToken: string,
    did: string,
    subjectDid: string
  ): Promise<XRPCResponse<{ uri: string; cid: string }>> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.createRecord`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            repo: did,
            collection: 'app.bsky.graph.follow',
            record: {
              subject: subjectDid,
              createdAt: new Date().toISOString(),
              $type: 'app.bsky.graph.follow',
            },
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `PDS returned ${response.status}: ${errorText}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data: {
          uri: data.uri,
          cid: data.cid,
        },
      };
    } catch (error) {
      console.error('[PDS_CLIENT] Error creating follow:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get a record's CID for operations that require it
   */
  async getRecordCID(
    pdsEndpoint: string,
    repo: string,
    collection: string,
    rkey: string
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.repo.getRecord?` +
          `repo=${repo}&collection=${collection}&rkey=${rkey}`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.cid || null;
    } catch (error) {
      console.error('[PDS_CLIENT] Error getting record CID:', error);
      return null;
    }
  }

  /**
   * Create a session by authenticating with a PDS
   * Proxies the authentication request to the user's home PDS
   * Returns the complete PDS response to preserve all AT Protocol fields
   */
  async createSession(
    pdsEndpoint: string,
    identifier: string,
    password: string
  ): Promise<XRPCResponse<any>> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.server.createSession`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            identifier,
            password,
          }),
          signal: AbortSignal.timeout(15000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Authentication failed: ${response.status}`;
        
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.message || errorJson.error || errorMessage;
        } catch {
          // If not JSON, use the status message
        }
        
        console.error(`[PDS_CLIENT] Create session failed: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
        };
      }

      const data = await response.json();
      
      // Validate response has minimum required fields
      if (!data.accessJwt || !data.refreshJwt || !data.did || !data.handle) {
        console.error('[PDS_CLIENT] Invalid session response - missing required fields');
        return {
          success: false,
          error: 'Invalid session response from PDS',
        };
      }

      console.log(`[PDS_CLIENT] Successfully created session for ${data.handle} (${data.did})`);

      // Return the complete response from PDS to preserve all AT Protocol fields
      // (active, status, authFactorToken, email, emailConfirmed, didDoc, etc.)
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error('[PDS_CLIENT] Error creating session:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Refresh an access token using a refresh token
   * Returns new access token, refresh token, and expiry information
   */
  async refreshAccessToken(
    pdsEndpoint: string,
    refreshToken: string
  ): Promise<XRPCResponse<{ 
    accessJwt: string; 
    refreshJwt: string;
    did: string;
    handle: string;
  }>> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.server.refreshSession`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${refreshToken}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[PDS_CLIENT] Token refresh failed: ${response.status} - ${errorText}`);
        return {
          success: false,
          error: `Token refresh failed: ${response.status}`,
        };
      }

      const data = await response.json();
      
      // Validate response has required fields
      if (!data.accessJwt || !data.refreshJwt || !data.did) {
        console.error('[PDS_CLIENT] Invalid refresh response - missing required fields');
        return {
          success: false,
          error: 'Invalid refresh response from PDS',
        };
      }

      console.log(`[PDS_CLIENT] Successfully refreshed token for ${data.did}`);

      return {
        success: true,
        data: {
          accessJwt: data.accessJwt,
          refreshJwt: data.refreshJwt,
          did: data.did,
          handle: data.handle || '',
        },
      };
    } catch (error) {
      console.error('[PDS_CLIENT] Error refreshing token:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Refresh session (alias for refreshAccessToken for XRPC compatibility)
   */
  async refreshSession(
    pdsEndpoint: string,
    refreshToken: string
  ): Promise<XRPCResponse<any>> {
    return this.refreshAccessToken(pdsEndpoint, refreshToken);
  }

  /**
   * Get current session info using access token
   */
  async getSession(
    pdsEndpoint: string,
    accessToken: string
  ): Promise<XRPCResponse<any>> {
    try {
      const response = await fetch(
        `${pdsEndpoint}/xrpc/com.atproto.server.getSession`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        return {
          success: false,
          error: `Get session failed: ${response.status}`,
        };
      }

      const data = await response.json();
      return {
        success: true,
        data,
      };
    } catch (error) {
      console.error('[PDS_CLIENT] Error getting session:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Forwards a raw XRPC request to a PDS using AppView's own authentication.
   * This is used for server-to-server communication where the AppView acts on behalf of a user.
   */
  async proxyXRPCWithAppViewAuth(
    pdsEndpoint: string,
    method: string,
    path: string,
    query: Record<string, any>,
    userDid: string,
    body: any,
    headers: any,
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    // Import AppView JWT service
    const { appViewJWTService } = await import('./appview-jwt');
    const { didResolver } = await import('./did-resolver');
    
    // Resolve the PDS DID from the user's DID document
    // In most AT Protocol implementations, the PDS DID is the same as the user's DID
    // But we should resolve it properly from the DID document to be correct
    let pdsDid = userDid; // Default fallback
    
    try {
      const didDoc = await didResolver.resolveDID(userDid);
      if (didDoc && didDoc.id) {
        // The PDS DID is typically the same as the user's DID in AT Protocol
        // This is the standard pattern where each user's data is stored on their own PDS
        pdsDid = didDoc.id;
      }
    } catch (error) {
      console.warn(`[PDS_CLIENT] Could not resolve DID document for ${userDid}, using DID as PDS DID:`, error);
      // Fallback to using user DID as PDS DID
      pdsDid = userDid;
    }
    
    // Generate AppView-to-PDS token
    const appViewToken = appViewJWTService.signPDSToken(pdsDid, userDid);
    
    return this.proxyXRPC(pdsEndpoint, method, path, query, appViewToken, body, headers);
  }

  /**
   * Forwards a raw XRPC request to a PDS.
   * This is used for proxying methods that are not implemented by the AppView.
   * It uses a strict allow-list for headers to prevent forwarding problematic ones.
   */
  async proxyXRPC(
    pdsEndpoint: string,
    method: string,
    path: string,
    query: Record<string, any>,
    accessToken: string,
    body: any,
    headers: any,
  ): Promise<{ status: number; headers: Record<string, string>; body: any }> {
    const searchParams = new URLSearchParams();
    for (const key in query) {
      const value = query[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          searchParams.append(key, item);
        }
      } else if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    }

    const queryString = searchParams.toString();
    const url = `${pdsEndpoint}${path}${queryString ? `?${queryString}` : ''}`;

    // Sanitize headers to prevent forwarding potentially problematic ones.
    const forwardedHeaders: Record<string, string> = {
      'authorization': `Bearer ${accessToken}`,
    };
    if (headers['accept']) {
      forwardedHeaders['accept'] = headers['accept'] as string;
    }
    if (headers['user-agent']) {
      forwardedHeaders['user-agent'] = headers['user-agent'] as string;
    }
    if (headers['accept-language']) {
      forwardedHeaders['accept-language'] = headers['accept-language'] as string;
    }

    const fetchOptions: RequestInit = {
      method,
      headers: forwardedHeaders,
      signal: AbortSignal.timeout(20000),
    };

    if (method !== 'GET' && body && Object.keys(body).length > 0) {
      fetchOptions.body = JSON.stringify(body);
      (fetchOptions.headers as Record<string, string>)['content-type'] = 'application/json';
    }

    const response = await fetch(url, fetchOptions);

    const responseBody = await response.json().catch(() => response.text());

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') {
        responseHeaders[key] = value;
      }
    });

    return {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
    };
  }
}

export const pdsClient = new PDSClient();