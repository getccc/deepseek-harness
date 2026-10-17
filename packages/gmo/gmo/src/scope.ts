/**
 * The Session GMO scope: its log event, the fold that recovers it, and the
 * validator that reads one back off a wire.
 *
 * Scope is the member's answer to "which GMO category may this Session
 * analyze". It reaches the model twice, as prompt text naming the category and
 * as whether the GMO tools exist at all, so it lives in the Session log and
 * nowhere else. Resume, fork, and rewind therefore recover it by replaying,
 * and no second store can disagree with the log.
 * @module @deepseek-ai/dsh-gmo/scope
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { GmoCategoryRef, isGmoCategoryRef } from './brand.ts'
import type { GmoScope, GmoScopeCategory } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Which GMO category this Session analyzes from this point on: whole-value
     * replace, last one wins, and a log with none folds to `off` through
     * {@link foldGmoScope}.
     *
     * Model-visible: the folded value decides both the `gmo:scope` prompt
     * section and whether the GMO tools are offered, so the display name a
     * `selected` scope carries is recorded here rather than resolved at
     * assembly time.
     */
    'gmo/scope': GmoScope
  }
}

/** The scope a Session holds before anyone chooses one. */
export const DEFAULT_GMO_SCOPE: GmoScope = { version: 1, mode: 'off' }

/**
 * Recover the Session's current scope from its log.
 * @param events - the Session's committed events, in order.
 * @param end - fold only the first `end` events, for rewind and fork reads.
 * @returns the last recorded scope, or {@link DEFAULT_GMO_SCOPE} when the log records none.
 */
export function foldGmoScope(events: readonly SessionEvent[], end = events.length): GmoScope {
  let scope: GmoScope = DEFAULT_GMO_SCOPE
  for (const event of events.slice(0, end)) {
    if (event.type === 'gmo/scope') scope = event.data
  }
  return scope
}

/**
 * Read a scope value that arrived from a wire, a client, or a stored log.
 *
 * Returns undefined rather than throwing because every caller is deciding
 * whether to accept a value, not diagnosing one. A rejected value leaves the
 * Session's recorded scope alone; it never degrades to `off`, because silently
 * dropping a member's choice is a change they did not ask for.
 * @param value - the candidate scope.
 * @returns the validated scope, or undefined when the value is not one this build accepts.
 */
export function parseGmoScope(value: unknown): GmoScope | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['version'] !== 1) return undefined
  switch (record['mode']) {
    case 'off':
      return { version: 1, mode: 'off' }
    case 'selected': {
      const category = parseCategory(record['category'])
      return category === undefined ? undefined : { version: 1, mode: 'selected', category }
    }
    default:
      return undefined
  }
}

/** Read one recorded category: a reference this build accepts and a non-empty name. */
function parseCategory(value: unknown): GmoScopeCategory | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  const ref = entry['ref']
  const displayName = entry['displayName']
  if (typeof ref !== 'string' || !isGmoCategoryRef(ref)) return undefined
  if (typeof displayName !== 'string' || displayName === '') return undefined
  return { ref: GmoCategoryRef(ref), displayName }
}

/**
 * The category a Session scope names, for the operation that needs one.
 * @param scope - the Session's folded scope.
 * @returns the recorded category, or undefined when the scope is `off` and no operation should be built.
 */
export function categoryOf(scope: GmoScope): GmoScopeCategory | undefined {
  return scope.mode === 'selected' ? scope.category : undefined
}
