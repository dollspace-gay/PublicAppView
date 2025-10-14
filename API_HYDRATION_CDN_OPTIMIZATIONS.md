# API Endpoints, Post Hydration & CDN Optimization Plan

## Current Performance Bottlenecks Identified

### 1. Post Hydration Performance Issues

The current hydration process has several inefficiencies:

- **N+1 Query Problem**: Multiple separate queries for posts, authors, aggregations, viewer states, etc.
- **No Request-Level Caching**: Each API call re-hydrates the same posts multiple times
- **Inefficient Embed Resolution**: Recursive queries for embedded posts and media
- **Large Response Payloads**: Sending full hydrated data even when not needed

### 2. CDN/Image Proxy Issues

- **No Edge Caching**: Every image request proxies to Bluesky's CDN
- **No Image Optimization**: Serving original sizes without responsive variants
- **Missing HTTP/2 Push**: Images load sequentially instead of being pushed
- **No Compression**: Images served without WebP/AVIF optimization

### 3. API Response Time Issues

- **Synchronous Processing**: All hydration happens in the request cycle
- **No Response Streaming**: Large responses sent as single chunks
- **Missing ETags**: No conditional requests for unchanged data
- **Inefficient Serialization**: Multiple passes over data during transformation

## Optimization Recommendations

### 1. Implement Edge Caching for CDN

```typescript
// server/middleware/cdn-cache.ts
import { createHash } from 'crypto';

export const cdnCacheMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/img/')) return next();
  
  // Generate cache key
  const cacheKey = createHash('sha256')
    .update(req.path)
    .digest('hex');
  
  // Check Redis cache first
  const cached = await redis.getBuffer(cacheKey);
  if (cached) {
    const metadata = await redis.get(`${cacheKey}:meta`);
    const meta = JSON.parse(metadata || '{}');
    
    res.setHeader('Content-Type', meta.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached);
  }
  
  // Intercept response to cache it
  const originalSend = res.send;
  res.send = function(data) {
    if (res.statusCode === 200) {
      // Cache the image data
      redis.setBuffer(cacheKey, data, 'EX', 86400); // 24 hours
      redis.set(`${cacheKey}:meta`, JSON.stringify({
        contentType: res.getHeader('Content-Type')
      }), 'EX', 86400);
    }
    res.setHeader('X-Cache', 'MISS');
    return originalSend.call(this, data);
  };
  
  next();
};
```

### 2. Add Image Optimization Pipeline

```typescript
// server/services/image-optimizer.ts
import sharp from 'sharp';

export class ImageOptimizer {
  async optimizeImage(
    buffer: Buffer, 
    preset: string,
    format: string = 'webp'
  ): Promise<Buffer> {
    const sizes = {
      avatar: { width: 200, height: 200 },
      banner: { width: 1200, height: 400 },
      feed_thumbnail: { width: 600, height: 600 },
      feed_fullsize: { width: 1200, height: 1200 }
    };
    
    const size = sizes[preset] || sizes.feed_fullsize;
    
    return sharp(buffer)
      .resize(size.width, size.height, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .toFormat(format, {
        quality: format === 'webp' ? 85 : 90
      })
      .toBuffer();
  }
}

// Update blob proxy to use optimization
app.get("/img/:preset/plain/:did/:cidWithFormat", async (req, res) => {
  // ... existing validation ...
  
  // Check if client supports WebP
  const acceptsWebP = req.headers.accept?.includes('image/webp');
  const outputFormat = acceptsWebP ? 'webp' : format;
  
  // Try cache with format-specific key
  const cacheKey = `img:${preset}:${did}:${cid}:${outputFormat}`;
  const cached = await redis.getBuffer(cacheKey);
  
  if (cached) {
    res.setHeader('Content-Type', `image/${outputFormat}`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached);
  }
  
  // Fetch from CDN
  const response = await fetch(cdnUrl);
  const buffer = Buffer.from(await response.arrayBuffer());
  
  // Optimize image
  const optimized = await imageOptimizer.optimizeImage(buffer, preset, outputFormat);
  
  // Cache optimized version
  await redis.setBuffer(cacheKey, optimized, 'EX', 604800); // 7 days
  
  res.setHeader('Content-Type', `image/${outputFormat}`);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Cache', 'MISS');
  res.send(optimized);
});
```

