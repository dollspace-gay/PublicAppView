// Profile record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.actor.profile';
  displayName?: string;
  description?: string;
  avatar?: BlobRef;
  banner?: BlobRef;
  pronouns?: string;
  website?: string;
  joinedViaStarterPack?: {
    uri: string;
    cid: string;
  };
  pinnedPost?: {
    uri: string;
    cid: string;
  };
  labels?: {
    $type: 'com.atproto.label.defs#selfLabels';
    values: Array<{
      $type: 'com.atproto.label.defs#selfLabel';
      val: string;
    }>;
  };
}

export interface BlobRef {
  $type: 'blob';
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
}