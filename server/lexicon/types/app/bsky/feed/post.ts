// Post record type matching Bluesky's lexicon
export interface Record {
  $type: 'app.bsky.feed.post';
  text: string;
  reply?: {
    root: {
      uri: string;
      cid: string;
    };
    parent: {
      uri: string;
      cid: string;
    };
  };
  embed?: 
    | {
        $type: 'app.bsky.embed.images';
        images: Array<{
          image: BlobRef;
          alt?: string;
          aspectRatio?: number;
        }>;
      }
    | {
        $type: 'app.bsky.embed.video';
        video: BlobRef;
        alt?: string;
        aspectRatio?: number;
      }
    | {
        $type: 'app.bsky.embed.external';
        external: {
          uri: string;
          title: string;
          description: string;
          thumb?: BlobRef;
        };
      }
    | {
        $type: 'app.bsky.embed.record';
        record: {
          uri: string;
          cid: string;
        };
      }
    | {
        $type: 'app.bsky.embed.recordWithMedia';
        record: {
          $type: 'app.bsky.embed.record';
          record: {
            uri: string;
            cid: string;
          };
        };
        media: 
          | {
              $type: 'app.bsky.embed.images';
              images: Array<{
                image: BlobRef;
                alt?: string;
                aspectRatio?: number;
              }>;
            }
          | {
              $type: 'app.bsky.embed.video';
              video: BlobRef;
              alt?: string;
              aspectRatio?: number;
            }
          | {
              $type: 'app.bsky.embed.external';
              external: {
                uri: string;
                title: string;
                description: string;
                thumb?: BlobRef;
              };
            };
      };
  facets?: Array<{
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
  labels?: {
    $type: 'com.atproto.label.defs#selfLabels';
    values: Array<{
      $type: 'com.atproto.label.defs#selfLabel';
      val: string;
    }>;
  };
  tags?: string[];
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