### 3. Optimize Post Hydration with Dataloader Pattern

```typescript
// server/services/hydration/post-dataloader.ts
import DataLoader from 'dataloader';

export class PostHydrationDataLoader {
  private postLoader: DataLoader<string, any>;
  private authorLoader: DataLoader<string, any>;
  private aggregationLoader: DataLoader<string, any>;
  private viewerStateLoader: DataLoader<{ uri: string, viewerDid: string }, any>;
  
  constructor() {
    // Batch and cache post loads
    this.postLoader = new DataLoader(async (uris) => {
      const posts = await db
        .select()
        .from(posts)
        .where(inArray(posts.uri, uris as string[]));
      
      const postMap = new Map(posts.map(p => [p.uri, p]));
      return uris.map(uri => postMap.get(uri));
    });
    
    // Batch author loads
    this.authorLoader = new DataLoader(async (dids) => {
      const authors = await db
        .select()
        .from(users)
        .where(inArray(users.did, dids as string[]));
      
      const authorMap = new Map(authors.map(a => [a.did, a]));
      return dids.map(did => authorMap.get(did));
    });
    
    // Batch aggregation loads
    this.aggregationLoader = new DataLoader(async (uris) => {
      const aggs = await db
        .select()
        .from(postAggregations)
        .where(inArray(postAggregations.postUri, uris as string[]));
      
      const aggMap = new Map(aggs.map(a => [a.postUri, a]));
      return uris.map(uri => aggMap.get(uri) || { 
        postUri: uri, 
        likeCount: 0, 
        repostCount: 0, 
        replyCount: 0 
      });
    });
  }
  
  async hydratePost(uri: string, viewerDid?: string): Promise<HydratedPost> {
    // All these will be batched automatically
    const [post, aggregation] = await Promise.all([
      this.postLoader.load(uri),
      this.aggregationLoader.load(uri)
    ]);
    
    if (!post) return null;
    
    const author = await this.authorLoader.load(post.authorDid);
    
    // Viewer state if needed
    let viewerState = null;
    if (viewerDid) {
      viewerState = await this.viewerStateLoader.load({ uri, viewerDid });
    }
    
    return { post, author, aggregation, viewerState };
  }
}
```

### 4. Implement Response Streaming for Large Responses

```typescript
// server/services/streaming-response.ts
export class StreamingJsonResponse {
  static async streamArray(
    res: Response,
    items: any[],
    transformer: (item: any) => Promise<any>
  ) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Transfer-Encoding', 'chunked');
    
    // Start array
    res.write('{"posts":[');
    
    for (let i = 0; i < items.length; i++) {
      if (i > 0) res.write(',');
      
      const transformed = await transformer(items[i]);
      res.write(JSON.stringify(transformed));
      
      // Flush every 10 items
      if (i % 10 === 0) {
        res.flush();
      }
    }
    
    // Close array and object
    res.write(']}');
    res.end();
  }
}

// Use in getPosts endpoint
async getPosts(req: Request, res: Response) {
  const params = getPostsSchema.parse(req.query);
  const posts = await storage.getPosts(params.uris);
  
  // Stream large responses
  if (posts.length > 50) {
    const dataLoader = new PostHydrationDataLoader();
    
    await StreamingJsonResponse.streamArray(
      res,
      posts,
      async (post) => {
        const hydrated = await dataLoader.hydratePost(post.uri, viewerDid);
        return this.serializePost(hydrated);
      }
    );
  } else {
    // Regular response for small payloads
    const serialized = await this.serializePosts(posts, viewerDid, req);
    res.json({ posts: serialized });
  }
}
```

### 5. Add ETag Support for Conditional Requests

