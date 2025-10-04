import { DidResolver } from "@atproto/identity";

class IdentityResolver {
  private resolver: DidResolver;
  private cache: Map<string, string>;
  private resolving: Map<string, Promise<string | null>>;

  constructor() {
    this.resolver = new DidResolver({});
    this.cache = new Map();
    this.resolving = new Map();
  }

  async resolveDidToHandle(did: string): Promise<string | null> {
    if (this.cache.has(did)) {
      return this.cache.get(did)!;
    }

    if (this.resolving.has(did)) {
      return this.resolving.get(did)!;
    }

    const promise = (async () => {
      try {
        const didDoc = await this.resolver.resolve(did);
        
        if (didDoc && didDoc.alsoKnownAs && didDoc.alsoKnownAs.length > 0) {
          const handleUri = didDoc.alsoKnownAs[0];
          const handle = handleUri.replace('at://', '');
          
          this.cache.set(did, handle);
          this.resolving.delete(did);
          
          return handle;
        }
        
        this.resolving.delete(did);
        return null;
      } catch (error) {
        this.resolving.delete(did);
        return null;
      }
    })();

    this.resolving.set(did, promise);
    return promise;
  }

  async resolveDidsToHandles(dids: string[]): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    
    const promises = dids.map(async (did) => {
      const handle = await this.resolveDidToHandle(did);
      if (handle) {
        results.set(did, handle);
      }
    });

    await Promise.all(promises);
    return results;
  }

  clearCache() {
    this.cache.clear();
    this.resolving.clear();
  }
}

export const identityResolver = new IdentityResolver();
