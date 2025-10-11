// Repost record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.feed.repost';
  subject: {
    uri: string;
    cid: string;
  };
  createdAt: string;
}