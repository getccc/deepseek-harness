/**
 * Rewriting a Runner's request body before it reaches an upstream provider.
 *
 * A Runner sends the body its LLM adapter built, because reimplementing every
 * provider's request format in the Control Plane would be a second adapter to
 * keep correct. What it does not get to decide is which model that body
 * addresses: the gateway overwrites the field the catalog owns.
 * @module @deepseek-ai/dsh-model-gateway/body
 */

import type { CallPlan } from './types.ts'

/**
 * The body field that names the model, in every provider format this build
 * proxies.
 *
 * One name because the OpenAI-compatible request shape is the only one the
 * gateway carries today. A provider that names it differently needs its own
 * entry here, not a guess.
 */
export const MODEL_FIELD = 'model'

/**
 * The body field that bounds output length, per provider format.
 *
 * Both spellings are overwritten, because a provider that reads either one
 * would otherwise let a Runner produce more than the reservation held.
 */
export const OUTPUT_LIMIT_FIELDS = ['max_tokens', 'max_completion_tokens'] as const

/**
 * Apply the plan to a Runner's body.
 *
 * Two fields are overwritten and nothing else is touched. The model becomes
 * the catalog's upstream name, so a Runner that named one model and wrote
 * another in the body reaches the one it was authorized for. The output limit
 * becomes the reserved ceiling, so the response cannot exceed the budget that
 * was actually held.
 *
 * Where the call goes is not in the body at all — the endpoint and the
 * credential come from the plan — so there is nothing here to strip.
 * @param body - the request body the Runner built.
 * @param plan - what the gateway approved.
 * @returns the body to send upstream.
 */
export function applyPlanToBody(
  body: Record<string, unknown>,
  plan: CallPlan,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = { ...body, [MODEL_FIELD]: plan.upstreamModel }
  for (const field of OUTPUT_LIMIT_FIELDS) {
    // Only a field the body already carries is bounded: adding one a provider
    // does not read would change a request the adapter meant to send.
    if (field in rewritten) {
      rewritten[field] = Math.min(Number(rewritten[field]) || plan.maxOutputTokens, plan.maxOutputTokens)
    }
  }
  return rewritten
}
