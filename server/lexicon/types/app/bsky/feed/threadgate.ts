// Threadgate record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.feed.threadgate';
  post: string;
  allow?: Array<
    | {
        $type: 'app.bsky.feed.threadgate#mentionRule';
      }
    | {
        $type: 'app.bsky.feed.threadgate#followingRule';
      }
    | {
        $type: 'app.bsky.feed.threadgate#listRule';
        list: string;
      }
  >;
  createdAt: string;
}