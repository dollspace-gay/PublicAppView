import * as util from 'node:util';

/**
 * VideoUriBuilder - Builds video playlist and thumbnail URLs
 * Following Bluesky's implementation pattern
 */
export class VideoUriBuilder {
  private playlistUrlPattern: string;
  private thumbnailUrlPattern: string;

  constructor(opts?: {
    playlistUrlPattern?: string;
    thumbnailUrlPattern?: string;
  }) {
    // Default patterns based on typical video service URLs
    // These should be configured based on your video service endpoint
    const baseUrl =
      process.env.VIDEO_SERVICE_URL ||
      process.env.PUBLIC_URL ||
      (process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : '') ||
      (process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`
        : '');

    this.playlistUrlPattern =
      opts?.playlistUrlPattern || `${baseUrl}/vid/%s/%s/playlist.m3u8`;
    this.thumbnailUrlPattern =
      opts?.thumbnailUrlPattern || `${baseUrl}/vid/%s/%s/thumbnail.jpg`;
  }

  /**
   * Generate HLS playlist URL for a video
   */
  playlist({ did, cid }: { did: string; cid: string }): string {
    return util.format(
      this.playlistUrlPattern,
      encodeURIComponent(did),
      encodeURIComponent(cid)
    );
  }

  /**
   * Generate thumbnail URL for a video
   */
  thumbnail({ did, cid }: { did: string; cid: string }): string {
    return util.format(
      this.thumbnailUrlPattern,
      encodeURIComponent(did),
      encodeURIComponent(cid)
    );
  }
}
