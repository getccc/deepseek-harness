/**
 * The Session knowledge scope: its log event, the fold that recovers it, and
 * the validator that reads one back off a wire.
 *
 * Scope is the member's answer to "which private knowledge may this Session
 * use". It reaches the model twice — as prompt text naming the chosen
 * knowledge bases, and as whether the search tool exists at all — so it lives
 * in the Session log and nowhere else. Resume, fork, and rewind therefore
 * recover it by replaying, and no second store can disagree with the log.
 * @module @deepseek-ai/dsh-knowledge/scope
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { isKnowledgeRef, KnowledgeRef } from './brand.ts'
import type { KnowledgeScope, KnowledgeScopeBase, KnowledgeScopeSelection } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Which private knowledge this Session may search from this point on:
     * whole-value replace, last one wins, and a log with none folds to `off`
     * through {@link foldKnowledgeScope}.
     *
     * Model-visible: the folded value decides both the `knowledge:scope`
     * prompt section and whether `knowledge_search` is offered, so the display
     * names a `selected` scope carries are recorded here rather than resolved
     * at assembly time.
     */
    'knowledge/scope': KnowledgeScope
  }
}

/** The scope a Session holds before anyone chooses one. */
export const DEFAULT_KNOWLEDGE_SCOPE: KnowledgeScope = { version: 1, mode: 'off' }

/**
 * Recover the Session's current scope from its log.
 * @param events - the Session's committed events, in order.
 * @param end - fold only the first `end` events, for rewind and fork reads.
 * @returns the last recorded scope, or {@link DEFAULT_KNOWLEDGE_SCOPE} when the log records none.
 */
export function foldKnowledgeScope(
  events: readonly SessionEvent[],
  end = events.length,
): KnowledgeScope {
  let scope: KnowledgeScope = DEFAULT_KNOWLEDGE_SCOPE
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'knowledge/scope') scope = event.data
  }
  return scope
}

/**
 * Read a scope value that arrived from a wire, a client, or a stored log.
 *
 * Returns undefined rather than throwing because every caller is deciding
 * whether to accept a value, not diagnosing one. A rejected value leaves the
 * Session's recorded scope alone; it never degrades to `off`, because silently
 * narrowing a member's choice is a change they did not ask for.
 * @param value - the candidate scope.
 * @returns the validated scope, or undefined when the value is not one this build accepts.
 */
export function parseKnowledgeScope(value: unknown): KnowledgeScope | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['version'] !== 1) return undefined
  const mode = record['mode']
  if (mode === 'off' || mode === 'all') return { version: 1, mode }
  if (mode !== 'selected') return undefined
  const bases = record['bases']
  if (!Array.isArray(bases) || bases.length === 0) return undefined
  const parsed: KnowledgeScopeBase[] = []
  for (const base of bases as unknown[]) {
    if (typeof base !== 'object' || base === null) return undefined
    const entry = base as Record<string, unknown>
    const ref = entry['ref']
    const displayName = entry['displayName']
    if (typeof ref !== 'string' || !isKnowledgeRef(ref)) return undefined
    if (typeof displayName !== 'string' || displayName === '') return undefined
    parsed.push({ ref: KnowledgeRef(ref), displayName })
  }
  return { version: 1, mode: 'selected', bases: parsed }
}

/**
 * Turn a Session scope into the selection one operation carries.
 * @param scope - the Session's folded scope.
 * @returns the selection, or undefined when the scope is `off` and no operation should be built.
 */
export function selectionOf(scope: KnowledgeScope): KnowledgeScopeSelection | undefined {
  switch (scope.mode) {
    case 'off':
      return undefined
    case 'all':
      return { mode: 'all' }
    case 'selected':
      return { mode: 'selected', refs: scope.bases.map(base => base.ref) }
  }
}
