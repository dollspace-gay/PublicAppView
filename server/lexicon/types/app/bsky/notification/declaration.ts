// Notification declaration record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.notification.declaration';
  allowSubscriptions: 'followers' | 'mutuals' | 'none';
  createdAt: string;
}