/**
 * EXAMPLE INSTANCE MODERATION CONFIGURATIONS
 *
 * Copy patterns from here to instance-moderation.ts based on your needs
 */

// ============================================================================
// EXAMPLE 1: US-based instance (DMCA focus)
// ============================================================================
export const US_INSTANCE = {
  LEGAL_LABELS: [
    {
      value: 'dmca-takedown',
      severity: 'alert' as const,
      action: 'delete-reference' as const,
      reason: 'legal' as const,
      description: 'DMCA copyright takedown notice received',
      enabled: true,
    },
    {
      value: 'court-order',
      severity: 'alert' as const,
      action: 'delete-reference' as const,
      reason: 'legal' as const,
      description: 'Content removed per court order',
      enabled: true,
    },
  ],
  INSTANCE_CONFIG: {
    jurisdiction: 'US',
    legalContact: 'dmca@example.com',
    autoHideThreshold: 10,
  },
};

// ============================================================================
// EXAMPLE 2: EU-based instance (GDPR + DSA compliance)
// ============================================================================
export const EU_INSTANCE = {
  LEGAL_LABELS: [
    {
      value: 'dsa-removal',
      severity: 'alert' as const,
      action: 'delete-reference' as const,
      reason: 'legal' as const,
      description: 'Content removed under EU Digital Services Act',
      enabled: true,
    },
    {
      value: 'gdpr-rtf',
      severity: 'alert' as const,
      action: 'delete-reference' as const,
      reason: 'legal' as const,
      description: 'Right to be forgotten request (GDPR Article 17)',
      enabled: true,
    },
    {
      value: 'illegal-hate-speech',
      severity: 'alert' as const,
      action: 'delete-reference' as const,
      reason: 'legal' as const,
      description: 'Hate speech illegal under EU law',
      enabled: true,
    },
  ],
  INSTANCE_CONFIG: {
    jurisdiction: 'EU',
    legalContact: 'legal@example.eu',
    autoHideThreshold: 5, // Lower threshold for EU
  },
};

// ============================================================================
// EXAMPLE 3: Germany (NetzDG compliance)
// ============================================================================
export const GERMANY_INSTANCE = {
  LEGAL_LABELS: [
    {
      value: 'netzdg-removal',
      severity: 'alert' as const,
      action: 'delete-reference' as const,
      reason: 'legal' as const,
      description: 'Content removed under German NetzDG law',
      enabled: true,
    },
    {
      value: 'netzdg-pending',
      severity: 'warn' as const,
      action: 'flag' as const,
      reason: 'legal' as const,
      description: 'Under review for NetzDG compliance (24h window)',
      enabled: true,
    },
  ],
  INSTANCE_CONFIG: {
    jurisdiction: 'DE',
    legalContact: 'netzdg@example.de',
    autoHideThreshold: 3, // Very low threshold for NetzDG
  },
};

// ============================================================================
// EXAMPLE 4: Minimal instance (personal/friends only)
// ============================================================================
export const MINIMAL_INSTANCE = {
  LEGAL_LABELS: [
    {
      value: 'admin-removal',
      severity: 'alert' as const,
      action: 'delete-reference' as const,
      reason: 'tos' as const,
      description: 'Removed by instance administrator',
      enabled: true,
    },
  ],
  SAFETY_LABELS: [], // No automated safety labels
  QUALITY_LABELS: [], // No spam filtering
  INSTANCE_CONFIG: {
    jurisdiction: 'PRIVATE',
    legalContact: 'admin@personal.instance',
    autoHideThreshold: 999, // Effectively disabled
    enabled: true,
  },
};

// ============================================================================
// EXAMPLE 5: Strict moderation instance
// ============================================================================
export const STRICT_INSTANCE = {
  LEGAL_LABELS: [
    // All legal labels enabled
  ],
  SAFETY_LABELS: [
    {
      value: 'harassment',
      severity: 'alert' as const,
      action: 'hide' as const,
      reason: 'safety' as const,
      description: 'Targeted harassment',
      enabled: true,
    },
    {
      value: 'bigotry',
      severity: 'alert' as const,
      action: 'hide' as const,
      reason: 'safety' as const,
      description: 'Bigoted or discriminatory content',
      enabled: true,
    },
  ],
  QUALITY_LABELS: [
    {
      value: 'spam-commercial',
      severity: 'warn' as const,
      action: 'hide' as const,
      reason: 'quality' as const,
      description: 'Commercial spam',
      enabled: true,
    },
  ],
  INSTANCE_CONFIG: {
    jurisdiction: 'US',
    legalContact: 'legal@strict.social',
    autoHideThreshold: 3, // Low threshold
    enabled: true,
  },
};

// ============================================================================
// CUSTOM LABEL TEMPLATES
// ============================================================================

/**
 * Template for jurisdiction-specific laws
 */
export const JURISDICTION_TEMPLATE = {
  value: 'jurisdiction-law', // e.g., 'uk-online-safety-act'
  severity: 'alert' as const,
  action: 'delete-reference' as const,
  reason: 'legal' as const,
  description: 'Content removed under [JURISDICTION] law',
  enabled: false, // Set to true when configured
};

/**
 * Template for custom safety rules
 */
export const SAFETY_TEMPLATE = {
  value: 'custom-safety', // e.g., 'community-guidelines-violation'
  severity: 'warn' as const,
  action: 'blur' as const,
  reason: 'safety' as const,
  description: 'Violates instance community guidelines',
  enabled: false,
};

/**
 * Template for quality/spam rules
 */
export const QUALITY_TEMPLATE = {
  value: 'custom-quality', // e.g., 'ai-generated-spam'
  severity: 'warn' as const,
  action: 'flag' as const,
  reason: 'quality' as const,
  description: 'Low-quality or spam content',
  enabled: false,
};
