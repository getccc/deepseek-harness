/**
 * The Session BI scope: its log event, the fold that recovers it, and the
 * validator that reads one back off a wire.
 *
 * Scope is the member's answer to "which BI project may this Session
 * analyze". It reaches the model twice, as prompt text naming the project and
 * as whether the BI tools exist at all, so it lives in the Session log and
 * nowhere else. Resume, fork, and rewind therefore recover it by replaying,
 * and no second store can disagree with the log.
 * @module @deepseek-ai/dsh-bi/scope
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { BiProjectRef, isBiProjectRef } from './brand.ts'
import type { BiScope, BiScopeProject } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Which BI project this Session analyzes from this point on: whole-value
     * replace, last one wins, and a log with none folds to `off` through
     * {@link foldBiScope}.
     *
     * Model-visible: the folded value decides both the `bi:scope` prompt
     * section and whether the BI tools are offered, so the display name a
     * `selected` scope carries is recorded here rather than resolved at
     * assembly time.
     */
    'bi/scope': BiScope
  }
}

/** The scope a Session holds before anyone chooses one. */
export const DEFAULT_BI_SCOPE: BiScope = { version: 1, mode: 'off' }

/**
 * Recover the Session's current scope from its log.
 * @param events - the Session's committed events, in order.
 * @param end - fold only the first `end` events, for rewind and fork reads.
 * @returns the last recorded scope, or {@link DEFAULT_BI_SCOPE} when the log records none.
 */
export function foldBiScope(events: readonly SessionEvent[], end = events.length): BiScope {
  let scope: BiScope = DEFAULT_BI_SCOPE
  for (const event of events.slice(0, end)) {
    if (event.type === 'bi/scope') scope = event.data
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
export function parseBiScope(value: unknown): BiScope | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['version'] !== 1) return undefined
  switch (record['mode']) {
    case 'off':
      return { version: 1, mode: 'off' }
    case 'selected': {
      const project = parseProject(record['project'])
      return project === undefined ? undefined : { version: 1, mode: 'selected', project }
    }
    default:
      return undefined
  }
}

/** Read one recorded project: a reference this build accepts and a non-empty name. */
function parseProject(value: unknown): BiScopeProject | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  const ref = entry['ref']
  const displayName = entry['displayName']
  if (typeof ref !== 'string' || !isBiProjectRef(ref)) return undefined
  if (typeof displayName !== 'string' || displayName === '') return undefined
  return { ref: BiProjectRef(ref), displayName }
}

/**
 * The project a Session scope names, for the operation that needs one.
 * @param scope - the Session's folded scope.
 * @returns the recorded project, or undefined when the scope is `off` and no operation should be built.
 */
export function projectOf(scope: BiScope): BiScopeProject | undefined {
  return scope.mode === 'selected' ? scope.project : undefined
}
