/**
 * Serialization Utilities
 * Handles post serialization, URL transformation, and CDN URL generation
 */

import type { Request } from 'express';
import { optimizedHydrator } from '../../hydration/index';
import { dataLoaderHydrator } from '../../hydration/dataloader-hydrator';
import { getRequestDataLoader } from '../../../middleware/dataloader';
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';

/**
 * Convert raw multihash hex string to proper CID
 * Handles the avatar/banner CIDs stored as multihashes in the database
 */
export function multihashToCid(multihash: string): string | null {
  try {
    // If it's already a proper CID (starts with 'baf'), return as-is
    if (multihash.startsWith('baf')) {
      return multihash;
    }

    // Convert hex string to Uint8Array
    const bytes = new Uint8Array(multihash.length / 2);
    for (let i = 0; i < multihash.length; i += 2) {
      bytes[i / 2] = parseInt(multihash.substr(i, 2), 16);
    }

    // Parse the multihash to get code and digest
    // First 2 bytes are: [hash_code, digest_length]
    const code = bytes[0];
    const digestLength = bytes[1];
    const digestBytes = bytes.slice(2, 2 + digestLength);

    // Create proper multihash digest
    const multihashDigest = Digest.create(code, digestBytes);

    // Create CID (version 1, codec 0x55 for raw, multihash)
    const cidObj = CID.create(1, 0x55, multihashDigest);

    return cidObj.toString();
  } catch (error) {
    console.error(`[MULTIHASH_TO_CID] Error converting multihash: ${multihash}`, error);
    return null;
  }
}

/**
 * Get the base URL from the request
 * Falls back to localhost if headers are not available
 */
export function getBaseUrl(req?: Request): string {
  if (!req) {
    return process.env.PUBLIC_URL || 'http://localhost:3000';
  }

  const protocol =
    req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const host =
    req.get('x-forwarded-host') || req.get('host') || 'localhost:3000';
  return `${protocol}://${host}`;
}

/**
 * Extract CID from blob JSON
 */
export function cidFromBlobJson(json: unknown): string {
  if (json instanceof Object && (json as { ref?: unknown }).ref) {
    return (json as { ref: { toString: () => string } }).ref.toString();
  }
  // Handle the fact that parseRecordBytes() produces raw json rather than lexicon values
  const jsonObj = json as {
    $type?: string;
    ref?: { $link?: string };
    cid?: string;
  };
  if (jsonObj && jsonObj['$type'] === 'blob') {
    return (jsonObj['ref']?.['$link'] ?? '') as string;
  }
  return (jsonObj?.['cid'] ?? '') as string;
}

/**
 * Transform blob CID to CDN URL
 */
export function transformBlobToCdnUrl(
  blobCid: string,
  userDid: string,
  format:
    | 'avatar'
    | 'banner'
    | 'feed_thumbnail'
    | 'feed_fullsize' = 'feed_fullsize',
  req?: Request
): string | undefined {
  // Check for falsy values, empty strings, and the literal string "undefined" or "null"
  if (
    !blobCid ||
    blobCid === 'undefined' ||
    blobCid === 'null' ||
    blobCid.trim() === ''
  )
    return undefined;

  // Convert multihash to proper CID if needed
  let cid = blobCid;
  if (!blobCid.startsWith('baf')) {
    const converted = multihashToCid(blobCid);
    if (!converted) {
      console.error(`[CDN_TRANSFORM] Failed to convert multihash to CID: ${blobCid}`);
      return undefined;
    }
    cid = converted;
  }

  // Use local image proxy to fetch from Bluesky CDN
  const baseUrl = getBaseUrl(req);
  const proxyUrl = `${baseUrl}/img/${format}/plain/${userDid}/${cid}@jpeg`;
  console.log(`[CDN_TRANSFORM] ${blobCid} -> ${cid} -> ${proxyUrl}`);
  return proxyUrl;
}

/**
 * Transform a plain CID string (as stored in database) to CDN URL
 * Same logic but clearer name
 */
export function directCidToCdnUrl(
  cid: string,
  userDid: string,
  format:
    | 'avatar'
    | 'banner'
    | 'feed_thumbnail'
    | 'feed_fullsize' = 'feed_fullsize',
  req?: Request
): string | undefined {
  return transformBlobToCdnUrl(cid, userDid, format, req);
}

