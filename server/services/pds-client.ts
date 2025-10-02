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
}

export const pdsClient = new PDSClient();
