/**
 * The closed word lists the quota ledger stores in its own columns.
 *
 * They are runtime arrays rather than bare type unions because a store seeds
 * its column constraints from them: the list lives here once, and SQL restates
 * it only by reading this module.
 * @module @deepseek-ai/dsh-quota/vocabulary
 */

/** Why a reservation was refused. */
export const RESERVATION_REFUSALS = [
  /** The request would take the organization past its limit for the period. */
  'exceeded',
  /** The request asks for a non-positive or non-integral number of tokens. */
  'malformed',
] as const

/**
 * How a reservation was settled.
 *
 * The three are kept apart because they answer different questions later: what
 * an invoice can be reconciled against (`reported`), what was charged without
 * evidence (`estimated`), and what the organization was never charged for
 * (`released`).
 */
export const SETTLEMENT_KINDS = ['reported', 'estimated', 'released'] as const
