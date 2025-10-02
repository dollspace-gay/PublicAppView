import { pool } from "../db";
import { users } from "../../shared/schema";
import { ilike } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { storage } from "../storage";
import { contentFilter } from "./content-filter";

export interface PostSearchResult {
  uri: string;
  cid: string;
  authorDid: string;
  text: string;
  embed: any;
  parentUri: string | null;
  rootUri: string | null;
  createdAt: Date;
  indexedAt: Date;
  rank: number;
}

export interface ActorSearchResult {
  did: string;
  handle: string;
  displayName: string | null;
  avatarUrl: string | null;
  description: string | null;
  rank: number;
}

class SearchService {
  /**
   * Search for posts using full-text search
   * @param query - Search query string
   * @param limit - Maximum number of results (default 25)
   * @param cursor - Pagination cursor (rank threshold)
   * @param userDid - Optional user DID for personalized filtering
   */
  async searchPosts(
    query: string,
    limit = 25,
    cursor?: string,
    userDid?: string
  ): Promise<{ posts: PostSearchResult[]; cursor?: string }> {
    // Sanitize query for tsquery
    const sanitizedQuery = query
      .trim()
      .split(/\s+/)
      .map(term => term.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(term => term.length > 0)
      .join(' & ');

    if (!sanitizedQuery) {
      return { posts: [] };
    }
    // Use pool directly for PostgreSQL-specific queries
    const sqlQuery = cursor
      ? `SELECT uri, cid, author_did as "authorDid", text, embed, parent_uri as "parentUri", root_uri as "rootUri", created_at as "createdAt", indexed_at as "indexedAt", ts_rank(search_vector, to_tsquery('english', $1)) as rank FROM posts WHERE search_vector @@ to_tsquery('english', $1) AND ts_rank(search_vector, to_tsquery('english', $1)) < $2 ORDER BY rank DESC LIMIT $3`
      : `SELECT uri, cid, author_did as "authorDid", text, embed, parent_uri as "parentUri", root_uri as "rootUri", created_at as "createdAt", indexed_at as "indexedAt", ts_rank(search_vector, to_tsquery('english', $1)) as rank FROM posts WHERE search_vector @@ to_tsquery('english', $1) ORDER BY rank DESC LIMIT $2`;
    
    const params = cursor ? [sanitizedQuery, parseFloat(cursor), limit + 1] : [sanitizedQuery, limit + 1];
    const queryResult = await pool.query(sqlQuery, params);
    const results = { rows: queryResult.rows as (PostSearchResult & { rank: number })[] };

    // Apply content filtering if user is authenticated
    let filteredResults = results.rows;
    if (userDid) {
      const settings = await storage.getUserSettings(userDid);
      if (settings) {
        filteredResults = results.rows.filter(post => {
          const filterResult = contentFilter.wouldFilter(post, settings);
          return !filterResult.filtered;
        });
      }
    }

    // Determine pagination
    const hasMore = filteredResults.length > limit;
    const postsToReturn = filteredResults.slice(0, limit);
    const nextCursor = hasMore && postsToReturn.length > 0
      ? postsToReturn[postsToReturn.length - 1].rank.toString()
      : undefined;

    return {
      posts: postsToReturn as PostSearchResult[],
      cursor: nextCursor,
    };
  }

  /**
   * Search for actors (users) using full-text search
   * @param query - Search query string
   * @param limit - Maximum number of results (default 25)
   * @param cursor - Pagination cursor (rank threshold)
   */
  async searchActors(
    query: string,
    limit = 25,
    cursor?: string
  ): Promise<{ actors: ActorSearchResult[]; cursor?: string }> {
    // Sanitize query for tsquery
    const sanitizedQuery = query
      .trim()
      .split(/\s+/)
      .map(term => term.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(term => term.length > 0)
      .join(' & ');

    if (!sanitizedQuery) {
      return { actors: [] };
    }

    // Build SQL query with optional cursor
    const cursorCondition = cursor 
      ? sql`AND ts_rank(search_vector, to_tsquery('english', ${sanitizedQuery})) < ${parseFloat(cursor)}`
      : sql``;

    // Execute search using raw SQL
    const results = await db.execute<ActorSearchResult>(sql`
      SELECT 
        did,
        handle,
        display_name as "displayName",
        avatar_url as "avatarUrl",
        description,
        ts_rank(search_vector, to_tsquery('english', ${sanitizedQuery})) as rank
      FROM users
      WHERE search_vector @@ to_tsquery('english', ${sanitizedQuery})
        ${cursorCondition}
      ORDER BY rank DESC
      LIMIT ${limit + 1}
    `);

    // Determine pagination
    const hasMore = results.rows.length > limit;
    const actorsToReturn = results.rows.slice(0, limit);
    const nextCursor = hasMore && actorsToReturn.length > 0
      ? actorsToReturn[actorsToReturn.length - 1].rank.toString()
      : undefined;

    return {
      actors: actorsToReturn as ActorSearchResult[],
      cursor: nextCursor,
    };
  }

  /**
   * Typeahead search for actors (prefix matching on handle)
   * @param query - Search prefix
   * @param limit - Maximum number of results (default 10)
   */
  async searchActorsTypeahead(
    query: string,
    limit = 10
  ): Promise<ActorSearchResult[]> {
    const sanitizedQuery = query.trim().toLowerCase();
    
    if (!sanitizedQuery) {
      return [];
    }

    // Use ILIKE for prefix matching on handle (more performant for typeahead)
    const results = await db
      .select({
        did: users.did,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        description: users.description,
        rank: sql<number>`1.0`, // Fixed rank for typeahead
      })
      .from(users)
      .where(ilike(users.handle, `${sanitizedQuery}%`))
      .orderBy(users.handle)
      .limit(limit);

    return results;
  }
}

export const searchService = new SearchService();
