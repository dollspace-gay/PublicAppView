/**
 * DID Resolution Service for AT Protocol
 * 
 * Resolves DIDs to PDS endpoints and verifies identity
 */

interface DIDDocument {
  id: string;
  alsoKnownAs?: string[];
  verificationMethod?: any[];
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

export class DIDResolver {
  private plcDirectory = "https://plc.directory";

  /**
   * Resolve a handle to a DID
   */
  async resolveHandle(handle: string): Promise<string | null> {
    try {
      // Try DNS TXT record first (more decentralized)
      const didFromDNS = await this.resolveHandleViaDNS(handle);
      if (didFromDNS) {
        return didFromDNS;
      }

      // Fallback to HTTPS well-known endpoint
      const didFromHTTPS = await this.resolveHandleViaHTTPS(handle);
      return didFromHTTPS;
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving handle ${handle}:`, error);
      return null;
    }
  }

  private async resolveHandleViaDNS(handle: string): Promise<string | null> {
    // DNS resolution requires a DNS library - skip for now
    // In production, use dns.promises.resolveTxt(`_atproto.${handle}`)
    return null;
  }

  private async resolveHandleViaHTTPS(handle: string): Promise<string | null> {
    try {
      const response = await fetch(`https://${handle}/.well-known/atproto-did`, {
        headers: { 'Accept': 'text/plain' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const did = (await response.text()).trim();
      
      // Validate DID format
      if (!did.startsWith('did:')) {
        return null;
      }

      return did;
    } catch (error) {
      return null;
    }
  }

  /**
   * Resolve a DID to its DID document
   */
  async resolveDID(did: string): Promise<DIDDocument | null> {
    try {
      if (did.startsWith('did:plc:')) {
        return await this.resolvePLCDID(did);
      } else if (did.startsWith('did:web:')) {
        return await this.resolveWebDID(did);
      } else {
        console.error(`[DID_RESOLVER] Unsupported DID method: ${did}`);
        return null;
      }
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving DID ${did}:`, error);
      return null;
    }
  }

  private async resolvePLCDID(did: string): Promise<DIDDocument | null> {
    try {
      const response = await fetch(`${this.plcDirectory}/${did}`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving PLC DID ${did}:`, error);
      return null;
    }
  }

  private async resolveWebDID(did: string): Promise<DIDDocument | null> {
    try {
      // Extract domain from did:web:example.com format
      const domain = did.replace('did:web:', '');
      const response = await fetch(`https://${domain}/.well-known/did.json`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving Web DID ${did}:`, error);
      return null;
    }
  }

  /**
   * Extract PDS endpoint from DID document
   */
  getPDSEndpoint(didDoc: DIDDocument): string | null {
    if (!didDoc.service) {
      return null;
    }

    // Find the AtprotoPersonalDataServer service
    const pdsService = didDoc.service.find(
      (service) =>
        service.id === '#atproto_pds' ||
        service.type === 'AtprotoPersonalDataServer'
    );

    if (!pdsService) {
      return null;
    }

    return pdsService.serviceEndpoint;
  }

  /**
   * Verify that a DID document confirms the handle
   */
  verifyHandle(didDoc: DIDDocument, handle: string): boolean {
    if (!didDoc.alsoKnownAs) {
      return false;
    }

    const expectedUri = `at://${handle}`;
    return didDoc.alsoKnownAs.includes(expectedUri);
  }

  /**
   * Full resolution: handle → DID → PDS endpoint
   */
  async resolveHandleToPDS(handle: string): Promise<{
    did: string;
    pdsEndpoint: string;
  } | null> {
    try {
      // Step 1: Resolve handle to DID
      const did = await this.resolveHandle(handle);
      if (!did) {
        console.error(`[DID_RESOLVER] Could not resolve handle ${handle} to DID`);
        return null;
      }

      // Step 2: Resolve DID to DID document
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        console.error(`[DID_RESOLVER] Could not resolve DID ${did} to document`);
        return null;
      }

      // Step 3: Verify bidirectional mapping
      if (!this.verifyHandle(didDoc, handle)) {
        console.error(`[DID_RESOLVER] Handle ${handle} not confirmed in DID document`);
        return null;
      }

      // Step 4: Extract PDS endpoint
      const pdsEndpoint = this.getPDSEndpoint(didDoc);
      if (!pdsEndpoint) {
        console.error(`[DID_RESOLVER] No PDS endpoint found in DID document for ${did}`);
        return null;
      }

      return { did, pdsEndpoint };
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving handle ${handle} to PDS:`, error);
      return null;
    }
  }

  /**
   * Resolve DID directly to PDS endpoint
   */
  async resolveDIDToPDS(did: string): Promise<string | null> {
    try {
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        return null;
      }

      return this.getPDSEndpoint(didDoc);
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving DID ${did} to PDS:`, error);
      return null;
    }
  }

  /**
   * Extract Feed Generator service endpoint from DID document
   */
  getFeedGeneratorEndpoint(didDoc: DIDDocument): string | null {
    if (!didDoc.service) {
      return null;
    }

    const feedService = didDoc.service.find(
      (service) =>
        service.id === '#bsky_fg' ||
        service.type === 'BskyFeedGenerator'
    );

    if (!feedService) {
      return null;
    }

    return feedService.serviceEndpoint;
  }

  /**
   * Resolve DID directly to Feed Generator service endpoint
   */
  async resolveDIDToFeedGenerator(did: string): Promise<string | null> {
    try {
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        return null;
      }

      return this.getFeedGeneratorEndpoint(didDoc);
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving DID ${did} to Feed Generator:`, error);
      return null;
    }
  }

  /**
   * Extract handle from DID document
   */
  getHandleFromDIDDocument(didDoc: DIDDocument): string | null {
    if (!didDoc.alsoKnownAs || didDoc.alsoKnownAs.length === 0) {
      return null;
    }

    // Find handle URI in alsoKnownAs field (format: at://username.domain)
    const handleUri = didDoc.alsoKnownAs.find(uri => uri.startsWith('at://'));
    if (handleUri) {
      return handleUri.replace('at://', '');
    }

    return null;
  }

  /**
   * Resolve DID to handle
   */
  async resolveDIDToHandle(did: string): Promise<string | null> {
    try {
      const didDoc = await this.resolveDID(did);
      if (!didDoc) {
        console.warn(`[DID_RESOLVER] Could not resolve DID document for ${did}`);
        return null;
      }

      const handle = this.getHandleFromDIDDocument(didDoc);
      if (!handle) {
        console.warn(`[DID_RESOLVER] No handle found in DID document for ${did}`);
        return null;
      }

      console.log(`[DID_RESOLVER] Resolved DID ${did} to handle ${handle}`);
      return handle;
    } catch (error) {
      console.error(`[DID_RESOLVER] Error resolving DID ${did} to handle:`, error);
      return null;
    }
  }
}

export const didResolver = new DIDResolver();
