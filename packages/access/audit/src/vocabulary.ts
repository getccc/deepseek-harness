/**
 * The two closed word lists an audit record carries in its own columns.
 *
 * They are runtime arrays rather than bare type unions because a store seeds
 * its column constraints from them: the list lives here once, and SQL restates
 * it only by reading this module.
 * @module @deepseek-ai/dsh-audit/vocabulary
 */

/** Every way an audited operation can end. */
export const AUDIT_OUTCOMES = ['allowed', 'denied', 'error'] as const

/**
 * Every refusal this build can record.
 *
 * The first three mirror the access-control decision reasons, and the rest name
 * the failures that happen before a decision is even reached.
 */
export const AUDIT_REASONS = [
  'default-deny',
  'resource-disabled',
  'no-grant',
  'invalid-credentials',
  'account-disabled',
  'expired',
  'revoked',
] as const
