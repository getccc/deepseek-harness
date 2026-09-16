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
import { KnowledgeDocRef, isKnowledgeDocRef, isKnowledgeRef, KnowledgeRef, parseKnowledgeDocRef } from './brand.ts'
import type { KnowledgeScope, KnowledgeScopeBase, KnowledgeScopeDocument, KnowledgeScopeSelection } from './types.ts'

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
    const entry = parseScopeBase(base)
    if (entry === undefined) return undefined
    parsed.push(entry)
  }
  // Documents narrow inside one knowledge base, so a scope naming several
  // cannot carry them: such a value would describe a search nobody can run.
  if (parsed.length > 1 && parsed.some(base => base.documents !== undefined)) return undefined
  return { version: 1, mode: 'selected', bases: parsed }
}

/**
 * Read one recorded knowledge base: its reference, its name, and the documents
 * a narrowed scope names inside it.
 *
 * Every document reference has to sit in that knowledge base. A base whose
 * documents point elsewhere would search a knowledge base its recorded name
 * does not describe, which is the one way this value could promise something
 * a later search would not do. Properties this build does not know are
 * ignored, so a narrowing written under a name it no longer reads leaves the
 * whole knowledge base — wider than the member chose, never narrower.
 */
function parseScopeBase(value: unknown): KnowledgeScopeBase | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  const ref = entry['ref']
  const displayName = entry['displayName']
  if (typeof ref !== 'string' || !isKnowledgeRef(ref)) return undefined
  if (typeof displayName !== 'string' || displayName === '') return undefined
  const documents = entry['documents']
  if (documents === undefined) return { ref: KnowledgeRef(ref), displayName }
  if (!Array.isArray(documents) || documents.length === 0) return undefined
  const parsed: KnowledgeScopeDocument[] = []
  for (const document of documents as unknown[]) {
    if (typeof document !== 'object' || document === null) return undefined
    const docRef = (document as Record<string, unknown>)['ref']
    const title = (document as Record<string, unknown>)['title']
    if (typeof docRef !== 'string' || !isKnowledgeDocRef(docRef) || typeof title !== 'string') return undefined
    if (parseKnowledgeDocRef(docRef)?.ref !== ref) return undefined
    parsed.push({ ref: KnowledgeDocRef(docRef), title })
  }
  return { ref: KnowledgeRef(ref), displayName, documents: parsed }
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
    case 'selected': {
      // One knowledge base carrying documents is the narrowed operation; the
      // parser already refused a multi-base scope that carries any.
      const [only] = scope.bases
      if (scope.bases.length === 1 && only?.documents !== undefined) {
        return { mode: 'documents', ref: only.ref, docRefs: only.documents.map(document => document.ref) }
      }
      return { mode: 'selected', refs: scope.bases.map(base => base.ref) }
    }
  }
}