```typescript
// server/middleware/etag-support.ts
export const etagMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    // Generate ETag from response data
    const hash = createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .substring(0, 16);
    
    const etag = `"${hash}"`;
    res.setHeader('ETag', etag);
    
    // Check if client has matching ETag
    const clientETag = req.headers['if-none-match'];
    if (clientETag === etag) {
      return res.status(304).end();
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};
```

### 6. Implement Partial Response Fields

```typescript
// Allow clients to request only specific fields
const getPostsSchema = z.object({
  uris: z.array(z.string()),
  fields: z.string().optional() // e.g., "uri,text,author.handle,likeCount"
});

async getPosts(req: Request, res: Response) {
  const params = getPostsSchema.parse(req.query);
  const fields = params.fields?.split(',') || [];
  
  // Optimize query based on requested fields
  if (fields.length > 0) {
    const needsAuthor = fields.some(f => f.startsWith('author.'));
    const needsAggregation = fields.some(f => 
      ['likeCount', 'repostCount', 'replyCount'].includes(f)
    );
    
    // Only hydrate what's needed
    const posts = await storage.getPostsPartial(
      params.uris,
      { includeAuthor: needsAuthor, includeAggregation: needsAggregation }
    );
    
    // Return only requested fields
    const filtered = posts.map(post => 
      this.filterFields(post, fields)
    );
    
    res.json({ posts: filtered });
  }
}
```

### 7. Implement Background Pre-warming

```typescript
// server/services/cache-warmer.ts
export class CacheWarmer {
  async warmPopularPosts() {
    // Get most liked/reposted posts from last 24h
    const popularPosts = await db
      .select({ 
        uri: posts.uri,
        score: sql`${postAggregations.likeCount} + ${postAggregations.repostCount} * 2`
      })
      .from(posts)
      .innerJoin(postAggregations, eq(posts.uri, postAggregations.postUri))
      .where(gte(posts.createdAt, new Date(Date.now() - 86400000)))
      .orderBy(desc(sql`score`))
      .limit(100);
    
    // Pre-hydrate and cache
    const hydrator = new OptimizedHydrator();
    for (const post of popularPosts) {
      await hydrator.hydratePosts([post.uri]);
    }
  }
  
  async warmUserTimelines() {
    // Get active users
    const activeUsers = await db
      .select({ did: users.did })
      .from(users)
      .where(gte(users.lastSeenAt, new Date(Date.now() - 3600000)))
      .limit(50);
    
    // Pre-warm their timeline queries
    for (const user of activeUsers) {
      const timelinePosts = await storage.getTimeline(user.did, 20);
      await hydrator.hydratePosts(
        timelinePosts.map(p => p.uri),
        user.did
      );
    }
  }
}

// Run every 5 minutes
setInterval(() => {
  cacheWarmer.warmPopularPosts();
  cacheWarmer.warmUserTimelines();
}, 300000);
```

## Expected Performance Improvements

1. **API Response Times**: 50-70% reduction
   - Dataloader batching eliminates N+1 queries
   - Request-level caching prevents duplicate work
   - Streaming responses improve perceived performance

2. **CDN Performance**: 80-90% improvement
   - Edge caching eliminates proxy overhead
   - Image optimization reduces payload sizes by 40-60%
   - WebP support provides additional 25-30% size reduction

3. **Hydration Speed**: 60-80% faster
   - Parallel queries via DataLoader
   - Redis caching for hot data
   - Partial hydration for specific use cases

4. **Bandwidth Usage**: 50-70% reduction
   - Compressed images
   - Partial responses
   - ETag/304 responses

## Implementation Priority

1. **Week 1**: DataLoader implementation (highest impact)
2. **Week 1**: Redis caching for CDN
3. **Week 2**: Image optimization pipeline
4. **Week 2**: ETag support
5. **Week 3**: Response streaming
6. **Week 3**: Partial field selection
7. **Week 4**: Background cache warming

## Monitoring

Add metrics for:
- Cache hit rates
- Query execution times
- Response sizes
- Image optimization savings
- 304 response rates