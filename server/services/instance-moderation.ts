import { 
  getEnabledLabels, 
  getLabelConfig, 
  shouldDeleteReference,
  INSTANCE_CONFIG,
  type InstanceLabel 
} from '../config/instance-moderation';
import { labelService } from './label';

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
    // TODO: Implement based on subject type (post/profile/etc)
    console.log(`[INSTANCE_MOD] Would delete reference to: ${subject}`);
    // Example:
    // if (subject.includes('/app.bsky.feed.post/')) {
    //   await storage.deletePost(subject);
    // }
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

    await this.applyInstanceLabel({
      subject: params.subject,
      labelValue,
      reason: `Takedown request from ${params.requestor}: ${params.details}`,
    });

    console.log(`[INSTANCE_MOD] Takedown processed:`, {
      type: params.requestType,
      subject: params.subject,
      requestor: params.requestor,
    });
  }

  /**
   * Get moderation statistics (for transparency dashboard)
   */
  async getStatistics() {
    // TODO: Query actual stats from database
    return {
      totalLabelsApplied: 0,
      labelsByType: {},
      takedownsLast30Days: 0,
      averageResponseTime: '0 hours',
    };
  }
}

export const instanceModerationService = new InstanceModerationService();
