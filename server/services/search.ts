import { pool, db } from '../db';
import { users } from '../../shared/schema';
import { ilike } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { storage } from '../storage';
import { contentFilter } from './content-filter';

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
  searchVector: string | null;
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
   * Search for posts using full-text search with PostgreSQL
   * @param query - Search query string
   * @param options - Search options including filters and pagination
   * @param userDid - Optional user DID for personalized filtering
   */
  async searchPosts(
    query: string,
    options: {
      limit?: number;
      cursor?: string;
      sort?: 'top' | 'latest';
      since?: string;
      until?: string;
      mentions?: string;
      author?: string;
      lang?: string;
      domain?: string;
      url?: string;
      tag?: string[];
    },
    userDid?: string
  ): Promise<{ posts: PostSearchResult[]; cursor?: string }> {
    const trimmedQuery = query.trim();
    const {
      limit = 25,
      cursor,
      sort = 'top',
      since,
      until,
      mentions,
      author,
      lang,
      domain,
      url,
      tag,
    } = options;

    if (!trimmedQuery) {
      return { posts: [] };
    }

    // Build WHERE conditions
    const conditions: string[] = [
      `search_vector @@ plainto_tsquery('english', $1)`,
    ];
    const params: any[] = [trimmedQuery];
    let paramIndex = 2;

    // Time range filters
    if (since) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(new Date(since));
      paramIndex++;
    }
    if (until) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(new Date(until));
      paramIndex++;
    }

    // Author filter
    if (author) {
      conditions.push(`author_did = $${paramIndex}`);
      params.push(author);
      paramIndex++;
    }

    // Mentions filter - check if text contains the DID or handle
    if (mentions) {
      conditions.push(`(text ILIKE $${paramIndex} OR embed::text ILIKE $${paramIndex})`);
      params.push(`%${mentions}%`);
      paramIndex++;
    }

    // Language filter (stored in langs column)
    if (lang) {
      conditions.push(`langs @> ARRAY[$${paramIndex}]::varchar[]`);
      params.push(lang);
      paramIndex++;
    }

    // Domain filter - check if embed contains domain
    if (domain) {
      conditions.push(`embed::text ILIKE $${paramIndex}`);
      params.push(`%${domain}%`);
      paramIndex++;
    }

    // URL filter - check if embed contains URL
    if (url) {
      conditions.push(`embed::text ILIKE $${paramIndex}`);
      params.push(`%${url}%`);
      paramIndex++;
    }

    // Tag filter - check if tags column contains any of the specified tags
    if (tag && tag.length > 0) {
      conditions.push(`tags && ARRAY[${tag.map((_, i) => `$${paramIndex + i}`).join(', ')}]::varchar[]`);
      params.push(...tag);
      paramIndex += tag.length;
    }

    // Determine sort and cursor handling
    let orderBy: string;
    let cursorCondition: string | null = null;

    if (sort === 'latest') {
      orderBy = 'ORDER BY created_at DESC';
      if (cursor) {
        cursorCondition = `created_at < $${paramIndex}`;
        params.push(new Date(cursor));
        paramIndex++;
      }
    } else {
      // Default: sort by relevance (top)
      orderBy = `ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC`;
      if (cursor) {
        cursorCondition = `ts_rank(search_vector, plainto_tsquery('english', $1)) < $${paramIndex}`;
        params.push(parseFloat(cursor));
        paramIndex++;
      }
    }

    if (cursorCondition) {
      conditions.push(cursorCondition);
    }

    // Build and execute query
    const sqlQuery = `
      SELECT
        uri,
        cid,
        author_did as "authorDid",
        text,
        embed,
        parent_uri as "parentUri",
        root_uri as "rootUri",
        created_at as "createdAt",
        indexed_at as "indexedAt",
        ${sort === 'top' ? `ts_rank(search_vector, plainto_tsquery('english', $1)) as rank` : `EXTRACT(EPOCH FROM created_at) as rank`}
      FROM posts
      WHERE ${conditions.join(' AND ')}
      ${orderBy}
      LIMIT $${paramIndex}
    `;
    params.push(limit + 1);

    const queryResult = await pool.query(sqlQuery, params);
    const results = {
      rows: queryResult.rows as (PostSearchResult & { rank: number })[],
    };

    // Apply content filtering if user is authenticated
    let filteredResults = results.rows;
    if (userDid) {
      const settings = await storage.getUserSettings(userDid);
      if (settings) {
        filteredResults = results.rows.filter((post) => {
          const filterResult = contentFilter.wouldFilter(post, settings);
          return !filterResult.filtered;
        });
      }
    }

    // Determine pagination
    const hasMore = filteredResults.length > limit;
    const postsToReturn = filteredResults.slice(0, limit);
    const nextCursor =
      hasMore && postsToReturn.length > 0
        ? sort === 'latest'
          ? postsToReturn[postsToReturn.length - 1].createdAt.toISOString()
          : postsToReturn[postsToReturn.length - 1].rank.toString()
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
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      return { actors: [] };
    }

    // Use trigram search for handles (substring matching) combined with full-text search
    // This allows finding "kawanishi" within "kawanishitakumi.bsky.social"
    const cursorCondition = cursor
      ? sql`AND (
          GREATEST(
            similarity(handle, ${trimmedQuery}),
            ts_rank(search_vector, plainto_tsquery('simple', ${trimmedQuery}))
          ) < ${parseFloat(cursor)}
        )`
      : sql``;

    // Execute search using trigram similarity + full-text search
    const results = await db.execute(sql`
      SELECT 
        did,
        handle,
        display_name as "displayName",
        avatar_url as "avatarUrl",
        description,
        GREATEST(
          similarity(handle, ${trimmedQuery}),
          ts_rank(search_vector, plainto_tsquery('simple', ${trimmedQuery}))
        ) as rank
      FROM users
      WHERE 
        handle % ${trimmedQuery}
        OR search_vector @@ plainto_tsquery('simple', ${trimmedQuery})
        ${cursorCondition}
      ORDER BY rank DESC
      LIMIT ${limit + 1}
    `);

    // Determine pagination
    const rows = results.rows as unknown as (ActorSearchResult & {
      rank: number;
    })[];
    const hasMore = rows.length > limit;
    const actorsToReturn = rows.slice(0, limit);
    const nextCursor =
      hasMore && actorsToReturn.length > 0
        ? actorsToReturn[actorsToReturn.length - 1].rank.toString()
        : undefined;

    return {
      actors: actorsToReturn,
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
    const sanitizedQuery = query
      .trim()
      .toLowerCase()
      // Escape LIKE special characters to prevent pattern injection
      .replace(/[%_\\]/g, '\\$&');

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
