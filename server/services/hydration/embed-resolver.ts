import { db } from '../../db';
import { posts, users, postAggregations } from '../../../shared/schema';
import { eq, inArray } from 'drizzle-orm';

export interface ResolvedEmbed {
  $type: string;
  [key: string]: any;
}

export class EmbedResolver {
  private readonly MAX_DEPTH = 3;
  private cache = new Map<string, ResolvedEmbed | null>();

  /**
   * Resolve embeds recursively up to MAX_DEPTH levels
   * Handles circular reference detection
   */
  async resolveEmbeds(
    postUris: string[],
    depth = 0,
    visited = new Set<string>()
  ): Promise<Map<string, ResolvedEmbed | null>> {
    if (depth >= this.MAX_DEPTH || postUris.length === 0) {
      return new Map();
    }

    // Filter out already visited URIs (circular reference protection)
    const newUris = postUris.filter(uri => !visited.has(uri));
    if (newUris.length === 0) {
      return new Map();
    }

    // Mark all URIs as visited
    newUris.forEach(uri => visited.add(uri));

    // Check cache first
    const uncachedUris = newUris.filter(uri => !this.cache.has(uri));
    
    if (uncachedUris.length === 0) {
      const result = new Map();
      newUris.forEach(uri => {
        result.set(uri, this.cache.get(uri) || null);
      });
      return result;
    }

    // Fetch posts with embeds
    const postsData = await db
      .select()
      .from(posts)
      .where(inArray(posts.uri, uncachedUris));

    const result = new Map<string, ResolvedEmbed | null>();
    const childUris: string[] = [];

    for (const post of postsData) {
      if (!post.embed) {
        result.set(post.uri, null);
        this.cache.set(post.uri, null);
        continue;
      }

      const embed = post.embed as any;
      let resolved: ResolvedEmbed | null = null;

      // Handle different embed types
      if (embed.$type === 'app.bsky.embed.record') {
        // Quote post or record embed
        const recordUri = embed.record?.uri;
        if (recordUri) {
          childUris.push(recordUri);
          resolved = {
            $type: 'app.bsky.embed.record#view',
            record: {
              $type: 'app.bsky.embed.record#viewNotFound',  // Placeholder, will be hydrated
              uri: recordUri,
              notFound: true
            }
          };
        }
      } else if (embed.$type === 'app.bsky.embed.recordWithMedia') {
        // Quote with media
        const recordUri = embed.record?.record?.uri;
        if (recordUri) {
          childUris.push(recordUri);
        }
        resolved = {
          $type: 'app.bsky.embed.recordWithMedia#view',
          record: recordUri ? {
            $type: 'app.bsky.embed.record#viewNotFound',  // Placeholder, will be hydrated
            uri: recordUri,
            notFound: true
          } : undefined,
          media: this.resolveMediaEmbed(embed.media, post.authorDid)
        };
      } else if (embed.$type === 'app.bsky.embed.images') {
        // Images
        resolved = this.resolveImagesEmbed(embed, post.authorDid);
      } else if (embed.$type === 'app.bsky.embed.external') {
        // External link
        resolved = this.resolveExternalEmbed(embed, post.authorDid);
      } else if (embed.$type === 'app.bsky.embed.video') {
        // Video
        resolved = this.resolveVideoEmbed(embed, post.authorDid);
      }

      result.set(post.uri, resolved);
      this.cache.set(post.uri, resolved);
    }

    // Fetch full post data for embedded records
    if (childUris.length > 0 && depth < this.MAX_DEPTH - 1) {
      const childPosts = await db
        .select()
        .from(posts)
        .leftJoin(users, eq(posts.authorDid, users.did))
        .leftJoin(postAggregations, eq(posts.uri, postAggregations.postUri))
        .where(inArray(posts.uri, childUris));
      
      const childEmbeds = new Map<string, any>();
      
      // Collect reply URIs to fetch their CIDs
      const replyUris = new Set<string>();
      for (const { posts: post } of childPosts) {
        if (post?.parentUri) replyUris.add(post.parentUri);
        if (post?.rootUri) replyUris.add(post.rootUri);
      }
      
      // Fetch CIDs for parent/root posts if needed
      const replyCids = new Map<string, string>();
      if (replyUris.size > 0) {
        const replyPosts = await db
          .select({ uri: posts.uri, cid: posts.cid })
          .from(posts)
          .where(inArray(posts.uri, Array.from(replyUris)));
        
        for (const rp of replyPosts) {
          replyCids.set(rp.uri, rp.cid);
        }
      }
      
      const childPostEmbedUris: string[] = [];
      const childViewRecords: any[] = [];
      
      for (const { posts: post, users: author, post_aggregations: agg } of childPosts) {
        if (!post) continue;
        
        // Build author object - omit fields that are missing rather than using empty strings
        const authorView: any = {
          did: author?.did || post.authorDid
        };
        if (author?.handle) authorView.handle = author.handle;
        if (author?.displayName) authorView.displayName = author.displayName;
        if (author?.avatarUrl) {
          // Transform avatar CID to CDN URL (avatarUrl is already just the CID string from database)
          authorView.avatar = author.avatarUrl.startsWith('http') 
            ? author.avatarUrl 
            : this.directCidToCdnUrl(author.avatarUrl, author.did, 'avatar');
        }
        
        // Construct full record value following app.bsky.feed.post schema
        const recordValue: any = {
          $type: 'app.bsky.feed.post',
          text: post.text || '',
          createdAt: post.createdAt?.toISOString() || post.indexedAt?.toISOString()
        };
        
        // Include reply object with proper CIDs (only if CIDs are available)
        if (post.parentUri) {
          const rootUri = post.rootUri || post.parentUri;
          const rootCid = replyCids.get(rootUri);
          const parentCid = replyCids.get(post.parentUri);
          
          // Only include reply if we have the required CIDs
          if (rootCid && parentCid) {
            recordValue.reply = {
              root: { uri: rootUri, cid: rootCid },
              parent: { uri: post.parentUri, cid: parentCid }
            };
          }
        }
        
        // Include tags if present
        if (post.tags && Array.isArray(post.tags) && post.tags.length > 0) {
          recordValue.tags = post.tags;
        }
        
        // Include RAW embed in record value (lexical form, not hydrated view)
        if (post.embed) {
          recordValue.embed = post.embed;
        }
        
        // Create viewRecord structure following AT Protocol spec
        const viewRecord: any = {
          $type: 'app.bsky.embed.record#viewRecord',
          uri: post.uri,
          cid: post.cid,
          author: authorView,
          value: recordValue,
          indexedAt: post.indexedAt?.toISOString(),
          likeCount: agg?.likeCount || 0,
          replyCount: agg?.replyCount || 0,
          repostCount: agg?.repostCount || 0,
          quoteCount: agg?.quoteCount || 0
        };
        
        // Track if this child post has embeds for recursive resolution
        if (post.embed && depth + 1 < this.MAX_DEPTH) {
          childPostEmbedUris.push(post.uri);
        }
        
        childEmbeds.set(post.uri, viewRecord);
        childViewRecords.push({ uri: post.uri, viewRecord });
      }
      
      // Recursively resolve embeds in child posts (for quote-of-quote scenarios)
      if (childPostEmbedUris.length > 0) {
        const nestedEmbeds = await this.resolveEmbeds(childPostEmbedUris, depth + 1, visited);
        
        // Attach HYDRATED view embeds to viewRecords.embeds array (not value.embed)
        for (const { uri, viewRecord } of childViewRecords) {
          if (nestedEmbeds.has(uri)) {
            const resolved = nestedEmbeds.get(uri);
            if (resolved) {
              // Add hydrated view to embeds array
              viewRecord.embeds = [resolved];
            }
          }
        }
      }
      
      // Update parent embeds with resolved children
      for (const [uri, embed] of Array.from(result.entries())) {
        if (embed && embed.$type === 'app.bsky.embed.record#view') {
          const recordUri = embed.record?.uri;
          if (recordUri && childEmbeds.has(recordUri)) {
            embed.record = childEmbeds.get(recordUri);
          }
        } else if (embed && embed.$type === 'app.bsky.embed.recordWithMedia#view') {
          const recordUri = embed.record?.uri;
          if (recordUri && childEmbeds.has(recordUri)) {
            embed.record = childEmbeds.get(recordUri);
          }
        }
      }
    }

    return result;
  }

