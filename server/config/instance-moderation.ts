/**
 * Instance Moderation Configuration
 * 
 * This file defines legal compliance labels for your App View instance.
 * Customize these based on your jurisdiction and legal requirements.
 * 
 * These are INSTANCE labels (applied by the server), separate from
 * third-party labeler services that users can choose.
 */

export interface InstanceLabel {
  value: string;           // Label identifier (e.g., 'dmca-takedown')
  severity: 'info' | 'warn' | 'alert' | 'none';
  action: 'hide' | 'blur' | 'flag' | 'delete-reference';
  reason: 'legal' | 'safety' | 'quality' | 'tos';
  description: string;
  enabled: boolean;
}

/**
 * LEGAL COMPLIANCE LABELS
 * These handle content that must be removed/hidden for legal reasons
 */
export const LEGAL_LABELS: InstanceLabel[] = [
  {
    value: 'dmca-takedown',
    severity: 'alert',
    action: 'delete-reference',
    reason: 'legal',
    description: 'DMCA copyright takedown notice received',
    enabled: true,
  },
  {
    value: 'court-order',
    severity: 'alert',
    action: 'delete-reference',
    reason: 'legal',
    description: 'Content removed per court order',
    enabled: true,
  },
  {
    value: 'illegal-content',
    severity: 'alert',
    action: 'delete-reference',
    reason: 'legal',
    description: 'Content illegal in instance jurisdiction',
    enabled: true,
  },
  // EU-specific (DSA - Digital Services Act)
  {
    value: 'dsa-removal',
    severity: 'alert',
    action: 'delete-reference',
    reason: 'legal',
    description: 'Content removed under EU Digital Services Act',
    enabled: false, // Enable if operating in EU
  },
  // Germany-specific (NetzDG)
  {
    value: 'netzdg-removal',
    severity: 'alert',
    action: 'delete-reference',
    reason: 'legal',
    description: 'Content removed under German NetzDG law',
    enabled: false, // Enable if operating in Germany
  },
];

/**
 * PLATFORM SAFETY LABELS
 * These handle content that violates instance Terms of Service
 */
export const SAFETY_LABELS: InstanceLabel[] = [
  {
    value: 'doxxing',
    severity: 'alert',
    action: 'hide',
    reason: 'safety',
    description: 'Content contains personal information disclosure',
    enabled: true,
  },
  {
    value: 'impersonation',
    severity: 'warn',
    action: 'flag',
    reason: 'safety',
    description: 'Account impersonating another individual/entity',
    enabled: true,
  },
  {
    value: 'credible-threat',
    severity: 'alert',
    action: 'hide',
    reason: 'safety',
    description: 'Content contains credible threat of violence',
    enabled: true,
  },
  {
    value: 'self-harm',
    severity: 'warn',
    action: 'blur',
    reason: 'safety',
    description: 'Content promoting self-harm',
    enabled: true,
  },
];

/**
 * QUALITY/SPAM LABELS
 * These handle low-quality content (less severe than legal/safety)
 */
export const QUALITY_LABELS: InstanceLabel[] = [
  {
    value: 'spam-extreme',
    severity: 'warn',
    action: 'hide',
    reason: 'quality',
    description: 'Obvious spam or promotional abuse',
    enabled: true,
  },
  {
    value: 'malicious-link',
    severity: 'alert',
    action: 'blur',
    reason: 'safety',
    description: 'Link to known malware/phishing site',
    enabled: true,
  },
  {
    value: 'report-threshold',
    severity: 'warn',
    action: 'flag',
    reason: 'quality',
    description: 'Content exceeds user report threshold',
    enabled: true,
  },
];

/**
 * INSTANCE CONFIGURATION
 * Set these based on your deployment
 */
export const INSTANCE_CONFIG = {
  // Your App View's DID (used as label source)
  labelerDid: process.env.APPVIEW_DID || '',
  
  // Legal jurisdiction (affects which laws apply)
  jurisdiction: process.env.INSTANCE_JURISDICTION || 'US',
  
  // Contact for legal/DMCA requests
  legalContact: process.env.LEGAL_CONTACT_EMAIL || 'legal@example.com',
  
  // Automatic report threshold (hide after X reports)
  autoHideThreshold: parseInt(process.env.AUTO_HIDE_THRESHOLD || '10'),
  
  // Enable/disable instance moderation entirely
  enabled: process.env.ENABLE_INSTANCE_MODERATION !== 'false',
};

/**
 * Get all enabled labels
 */
export function getEnabledLabels(): InstanceLabel[] {
  return [
    ...LEGAL_LABELS,
    ...SAFETY_LABELS,
    ...QUALITY_LABELS,
  ].filter(label => label.enabled);
}

/**
 * Get label configuration by value
 */
export function getLabelConfig(value: string): InstanceLabel | undefined {
  return getEnabledLabels().find(label => label.value === value);
}

/**
 * Check if a label should trigger content removal from index
 */
export function shouldDeleteReference(value: string): boolean {
  const config = getLabelConfig(value);
  return config?.action === 'delete-reference';
}

/**
 * Get labels by reason (legal, safety, quality, tos)
 */
export function getLabelsByReason(reason: InstanceLabel['reason']): InstanceLabel[] {
  return getEnabledLabels().filter(label => label.reason === reason);
}
