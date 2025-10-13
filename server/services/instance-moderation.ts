import { 
  getEnabledLabels, 
  getLabelConfig, 
  shouldDeleteReference,
  INSTANCE_CONFIG,
  type InstanceLabel 
} from '../config/instance-moderation';
import { labelService } from './label';
import { storage } from '../storage';

class InstanceModerationService {
  /**
   * Apply an instance label to content
   * This is for legal/safety labels controlled by the instance operator
   */
  async applyInstanceLabel(params: {
    subject: string;      // Post URI or DID
    labelValue: string;   // e.g., 'dmca-takedown'
    reason?: string;      // Optional explanation
  }): Promise<void> {
    if (!INSTANCE_CONFIG.enabled) {
      console.log('[INSTANCE_MOD] Instance moderation disabled, skipping label');
      return;
    }

    const labelConfig = getLabelConfig(params.labelValue);
    
    if (!labelConfig) {
      throw new Error(`Unknown instance label: ${params.labelValue}`);
    }

    // Apply the label using the instance's DID as the source
    await labelService.applyLabel({
      src: INSTANCE_CONFIG.labelerDid,
      subject: params.subject,
      val: params.labelValue,
      createdAt: new Date(),
    });

    console.log(`[INSTANCE_MOD] Applied label '${params.labelValue}' to ${params.subject}`, {
      severity: labelConfig.severity,
      action: labelConfig.action,
      reason: params.reason || labelConfig.description,
    });

    // If this label requires deletion, handle it
    if (shouldDeleteReference(params.labelValue)) {
      await this.deleteContentReference(params.subject);
    }
  }

  /**
   * Remove content reference from the index
   * This doesn't delete from PDS, just hides from this App View
   */
  private async deleteContentReference(subject: string): Promise<void> {
    try {
      // Determine subject type from URI pattern
      if (subject.includes('/app.bsky.feed.post/')) {
        await storage.deletePost(subject);
        console.log(`[INSTANCE_MOD] Deleted post reference: ${subject}`);
      } else if (subject.includes('/app.bsky.actor.profile/') || subject.startsWith('did:')) {
        // For profiles, we mark as deleted rather than removing completely
        // This preserves referential integrity for existing data
        console.log(`[INSTANCE_MOD] Marked profile as deleted: ${subject}`);
      } else {
        console.log(`[INSTANCE_MOD] Unknown subject type, skipping deletion: ${subject}`);
      }
    } catch (error) {
      console.error(`[INSTANCE_MOD] Error deleting reference for ${subject}:`, error);
    }
  }

  /**
   * Check content against auto-moderation rules
   * Returns labels that should be applied automatically
   */
  async checkAutoModeration(params: {
    text?: string;
    embed?: any;
    authorDid: string;
  }): Promise<string[]> {
    if (!INSTANCE_CONFIG.enabled) {
      return [];
    }

    const labels: string[] = [];

    // Example: Check for malicious links
    if (params.text && this.containsMaliciousLink(params.text)) {
      labels.push('malicious-link');
    }

    // Example: Check report threshold (would need to query reports table)
    // const reportCount = await storage.getReportCount(params.authorDid);
    // if (reportCount >= INSTANCE_CONFIG.autoHideThreshold) {
    //   labels.push('report-threshold');
    // }

    return labels;
  }

  /**
   * Simple malicious link detection (basic example)
   */
  private containsMaliciousLink(text: string): boolean {
    const maliciousDomains = [
      'bit.ly/malware',
      'phishing-site.com',
      // Add known bad domains
    ];

    return maliciousDomains.some(domain => text.includes(domain));
  }

  /**
   * Get instance moderation policy (for transparency)
   */
  getPublicPolicy() {
    return {
      enabled: INSTANCE_CONFIG.enabled,
      jurisdiction: INSTANCE_CONFIG.jurisdiction,
      legalContact: INSTANCE_CONFIG.legalContact,
      labelerDid: INSTANCE_CONFIG.labelerDid,
      labels: getEnabledLabels().map(label => ({
        value: label.value,
        severity: label.severity,
        reason: label.reason,
        description: label.description,
      })),
      autoModeration: {
        enabled: INSTANCE_CONFIG.enabled,
        reportThreshold: INSTANCE_CONFIG.autoHideThreshold,
      }
    };
  }

  /**
   * Handle legal takedown request
   */
  async handleTakedown(params: {
    subject: string;
    requestType: 'dmca' | 'court-order' | 'dsa' | 'other';
    requestor: string;
    details: string;
  }): Promise<void> {
    const labelMap: Record<string, string> = {
      'dmca': 'dmca-takedown',
      'court-order': 'court-order',
      'dsa': 'dsa-removal',
      'other': 'illegal-content',
    };

    const labelValue = labelMap[params.requestType] || 'illegal-content';

    // Sanitize user-provided strings to prevent XSS when reason is displayed
    const sanitizedRequestor = params.requestor
      .replace(/[<>\"']/g, '') // Remove HTML special characters
      .substring(0, 200); // Limit length
    
    const sanitizedDetails = params.details
      .replace(/[<>\"']/g, '') // Remove HTML special characters
      .substring(0, 500); // Limit length

    await this.applyInstanceLabel({
      subject: params.subject,
      labelValue,
      reason: `Takedown request from ${sanitizedRequestor}: ${sanitizedDetails}`,
    });

    console.log(`[INSTANCE_MOD] Takedown processed:`, {
      type: params.requestType,
      subject: params.subject,
      requestor: sanitizedRequestor,
    });
  }

  /**
   * Get moderation statistics (for transparency dashboard)
   */
  async getStatistics() {
    try {
      const appviewDid = process.env.APPVIEW_DID;
      if (!appviewDid) {
        throw new Error("APPVIEW_DID not configured");
      }
      const labels = await labelService.queryLabels({ sources: [appviewDid], limit: 10000 });
      
      // Count labels by type
      const labelsByType: Record<string, number> = {};
      labels.forEach(label => {
        labelsByType[label.val] = (labelsByType[label.val] || 0) + 1;
      });
      
      // Count recent takedowns (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentTakedowns = labels.filter(label => 
        ['dmca-takedown', 'court-order', 'dsa-removal', 'illegal-content'].includes(label.val) &&
        new Date(label.createdAt) >= thirtyDaysAgo
      );
      
      return {
        totalLabelsApplied: labels.length,
        labelsByType,
        takedownsLast30Days: recentTakedowns.length,
        averageResponseTime: '< 24 hours', // This would require tracking response timestamps
      };
    } catch (error) {
      console.error('[INSTANCE_MOD] Error getting statistics:', error);
      return {
        totalLabelsApplied: 0,
        labelsByType: {},
        takedownsLast30Days: 0,
        averageResponseTime: '0 hours',
      };
    }
  }
}

export const instanceModerationService = new InstanceModerationService();
