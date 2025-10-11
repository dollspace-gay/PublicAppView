import { db } from '../../db';
import { labels, users } from '../../../shared/schema';
import { inArray, eq, or, and } from 'drizzle-orm';

export interface Label {
  $type: 'com.atproto.label.defs#label';
  src: string;
  uri: string;
  cid?: string;
  val: string;
  neg?: boolean;
  cts: string;
  exp?: string;
}

export interface Takedown {
  isTakendown: boolean;
  reason?: string;
}

export class LabelPropagator {
  /**
   * Fetch labels for a set of subjects (posts, actors, etc.)
   */
  async getLabels(subjects: string[]): Promise<Map<string, Label[]>> {
    if (subjects.length === 0) return new Map();

    const labelsData = await db
      .select()
      .from(labels)
      .where(inArray(labels.subject, subjects));

    const result = new Map<string, Label[]>();

    for (const label of labelsData) {
      const existing = result.get(label.subject) || [];
      existing.push({
        $type: 'com.atproto.label.defs#label',
        src: label.src,
        uri: label.subject,
        cid: undefined, // CID not stored in current schema
        val: label.val,
        neg: label.neg || undefined,
        cts: label.createdAt.toISOString(),
        exp: undefined // Expiration not in current schema
      });
      result.set(label.subject, existing);
    }

    return result;
  }

  /**
   * Check if content is taken down based on labels
   */
  checkTakedown(labels: Label[]): Takedown {
    if (!labels || labels.length === 0) {
      return { isTakendown: false };
    }

    // Check for takedown labels
    const takedownLabel = labels.find(l => 
      l.val === '!takedown' || 
      l.val === '!suspend' ||
      l.val === 'dmca-violation'
    );

    if (takedownLabel) {
      return {
        isTakendown: true,
        reason: takedownLabel.val
      };
    }

    return { isTakendown: false };
  }

  /**
   * Filter content based on moderation labels and viewer preferences
   */
  shouldFilter(
    labels: Label[],
    viewerPreferences?: any
  ): { shouldHide: boolean; reason?: string } {
    if (!labels || labels.length === 0) {
      return { shouldHide: false };
    }

    // Always filter takedowns
    const takedown = this.checkTakedown(labels);
    if (takedown.isTakendown) {
      return { shouldHide: true, reason: 'takedown' };
    }

    // Check for NSFW/adult content labels
    const nsfwLabels = labels.filter(l => 
      l.val === 'porn' || 
      l.val === 'sexual' || 
      l.val === 'nudity' ||
      l.val === 'graphic-media'
    );

    if (nsfwLabels.length > 0) {
      // Check viewer preferences
      const hideNsfw = viewerPreferences?.adultContentEnabled === false;
      if (hideNsfw) {
        return { shouldHide: true, reason: 'nsfw' };
      }
    }

    // Check for spam
    const spamLabels = labels.filter(l => l.val === 'spam');
    if (spamLabels.length > 0) {
      return { shouldHide: true, reason: 'spam' };
    }

    return { shouldHide: false };
  }

  /**
   * Propagate labels from actors to their content
   * If an actor is labeled, their content inherits those labels
   */
  async propagateActorLabels(
    actorDids: string[],
    contentUris: string[]
  ): Promise<Map<string, Label[]>> {
    if (actorDids.length === 0 || contentUris.length === 0) {
      return new Map();
    }

    // Get actor labels
    const actorLabels = await this.getLabels(actorDids);
    
    // Get content labels
    const contentLabels = await this.getLabels(contentUris);

    // Build content URI to actor DID mapping
    const contentToActor = new Map<string, string>();
    
    // Extract actor DID from content URI (at://did/collection/rkey)
    for (const uri of contentUris) {
      const match = uri.match(/^at:\/\/([^/]+)\//);
      if (match) {
        contentToActor.set(uri, match[1]);
      }
    }

    // Propagate actor labels to content
    const result = new Map<string, Label[]>();
    
    for (const uri of contentUris) {
      const actorDid = contentToActor.get(uri);
      const contentLabelsList = contentLabels.get(uri) || [];
      const actorLabelsList = actorDid ? (actorLabels.get(actorDid) || []) : [];
      
      // Combine content and actor labels (content labels take precedence)
      const combined = [...contentLabelsList, ...actorLabelsList];
      
      // Remove duplicates
      const unique = Array.from(
        new Map(combined.map(l => [`${l.src}:${l.val}`, l])).values()
      );
      
      result.set(uri, unique);
    }

    return result;
  }

  /**
   * Filter a list of content URIs based on moderation rules
   * Returns only URIs that should be shown
   */
  async filterContent(
    contentUris: string[],
    viewerPreferences?: any
  ): Promise<Set<string>> {
    const actorDids = contentUris
      .map(uri => {
        const match = uri.match(/^at:\/\/([^/]+)\//);
        return match ? match[1] : null;
      })
      .filter(Boolean) as string[];

    const allLabels = await this.propagateActorLabels(actorDids, contentUris);
    const allowed = new Set<string>();

    for (const uri of contentUris) {
      const labels = allLabels.get(uri) || [];
      const filter = this.shouldFilter(labels, viewerPreferences);
      
      if (!filter.shouldHide) {
        allowed.add(uri);
      }
    }

    return allowed;
  }
}
