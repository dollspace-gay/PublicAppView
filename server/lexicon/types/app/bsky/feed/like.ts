// Like record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.feed.like';
  subject: {
    uri: string;
    cid: string;
  };
  createdAt: string;
}