// Feed generator record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.feed.generator';
  did: string;
  displayName: string;
  description?: string;
  descriptionFacets?: Array<{
    index: {
      byteStart: number;
      byteEnd: number;
    };
    features: Array<
      | {
          $type: 'app.bsky.richtext.facet#mention';
          did: string;
        }
      | {
          $type: 'app.bsky.richtext.facet#link';
          uri: string;
        }
      | {
          $type: 'app.bsky.richtext.facet#tag';
          tag: string;
        }
    >;
  }>;
  avatar?: BlobRef;
  acceptsInteractions?: boolean;
  contentMode?: 'adult' | 'general';
  labels?: {
    $type: 'com.atproto.label.defs#selfLabels';
    values: Array<{
      $type: 'com.atproto.label.defs#selfLabel';
      val: string;
    }>;
  };
  createdAt: string;
}

export interface BlobRef {
  $type: 'blob';
  ref: {
    $link: string;
  };
  mimeType: string;
  size: number;
}