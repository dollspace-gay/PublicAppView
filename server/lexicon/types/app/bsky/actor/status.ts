// Status record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.actor.status';
  status: 'app.bsky.actor.status#live' | string;
  record: { [key: string]: unknown };
  embed?: {
    $type: 'app.bsky.embed.external';
    external: {
      uri: string;
      title: string;
      description: string;
      thumb?: BlobRef;
    };
  };
  expiresAt?: string;
}

export interface BlobRef {
  $type: 'blob';
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
}