  private resolveImagesEmbed(embed: any, authorDid: string): ResolvedEmbed {
    return {
      $type: 'app.bsky.embed.images#view',
      images: (embed.images || []).map((img: any) => ({
        thumb: this.blobToCdnUrl(img.image, authorDid, 'feed_thumbnail'),
        fullsize: this.blobToCdnUrl(img.image, authorDid, 'feed_fullsize'),
        alt: img.alt || '',
        aspectRatio: img.aspectRatio
      }))
    };
  }

  private resolveExternalEmbed(embed: any, authorDid: string): ResolvedEmbed {
    return {
      $type: 'app.bsky.embed.external#view',
      external: {
        uri: embed.external?.uri || '',
        title: embed.external?.title || '',
        description: embed.external?.description || '',
        thumb: embed.external?.thumb ? this.blobToCdnUrl(embed.external.thumb, authorDid, 'feed_thumbnail') : undefined
      }
    };
  }

  private resolveVideoEmbed(embed: any, authorDid: string): ResolvedEmbed {
    return {
      $type: 'app.bsky.embed.video#view',
      cid: embed.video?.ref?.$link || '',
      playlist: undefined, // Video playlist URLs not yet implemented
      thumbnail: embed.thumbnail ? this.blobToCdnUrl(embed.thumbnail, authorDid, 'feed_thumbnail') : undefined,
      alt: embed.alt || '',
      aspectRatio: embed.aspectRatio
    };
  }

