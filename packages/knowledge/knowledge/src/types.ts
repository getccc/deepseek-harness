/**
 * The knowledge vocabulary every provider and consumer shares: the authorized
 * directory, one search and its passages, the Session scope, and the closed
 * set of ways an operation ends badly.
 *
 * Nothing here names an upstream service, an address, or a credential. A
 * Runner-side consumer builds a request out of these types alone, which is
 * what makes the Control Plane the only party that can reach a knowledge
 * source.
 * @module @deepseek-ai/dsh-knowledge/types
 */

import type { KnowledgeRef } from './brand.ts'

/** What an upstream knowledge base holds, as its catalog classifies it. */
export type KnowledgeKind = 'document' | 'faq'

/** One knowledge base a principal may search, as the directory presents it. */
export interface KnowledgeBaseEntry {
  readonly ref: KnowledgeRef
  /** The upstream display name, refreshed on each directory read. */
  readonly displayName: string
  /** The upstream description, empty when the source supplies none. */
  readonly description: string
  readonly kind: KnowledgeKind
}

/**
 * One knowledge base named in a Session scope, with the display name recorded
 * beside it.
 *
 * The name travels with the reference because the scope reaches the model as
 * prompt text, and a model-visible name has to be reconstructable from the
 * Session log. A name recorded here is a snapshot of the moment of choice: an
 * administrator who renames the knowledge base afterwards does not change what
 * an already-recorded Session's prompt says.
 */
export interface KnowledgeScopeBase {
  readonly ref: KnowledgeRef
  readonly displayName: string
}

/**
 * Which knowledge the current Session may search.
 *
 * `off` is the state a Session starts in and the only one a log without a
 * scope event folds to. Scope narrows authorization and never widens it: `all`
 * means every knowledge base the principal is authorized for at the moment of
 * each call, not every knowledge base that exists.
 */
export type KnowledgeScope =
  | { readonly version: 1; readonly mode: 'off' }
  | { readonly version: 1; readonly mode: 'all' }
  | { readonly version: 1; readonly mode: 'selected'; readonly bases: readonly KnowledgeScopeBase[] }

/** Every mode a {@link KnowledgeScope} can carry. */
export type KnowledgeScopeMode = KnowledgeScope['mode']

/** What a consumer asks the knowledge service to search. */
export interface KnowledgeSearchRequest {
  /** The natural-language question, passed to the upstream retriever. */
  readonly query: string
  /**
   * The knowledge bases to search, resolved from the Session scope. Empty is
   * not a request for everything: a caller with nothing to search does not
   * call, and the gateway refuses an empty scope rather than widening it.
   */
  readonly scope: KnowledgeScopeSelection
  /** At most this many passages; the provider's own maximum still applies. */
  readonly maxResults?: number
  /** Aborts the operation, including the Control Plane request it produced. */
  readonly signal?: AbortSignal
}

/**
 * The scope one operation carries, after a Session preference has been read.
 *
 * `all` stays a mode rather than an expanded list because expansion is an
 * authorization act: only the Control Plane knows what the principal currently
 * holds, and a Runner that expanded it would be asserting authorization it
 * cannot compute.
 */
export type KnowledgeScopeSelection =
  | { readonly mode: 'all' }
  | { readonly mode: 'selected'; readonly refs: readonly KnowledgeRef[] }

/** One retrieved passage, already bounded by the provider. */
export interface KnowledgePassage {
  /** Which knowledge base produced it, so a reader can attribute the text. */
  readonly ref: KnowledgeRef
  /** The source document's title, empty when the upstream supplies none. */
  readonly title: string
  /** The passage text, with unresolvable upstream references neutralized. */
  readonly text: string
  /** Whether {@link text} was cut to the provider's per-passage maximum. */
  readonly truncated: boolean
  /** The upstream relevance score, comparable only within one result. */
  readonly score: number
}

/** What one search answers. */
export interface KnowledgeSearchResult {
  /** The query as asked, echoed so a transcript reads without its request. */
  readonly query: string
  /** The knowledge bases actually searched, named for a reader. */
  readonly searched: readonly KnowledgeBaseEntry[]
  readonly passages: readonly KnowledgePassage[]
  /** Whether passages were dropped to reach the requested maximum. */
  readonly truncated: boolean
}

/**
 * Every way a knowledge operation ends badly.
 *
 * The set is closed so a Runner, a tool result, and a UI all distinguish
 * "sign in again" from "ask an administrator" from "try later" without parsing
 * a message. `not-allowed` deliberately covers an unknown reference as well as
 * an unauthorized one, so a refusal never confirms that a knowledge base
 * exists to a principal holding nothing on it.
 */
export type KnowledgeFailureReason =
  /** No valid device token, an inactive member, or a revoked device. */
  | 'unauthenticated'
  /** No grant admits the operation, or a named resource is unknown or disabled. */
  | 'not-allowed'
  /** A selected reference is no longer in the principal's authorized directory. */
  | 'scope-unavailable'
  /** Selected knowledge bases do not share one embedding model. */
  | 'scope-incompatible'
  /** The upstream knowledge service did not answer in time or at all. */
  | 'upstream-unavailable'
  /** The upstream knowledge service answered something this build cannot read. */
  | 'upstream-invalid'
  /** The Control Plane could not be reached from this computer. */
  | 'control-plane-unreachable'
  /** This Runner speaks a knowledge protocol version the Control Plane refuses. */
  | 'update-required'
  /** The caller aborted the operation. */
  | 'cancelled'

/**
 * A knowledge operation that did not succeed, carrying one closed reason.
 *
 * The message is for a developer reading a log. Product surfaces read
 * {@link KnowledgeError.reason} and supply their own localized text, and no
 * upstream response body ever reaches either.
 */
export class KnowledgeError extends Error {
  constructor(readonly reason: KnowledgeFailureReason, detail?: string) {
    super(detail === undefined ? reason : `${reason}: ${detail}`)
    this.name = 'KnowledgeError'
  }
}