/**
 * Transform embed URLs from relative to absolute
 */
export function transformEmbedUrls(embed: unknown, req?: Request): unknown {
  if (!embed) return embed;

  const baseUrl = getBaseUrl(req);

  // Deep clone the embed to avoid mutating the original
  const transformed = JSON.parse(JSON.stringify(embed));

  // Transform URLs based on embed type
  if (
    transformed.$type === 'app.bsky.embed.images#view' &&
    transformed.images
  ) {
    transformed.images = transformed.images.map(
      (img: { thumb?: string; fullsize?: string }) => ({
        ...img,
        thumb: img.thumb?.startsWith('/')
          ? `${baseUrl}${img.thumb}`
          : img.thumb,
        fullsize: img.fullsize?.startsWith('/')
          ? `${baseUrl}${img.fullsize}`
          : img.fullsize,
      })
    );
  } else if (
    transformed.$type === 'app.bsky.embed.external#view' &&
    transformed.external?.thumb
  ) {
    if (
      typeof transformed.external.thumb === 'string' &&
      transformed.external.thumb.startsWith('/')
    ) {
      transformed.external.thumb = `${baseUrl}${transformed.external.thumb}`;
    }
  } else if (
    transformed.$type === 'app.bsky.embed.record#view' &&
    transformed.record
  ) {
    // Handle record embeds recursively
    if (transformed.record.embeds && Array.isArray(transformed.record.embeds)) {
      transformed.record.embeds = transformed.record.embeds.map((e: unknown) =>
        transformEmbedUrls(e, req)
      );
    }
    // Transform author avatar if it's a relative URL
    if (transformed.record.author?.avatar) {
      if (transformed.record.author.avatar.startsWith('/')) {
        transformed.record.author.avatar = `${baseUrl}${transformed.record.author.avatar}`;
      }
      // Validate and remove invalid avatar URIs
      if (
        typeof transformed.record.author.avatar !== 'string' ||
        transformed.record.author.avatar.trim() === ''
      ) {
        delete transformed.record.author.avatar;
      }
    }
  } else if (transformed.$type === 'app.bsky.embed.recordWithMedia#view') {
    if (transformed.media) {
      transformed.media = transformEmbedUrls(transformed.media, req);
    }
    if (transformed.record) {
      transformed.record = transformEmbedUrls(transformed.record, req);
    }
  } else if (
    transformed.$type === 'app.bsky.embed.video#view' &&
    transformed.thumbnail?.startsWith('/')
  ) {
    transformed.thumbnail = `${baseUrl}${transformed.thumbnail}`;
  }

  return transformed;
}

/**
 * Helper to conditionally include avatar field only if URL is valid
 */
export function maybeAvatar(
  avatarCid: string | null | undefined,
  did: string,
  req?: Request
): { avatar: string } | Record<string, never> {
  if (!avatarCid) return {};
  const url = transformBlobToCdnUrl(avatarCid, did, 'avatar', req);
  // Ensure the URL is a valid non-empty string before including it
  return url && typeof url === 'string' && url.trim() !== ''
    ? { avatar: url }
    : {};
}

/**
 * Helper to conditionally include banner field only if URL is valid
 */
export function maybeBanner(
  bannerCid: string | null | undefined,
  did: string,
  req?: Request
): { banner: string } | Record<string, never> {
  if (!bannerCid) return {};
  const url = transformBlobToCdnUrl(bannerCid, did, 'banner', req);
  // Ensure the URL is a valid non-empty string before including it
  return url && typeof url === 'string' && url.trim() !== ''
    ? { banner: url }
    : {};
}

/**
 * Create author viewer state
 */