  private resolveMediaEmbed(media: any, authorDid: string): any {
    if (!media) return undefined;

    if (media.$type === 'app.bsky.embed.images') {
      return this.resolveImagesEmbed(media, authorDid);
    } else if (media.$type === 'app.bsky.embed.external') {
      return this.resolveExternalEmbed(media, authorDid);
    } else if (media.$type === 'app.bsky.embed.video') {
      return this.resolveVideoEmbed(media, authorDid);
    }

    return undefined;
  }

  private blobToCdnUrl(blob: any, did: string, preset: 'feed_thumbnail' | 'feed_fullsize' | 'avatar' | 'banner' = 'feed_thumbnail'): string {
    if (!blob || !blob.ref) return '';
    const cid = typeof blob.ref === 'string' ? blob.ref : blob.ref.$link;
    
    // Check for the string "undefined" which can happen with improper data extraction
    if (!cid || cid === 'undefined') return '';
    
    // Follow Bluesky AppView pattern: config.cdnUrl || `${config.publicUrl}/img`
    // IMG_URI_ENDPOINT is our cdnUrl (custom CDN endpoint)
    // PUBLIC_URL is our publicUrl (base URL of the application)
    const endpoint = process.env.IMG_URI_ENDPOINT || 
                     (process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/img` : null) ||
                     (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/img` : null) ||
                     (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}/img` : null);
    
    if (!endpoint) {
      console.error('[EMBED_RESOLVER] No PUBLIC_URL or IMG_URI_ENDPOINT configured - image URLs will fail AT Protocol validation');
      return '';
    }
    
    return `${endpoint}/${preset}/plain/${did}/${cid}@jpeg`;
  }
  
  // Transform a plain CID string (as stored in database) to CDN URL
  private directCidToCdnUrl(cid: string, did: string, preset: 'feed_thumbnail' | 'feed_fullsize' | 'avatar' | 'banner' = 'feed_thumbnail'): string {
    // Check for falsy values and the literal string "undefined"
    if (!cid || cid === 'undefined') return '';
    
    const endpoint = process.env.IMG_URI_ENDPOINT || 
                     (process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL}/img` : null) ||
                     (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/img` : null) ||
                     (process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}/img` : null);
    
    if (!endpoint) {
      console.error('[EMBED_RESOLVER] No PUBLIC_URL or IMG_URI_ENDPOINT configured - image URLs will fail AT Protocol validation');
      return '';
    }
    
    return `${endpoint}/${preset}/plain/${did}/${cid}@jpeg`;
  }

  /**
   * Clear the embed cache
   */
  clearCache() {
    this.cache.clear();
  }
}
