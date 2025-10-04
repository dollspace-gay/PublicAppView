/**
 * Admin Authorization Service
 * 
 * Manages authorized admin users from ADMIN_DIDS environment variable
 */

import { db } from "../db";
import { authorizedAdmins } from "@shared/schema";
import { eq } from "drizzle-orm";
import { didResolver } from "./did-resolver";

export class AdminAuthorizationService {
  private initialized = false;

  /**
   * Initialize admin authorization from ADMIN_DIDS environment variable
   * Format: ADMIN_DIDS=did:plc:xxx,handle.bsky.social,did:plc:yyy
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    const adminDids = process.env.ADMIN_DIDS?.trim();
    
    if (!adminDids) {
      console.log("[ADMIN_AUTH] No ADMIN_DIDS configured - admin panel will be inaccessible");
      this.initialized = true;
      return;
    }

    const entries = adminDids.split(",").map(s => s.trim()).filter(Boolean);
    
    if (entries.length === 0) {
      console.log("[ADMIN_AUTH] No admin DIDs/handles provided");
      this.initialized = true;
      return;
    }

    console.log(`[ADMIN_AUTH] Processing ${entries.length} admin entries...`);

    for (const entry of entries) {
      try {
        let did: string;
        let handle: string;

        // Check if it's already a DID
        if (entry.startsWith("did:")) {
          did = entry;
          
          // Resolve DID to get handle
          const didDoc = await didResolver.resolveDID(did);
          if (!didDoc) {
            console.error(`[ADMIN_AUTH] Could not resolve DID ${did}`);
            continue;
          }

          // Extract handle from alsoKnownAs
          const handleUri = didDoc.alsoKnownAs?.find((aka: string) => aka.startsWith("at://"));
          if (handleUri) {
            handle = handleUri.replace("at://", "");
          } else {
            handle = did; // Fallback to using DID as handle
          }
        } else {
          // It's a handle - resolve to DID
          handle = entry;
          
          // Try resolving with the DID resolver
          let resolvedDid = await didResolver.resolveHandle(handle);
          
          if (!resolvedDid) {
            // Fallback: Try calling the official AT Protocol resolution endpoint
            try {
              const response = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${handle}`);
              if (response.ok) {
                const data = await response.json();
                resolvedDid = data.did;
              }
            } catch (fetchError) {
              console.error(`[ADMIN_AUTH] Fetch fallback failed for ${handle}:`, fetchError);
            }
          }
          
          if (!resolvedDid) {
            console.error(`[ADMIN_AUTH] Could not resolve handle ${handle} to DID`);
            continue;
          }
          
          did = resolvedDid;
        }

        // Add or update in database
        await db
          .insert(authorizedAdmins)
          .values({ did, handle })
          .onConflictDoUpdate({
            target: authorizedAdmins.did,
            set: { handle }
          });

        console.log(`[ADMIN_AUTH] Authorized admin: ${handle} (${did})`);
      } catch (error) {
        console.error(`[ADMIN_AUTH] Error processing entry ${entry}:`, error);
      }
    }

    this.initialized = true;
    console.log("[ADMIN_AUTH] Admin authorization initialized");
  }

  /**
   * Check if a DID is authorized as an admin
   */
  async isAdmin(did: string): Promise<boolean> {
    try {
      const admin = await db
        .select()
        .from(authorizedAdmins)
        .where(eq(authorizedAdmins.did, did))
        .limit(1);

      return admin.length > 0;
    } catch (error) {
      console.error(`[ADMIN_AUTH] Error checking admin status for ${did}:`, error);
      return false;
    }
  }

  /**
   * Get all authorized admins
   */
  async getAdmins() {
    try {
      return await db
        .select()
        .from(authorizedAdmins);
    } catch (error) {
      console.error("[ADMIN_AUTH] Error fetching admins:", error);
      return [];
    }
  }
}

export const adminAuthService = new AdminAuthorizationService();
