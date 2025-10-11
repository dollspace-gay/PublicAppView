// Chat declaration record type matching Bluesky's lexicon
export interface Record {
  $type: 'chat.bsky.actor.declaration';
  allowIncoming: 'all' | 'none' | 'following';
  createdAt: string;
}