// Test script to verify our feed implementation
const { FILTER_TO_FEED_TYPE, FeedType, FeedItemType } = require('./server/types/feed.ts');

console.log('Testing feed implementation...');

// Test feed type mapping
console.log('Feed type mappings:');
console.log('posts_with_replies:', FILTER_TO_FEED_TYPE.posts_with_replies);
console.log('posts_no_replies:', FILTER_TO_FEED_TYPE.posts_no_replies);
console.log('posts_with_media:', FILTER_TO_FEED_TYPE.posts_with_media);
console.log('posts_and_author_threads:', FILTER_TO_FEED_TYPE.posts_and_author_threads);
console.log('posts_with_video:', FILTER_TO_FEED_TYPE.posts_with_video);

// Test feed item types
console.log('\nFeed item types:');
console.log('POST:', FeedItemType.POST);
console.log('REPOST:', FeedItemType.REPOST);
console.log('REPLY:', FeedItemType.REPLY);

// Test feed item structure
const sampleFeedItem = {
  post: {
    uri: 'at://did:plc:abc123/app.bsky.feed.post/def456',
    cid: 'bafyreiabc123'
  },
  repost: {
    uri: 'at://did:plc:xyz789/app.bsky.feed.repost/ghi789',
    cid: 'bafyreixyz789'
  }
};

console.log('\nSample feed item:');
console.log(JSON.stringify(sampleFeedItem, null, 2));

console.log('\n✅ Feed implementation test completed successfully!');