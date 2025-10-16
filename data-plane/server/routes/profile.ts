import { Router } from 'express';
import { db } from '../../../server/db';
import { users } from '../../../shared/schema';
import { eq, or, sql, ilike, and, desc } from 'drizzle-orm';
import type {
  GetProfileRequest,
  GetProfilesRequest,
  SearchActorsRequest,
  ProfileRecord,
  PaginatedResponse,
} from '../types';

const router = Router();

/**
 * Get a single profile by DID or handle
 */
router.post('/getProfile', async (req, res) => {
  try {
    const { actor } = req.body as GetProfileRequest;

    if (!actor) {
      return res.status(400).json({ error: 'actor is required' });
    }

    // Determine if actor is a DID or handle
    const isDID = actor.startsWith('did:');

    const user = await db.query.users.findFirst({
      where: isDID ? eq(users.did, actor) : eq(users.handle, actor),
    });

    if (!user) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get follower/following counts
    const [followerCountResult, followingCountResult, postsCountResult] =
      await Promise.all([
        db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text as count FROM follows WHERE following_did = ${user.did}
      `),
        db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text as count FROM follows WHERE follower_did = ${user.did}
      `),
        db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text as count FROM posts WHERE author_did = ${user.did}
      `),
      ]);

    const followersCount = parseInt(
      followerCountResult.rows[0]?.count || '0',
      10
    );
    const followsCount = parseInt(
      followingCountResult.rows[0]?.count || '0',
      10
    );
    const postsCount = parseInt(postsCountResult.rows[0]?.count || '0', 10);

    const profile: ProfileRecord = {
      did: user.did,
      handle: user.handle,
      displayName: user.displayName || undefined,
      description: user.description || undefined,
      avatarUrl: user.avatarUrl || undefined,
      bannerUrl: user.bannerUrl || undefined,
      followersCount,
      followsCount,
      postsCount,
      indexedAt: user.indexedAt.toISOString(),
    };

    res.json(profile);
  } catch (error) {
    console.error('[DATA_PLANE] Error in getProfile:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Get multiple profiles in batch
 */
router.post('/getProfiles', async (req, res) => {
  try {
    const { actors } = req.body as GetProfilesRequest;

    if (!actors || !Array.isArray(actors) || actors.length === 0) {
      return res.status(400).json({ error: 'actors array is required' });
    }

    // Separate DIDs and handles
    const dids = actors.filter((a) => a.startsWith('did:'));
    const handles = actors.filter((a) => !a.startsWith('did:'));

    const usersData = await db.query.users.findMany({
      where: or(
        dids.length > 0 ? sql`${users.did} = ANY(${dids})` : undefined,
        handles.length > 0 ? sql`${users.handle} = ANY(${handles})` : undefined
      ),
    });

    // Get counts for all users in batch
    const userDids = usersData.map((u) => u.did);

    const [followerCounts, followingCounts, postsCounts] = await Promise.all([
      db.execute<{ did: string; count: string }>(sql`
        SELECT following_did as did, COUNT(*)::text as count
        FROM follows
        WHERE following_did = ANY(${userDids})
        GROUP BY following_did
      `),
      db.execute<{ did: string; count: string }>(sql`
        SELECT follower_did as did, COUNT(*)::text as count
        FROM follows
        WHERE follower_did = ANY(${userDids})
        GROUP BY follower_did
      `),
      db.execute<{ did: string; count: string }>(sql`
        SELECT author_did as did, COUNT(*)::text as count
        FROM posts
        WHERE author_did = ANY(${userDids})
        GROUP BY author_did
      `),
    ]);

    // Build count maps
    const followerCountMap = new Map(
      followerCounts.rows.map((r) => [r.did, parseInt(r.count, 10)])
    );
    const followingCountMap = new Map(
      followingCounts.rows.map((r) => [r.did, parseInt(r.count, 10)])
    );
    const postsCountMap = new Map(
      postsCounts.rows.map((r) => [r.did, parseInt(r.count, 10)])
    );

    const profiles: ProfileRecord[] = usersData.map((user) => ({
      did: user.did,
      handle: user.handle,
      displayName: user.displayName || undefined,
      description: user.description || undefined,
      avatarUrl: user.avatarUrl || undefined,
      bannerUrl: user.bannerUrl || undefined,
      followersCount: followerCountMap.get(user.did) || 0,
      followsCount: followingCountMap.get(user.did) || 0,
      postsCount: postsCountMap.get(user.did) || 0,
      indexedAt: user.indexedAt.toISOString(),
    }));

    res.json({ profiles });
  } catch (error) {
    console.error('[DATA_PLANE] Error in getProfiles:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Search actors by display name or handle
 */
router.post('/searchActors', async (req, res) => {
  try {
    const { query, limit = 25, cursor } = req.body as SearchActorsRequest;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const actualLimit = Math.min(limit, 100);

    // Use full-text search if available, otherwise use ILIKE
    let results;
    try {
      // Try full-text search first
      results = await db
        .select()
        .from(users)
        .where(
          and(
            sql`${users.searchVector} @@ plainto_tsquery('english', ${query})`,
            cursor ? sql`${users.did} > ${cursor}` : undefined
          )
        )
        .orderBy(
          desc(
            sql`ts_rank(${users.searchVector}, plainto_tsquery('english', ${query}))`
          )
        )
        .limit(actualLimit + 1);
    } catch {
      // Fallback to ILIKE search if full-text fails
      results = await db
        .select()
        .from(users)
        .where(
          and(
            or(
              ilike(users.handle, `%${query}%`),
              ilike(users.displayName, `%${query}%`)
            ),
            cursor ? sql`${users.did} > ${cursor}` : undefined
          )
        )
        .orderBy(users.did)
        .limit(actualLimit + 1);
    }

    const hasMore = results.length > actualLimit;
    const items = hasMore ? results.slice(0, actualLimit) : results;

    // Get counts for users
    const userDids = items.map((u) => u.did);

    const [followerCounts, followingCounts, postsCounts] = await Promise.all([
      db.execute<{ did: string; count: string }>(sql`
        SELECT following_did as did, COUNT(*)::text as count
        FROM follows
        WHERE following_did = ANY(${userDids})
        GROUP BY following_did
      `),
      db.execute<{ did: string; count: string }>(sql`
        SELECT follower_did as did, COUNT(*)::text as count
        FROM follows
        WHERE follower_did = ANY(${userDids})
        GROUP BY follower_did
      `),
      db.execute<{ did: string; count: string }>(sql`
        SELECT author_did as did, COUNT(*)::text as count
        FROM posts
        WHERE author_did = ANY(${userDids})
        GROUP BY author_did
      `),
    ]);

    const followerCountMap = new Map(
      followerCounts.rows.map((r) => [r.did, parseInt(r.count, 10)])
    );
    const followingCountMap = new Map(
      followingCounts.rows.map((r) => [r.did, parseInt(r.count, 10)])
    );
    const postsCountMap = new Map(
      postsCounts.rows.map((r) => [r.did, parseInt(r.count, 10)])
    );

    const profiles: ProfileRecord[] = items.map((user) => ({
      did: user.did,
      handle: user.handle,
      displayName: user.displayName || undefined,
      description: user.description || undefined,
      avatarUrl: user.avatarUrl || undefined,
      bannerUrl: user.bannerUrl || undefined,
      followersCount: followerCountMap.get(user.did) || 0,
      followsCount: followingCountMap.get(user.did) || 0,
      postsCount: postsCountMap.get(user.did) || 0,
      indexedAt: user.indexedAt.toISOString(),
    }));

    const response: PaginatedResponse<ProfileRecord> = {
      items: profiles,
      cursor: hasMore ? items[items.length - 1].did : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error('[DATA_PLANE] Error in searchActors:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as profileRoutes };
