/**
 * The closed word lists the model catalog and the gateway use.
 *
 * They are runtime arrays rather than bare type unions because a store seeds
 * its column constraints from them: the list lives here once, and SQL restates
 * it only by reading this module.
 * @module @deepseek-ai/dsh-model-gateway/vocabulary
 */

/** Whether a model may still be invoked. */
export const MODEL_STATUSES = ['active', 'retired'] as const

/**
 * Why an invocation was refused.
 *
 * `unknown-model` covers both "no such model" and "not allowed to discover
 * it", so a refusal never tells a member which models exist in an organization
 * they have no grant in.
 */
export const INVOCATION_REFUSALS = [
  /** No such model, or none this principal may invoke. */
  'unknown-model',
  /** The model exists and has been withdrawn from service. */
  'model-retired',
  /** The principal's roles do not carry `model.invoke` on it. */
  'not-allowed',
  /** The organization has no budget left for this period. */
  'quota-exceeded',
  /** The request asks for a nonsensical number of tokens. */
  'malformed',
] as const
