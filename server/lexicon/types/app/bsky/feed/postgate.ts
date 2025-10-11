// Postgate record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.feed.postgate';
  post: string;
  embeddingRules?: {
    allow?: Array<
      | {
          $type: 'app.bsky.feed.postgate#disableRule';
        }
    >;
  };
  createdAt: string;
}