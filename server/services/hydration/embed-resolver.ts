import { db } from '../../db';
import { posts, users } from '../../../shared/schema';
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
            record: { uri: recordUri } // Will be hydrated recursively
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
          record: recordUri ? { uri: recordUri } : undefined,
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

    // Recursively resolve child embeds
    if (childUris.length > 0 && depth < this.MAX_DEPTH - 1) {
      const childEmbeds = await this.resolveEmbeds(childUris, depth + 1, visited);
      
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
      playlist: '', // TODO: generate video playlist URL
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

  /**
   * Clear the embed cache
   */
  clearCache() {
    this.cache.clear();
  }
}