export function createAuthorViewerState(
  authorDid: string,
  listMutes: Map<string, { listUri: string }>,
  listBlocks: Map<string, { listUri: string }>,
  listData?: Map<string, { name?: string; purpose?: string }>
): unknown {
  const listMute = listMutes.get(authorDid);
  const listBlock = listBlocks.get(authorDid);

  return {
    $type: 'app.bsky.actor.defs#viewerState',
    muted: !!listMute,
    mutedByList: listMute
      ? {
          $type: 'app.bsky.graph.defs#listViewBasic',
          uri: listMute.listUri,
          name: listData?.get(listMute.listUri)?.name || listMute.listUri,
          purpose:
            listData?.get(listMute.listUri)?.purpose ||
            'app.bsky.graph.defs#modlist',
        }
      : undefined,
    blockedBy: false,
    blocking: undefined,
    blockingByList: listBlock
      ? {
          $type: 'app.bsky.graph.defs#listViewBasic',
          uri: listBlock.listUri,
          name: listData?.get(listBlock.listUri)?.name || listBlock.listUri,
          purpose:
            listData?.get(listBlock.listUri)?.purpose ||
            'app.bsky.graph.defs#modlist',
        }
      : undefined,
    following: undefined,
    followedBy: undefined,
    knownFollowers: undefined,
    activitySubscription: undefined,
  };
}

/**
 * Serialize posts with enhanced hydration
 */
export async function serializePostsEnhanced(
  posts: unknown[],
  viewerDid?: string,
  req?: Request
): Promise<unknown[]> {
  const startTime = performance.now();

  if (posts.length === 0) {
    return [];
  }

  const postUris = posts.map((p) => (p as { uri: string }).uri);

  // Use DataLoader hydrator if available, otherwise fall back to optimized hydrator
  const dataLoader = req ? getRequestDataLoader(req) : undefined;
  const state = dataLoader
    ? await dataLoaderHydrator.hydratePosts(postUris, viewerDid, dataLoader)
    : await optimizedHydrator.hydratePosts(postUris, viewerDid);

  const hydrationTime = performance.now() - startTime;
  console.log(
    `[OPTIMIZED_HYDRATION] Hydrated ${postUris.length} posts in ${hydrationTime.toFixed(2)}ms`
  );
  console.log(`[OPTIMIZED_HYDRATION] Stats:`, {
    cacheHits: state.stats.cacheHits,
    cacheMisses: state.stats.cacheMisses,
    queryTime: `${state.stats.queryTime.toFixed(2)}ms`,
    totalTime: `${state.stats.totalTime.toFixed(2)}ms`,
  });

  const serializedPosts = posts.map((post) => {
    const postObj = post as {
      uri: string;
      cid: string;
      authorDid: string;
      text: string;
      createdAt: Date;
      indexedAt: Date;
      embed?: unknown;
      facets?: unknown;
    };

    const hydratedPost = state.posts.get(postObj.uri);
    const author = state.actors.get(postObj.authorDid);
    const aggregation = state.aggregations.get(postObj.uri);
    const viewerState = state.viewerStates.get(postObj.uri);
    const actorViewerState = state.actorViewerStates.get(postObj.authorDid);
    const labels = state.labels.get(postObj.uri) || [];
    const authorLabels = state.labels.get(postObj.authorDid) || [];
    const hydratedEmbed = state.embeds.get(postObj.uri);
    const threadGate = state.threadGates?.get(postObj.uri);

    // Handle must always be a valid handle string
    // Use 'handle.invalid' as fallback for missing/invalid handles (matches Bluesky's approach)
    const INVALID_HANDLE = 'handle.invalid';
    let authorHandle = (author as { handle?: string } | undefined)?.handle;

    // Fallback to handle.invalid if handle is missing, empty, or is a DID
    if (
      !authorHandle ||
      typeof authorHandle !== 'string' ||
      authorHandle.trim() === '' ||
      authorHandle.startsWith('did:')
    ) {
      console.warn(
        `[XRPC] Author ${postObj.authorDid} has invalid handle (got: ${authorHandle || 'undefined'}), using fallback: ${INVALID_HANDLE}`
      );
      authorHandle = INVALID_HANDLE;
    }

    const record: {
      $type: string;
      text: string;
      createdAt: string;
      embed?: unknown;
      facets?: unknown;
      reply?: unknown;
    } = {
      $type: 'app.bsky.feed.post',
      text:
        (hydratedPost as { text?: string } | undefined)?.text || postObj.text,
      createdAt:
        (hydratedPost as { createdAt?: string } | undefined)?.createdAt ||
        postObj.createdAt.toISOString(),
    };

    if (
      (hydratedPost as { embed?: unknown } | undefined)?.embed ||
      postObj.embed
    ) {
      const embedData =
        (hydratedPost as { embed?: unknown } | undefined)?.embed ||
        postObj.embed;
      if (
        embedData &&
        typeof embedData === 'object' &&
        (embedData as { $type?: string }).$type
      ) {
        const transformedEmbed = { ...embedData } as {
          $type: string;
          images?: unknown[];
          external?: unknown;
        };

        if (
          (embedData as { $type: string }).$type === 'app.bsky.embed.images'
        ) {
          transformedEmbed.images = (
            embedData as { images?: unknown[] }
          ).images?.map((img: unknown) => ({
            ...img,
            image: {
              ...(img as { image: unknown }).image,
              ref: {
                ...(img as { image: { ref: unknown } }).image.ref,
                link: transformBlobToCdnUrl(
                  (img as { image: { ref: { $link: string } } }).image.ref
                    .$link,
                  postObj.authorDid,
                  'feed_fullsize',
                  req
                ),
              },
            },
          }));
        } else if (
          (embedData as { $type: string }).$type === 'app.bsky.embed.external'
        ) {
          // Handle external embeds
          const external = { ...(embedData as { external: unknown }).external };

          // Only transform thumbnail if it exists and has a valid ref
          if (
            (
              embedData as {
                external?: { thumb?: { ref?: { $link?: string } } };
              }
            ).external?.thumb?.ref?.$link
          ) {
            const thumbUrl = transformBlobToCdnUrl(
              (embedData as { external: { thumb: { ref: { $link: string } } } })
                .external.thumb.ref.$link,
              postObj.authorDid,
              'feed_thumbnail',
              req
            );
            if (thumbUrl) {
              (external as { thumb: unknown }).thumb = {
                ...(embedData as { external: { thumb: unknown } }).external
                  .thumb,
                ref: {
                  ...(embedData as { external: { thumb: { ref: unknown } } })
                    .external.thumb.ref,
                  link: thumbUrl,
                },
              };
            } else {
              // Remove invalid thumb
              delete (external as { thumb?: unknown }).thumb;
            }
          }

          transformedEmbed.external = external;
        }

        record.embed = transformedEmbed;
      }
    }
    if (
      (hydratedPost as { facets?: unknown } | undefined)?.facets ||
      postObj.facets
    )
      record.facets =
        (hydratedPost as { facets?: unknown } | undefined)?.facets ||
        postObj.facets;

    // Build proper reply reference with CIDs from hydrated posts
    if (
      (
        hydratedPost as
          | { reply?: { parent?: { uri?: string }; root?: { uri?: string } } }
          | undefined
      )?.reply?.parent?.uri &&
      (hydratedPost as { reply: { root: { uri?: string } } })?.reply?.root?.uri
    ) {
      const parentPost = state.posts.get(
        (hydratedPost as { reply: { parent: { uri: string } } }).reply.parent
          .uri
      );
      const rootPost = state.posts.get(
        (hydratedPost as { reply: { root: { uri: string } } }).reply.root.uri
      );

      if (parentPost && rootPost) {
        record.reply = {
          parent: {
            uri: (hydratedPost as { reply: { parent: { uri: string } } }).reply
              .parent.uri,
            cid: (parentPost as { cid: string }).cid,
          },
          root: {
            uri: (hydratedPost as { reply: { root: { uri: string } } }).reply
              .root.uri,
            cid: (rootPost as { cid: string }).cid,
          },
        };
      }
    }

    const avatarUrl = (author as { avatarUrl?: string } | undefined)?.avatarUrl;
    const avatarCdn = avatarUrl
      ? avatarUrl.startsWith('http')
        ? avatarUrl
        : transformBlobToCdnUrl(
            avatarUrl,
            (author as { did: string }).did,
            'avatar',
            req
          )
      : undefined;

    // Ensure displayName is always a string
    const displayName =
      (author as { displayName?: string } | undefined)?.displayName &&
      typeof (author as { displayName: string }).displayName === 'string'
        ? (author as { displayName: string }).displayName
        : authorHandle;

    const postView: {
      $type: string;
      uri: string;
      cid: string;
      author: unknown;
      record: unknown;
      replyCount: number;
      repostCount: number;
      likeCount: number;
      bookmarkCount: number;
      quoteCount: number;
      indexedAt: string;
      labels: unknown;
      viewer: unknown;
      threadgate?: unknown;
      embed?: unknown;
    } = {
      $type: 'app.bsky.feed.defs#postView',
      uri: postObj.uri,
      cid: postObj.cid,
      author: {
        $type: 'app.bsky.actor.defs#profileViewBasic',
        did: postObj.authorDid,
        handle: authorHandle,
        displayName: displayName,
        pronouns: (author as { pronouns?: string } | undefined)?.pronouns,
        ...(avatarCdn &&
          typeof avatarCdn === 'string' &&
          avatarCdn.trim() !== '' && { avatar: avatarCdn }),
        viewer: actorViewerState || {},
        labels: authorLabels,
        createdAt: (
          author as { createdAt?: Date } | undefined
        )?.createdAt?.toISOString(),
      },
      record,
      replyCount:
        (aggregation as { replyCount?: number } | undefined)?.replyCount || 0,
      repostCount:
        (aggregation as { repostCount?: number } | undefined)?.repostCount || 0,
      likeCount:
        (aggregation as { likeCount?: number } | undefined)?.likeCount || 0,
      bookmarkCount:
        (aggregation as { bookmarkCount?: number } | undefined)
          ?.bookmarkCount || 0,
      quoteCount:
        (aggregation as { quoteCount?: number } | undefined)?.quoteCount || 0,
      indexedAt:
        (hydratedPost as { indexedAt?: string } | undefined)?.indexedAt ||
        postObj.indexedAt.toISOString(),
      labels: labels,
      viewer: viewerState
        ? {
            $type: 'app.bsky.feed.defs#viewerState',
            like: (viewerState as { likeUri?: string }).likeUri || undefined,
            repost:
              (viewerState as { repostUri?: string }).repostUri || undefined,
            bookmarked:
              (viewerState as { bookmarked?: boolean }).bookmarked || false,
            threadMuted:
              (viewerState as { threadMuted?: boolean }).threadMuted || false,
            replyDisabled:
              (viewerState as { replyDisabled?: boolean }).replyDisabled ||
              false,
            embeddingDisabled:
              (viewerState as { embeddingDisabled?: boolean })
                .embeddingDisabled || false,
            pinned: (viewerState as { pinned?: boolean }).pinned || false,
          }
        : {},
    };

    // Add thread gate if present
    if (threadGate) {
      postView.threadgate = {
        $type: 'app.bsky.feed.defs#threadgateView',
        uri: postObj.uri,
        cid: (hydratedPost as { cid?: string } | undefined)?.cid || postObj.cid,
        record: {
          $type: 'app.bsky.feed.threadgate',
          post: postObj.uri,
          allow: [
            ...((threadGate as { allowMentions?: boolean }).allowMentions
              ? [{ $type: 'app.bsky.feed.threadgate#mentionRule' }]
              : []),
            ...((threadGate as { allowFollowing?: boolean }).allowFollowing
              ? [{ $type: 'app.bsky.feed.threadgate#followingRule' }]
              : []),
            ...((threadGate as { allowListUris?: string[] }).allowListUris?.map(
              (uri: string) => ({
                $type: 'app.bsky.feed.threadgate#listRule',
                list: uri,
              })
            ) || []),
          ],
          createdAt:
            (threadGate as { createdAt?: string }).createdAt ||
            postObj.createdAt.toISOString(),
        },
        lists: (threadGate as { allowListUris?: string[] }).allowListUris || [],
      };
    }

    // Set the embed view - prioritize hydratedEmbed, but include record.embed as fallback
    if (hydratedEmbed) {
      // Transform relative URLs in embeds to full URIs
      postView.embed = transformEmbedUrls(hydratedEmbed, req);
    } else if (record.embed) {
      // If no hydratedEmbed but we have a record embed, use that
      // This ensures embeds are always available even if embed resolver didn't process them
      postView.embed = transformEmbedUrls(record.embed, req);
    }

    return postView;
  });

  // Filter out any null entries (e.g., from missing authors or other edge cases)
  return serializedPosts.filter((post) => post !== null);
}
