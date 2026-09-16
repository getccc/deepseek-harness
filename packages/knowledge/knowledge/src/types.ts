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

import type { KnowledgeDocRef, KnowledgeRef } from './brand.ts'

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
  /**
   * How many documents the source held at the last reconcile.
   *
   * Absent when the Control Plane does not report it, which is what a
   * deployment older than this field does. It is a count to read, never a
   * bound: a listing says how far it goes on its own.
   */
  readonly documentCount?: number
  /** When the source created it, in epoch milliseconds; absent when the Control Plane reports none. */
  readonly createdAt?: number
}

/**
 * Whether a source will retrieve from one document right now.
 *
 * Three states rather than the source's own words, because those are what a
 * member can act on: wait, ask an administrator, or use it. A parse state this
 * build does not know folds to `unavailable`, which is the reading that
 * promises least.
 */
export type KnowledgeDocumentState =
  /** The source retrieves from it. */
  | 'ready'
  /** The source is still ingesting it, so retrieval does not reach it yet. */
  | 'processing'
  /** The source will not retrieve from it: it failed, was cancelled, is being removed, or is switched off. */
  | 'unavailable'

/** One document in a knowledge base, as the document directory presents it. */
export interface KnowledgeDocument {
  readonly docRef: KnowledgeDocRef
  /** The knowledge base it belongs to, which is what authorized reading it. */
  readonly ref: KnowledgeRef
  /** The upstream title, empty when the source supplies none. */
  readonly title: string
  /** The source's own summary of the document, empty when it supplies none. */
  readonly description: string
  /** The original file name, empty for a document the source holds no file for. */
  readonly fileName: string
  /** The source's own word for the file kind, such as `pdf`; empty when it supplies none. */
  readonly fileType: string
  /** The original file's size, zero when the source supplies none. */
  readonly byteSize: number
  readonly state: KnowledgeDocumentState
  /** Epoch milliseconds the source last changed it, or undefined when it supplies no timestamp. */
  readonly updatedAt: number | undefined
}

/** What a consumer asks for one page of a knowledge base's documents. */
export interface KnowledgeDocumentsRequest {
  /** The knowledge base to list; authorized on every call. */
  readonly ref: KnowledgeRef
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many documents one page holds; the provider's own maximum still applies. */
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

/** One page of a knowledge base's documents. */
export interface KnowledgeDocumentPage {
  /** The knowledge base listed, echoed so a page reads without its request. */
  readonly ref: KnowledgeRef
  readonly documents: readonly KnowledgeDocument[]
  /** The page returned, counting from one. */
  readonly page: number
  /** The page size actually applied, after the provider's bounds. */
  readonly pageSize: number
  /**
   * How many documents the knowledge base holds in total, or undefined when
   * the source does not say. Absent rather than guessed: a total inferred from
   * one page would tell a member the list ends where it does not.
   */
  readonly total: number | undefined
}

/**
 * What one document's content is, as a reader receives it.
 *
 * Two arms because two things can be served, and a reader has to know which it
 * got: the original file, which renders as the document a member recognizes,
 * and the source's parsed text, which is what is left when the file is larger
 * than a caller accepts or the source holds no file at all. Bytes are never
 * truncated — a document that would not fit is answered as text instead, so a
 * partial file never reaches a renderer that would draw it as a whole one.
 */
export type KnowledgeDocumentContent =
  | {
    readonly kind: 'bytes'
    readonly docRef: KnowledgeDocRef
    /** The original file name, empty when the source holds none. */
    readonly fileName: string
    /** The media type the file is served as, from its name. */
    readonly contentType: string
    readonly bytes: Uint8Array
  }
  | {
    readonly kind: 'text'
    readonly docRef: KnowledgeDocRef
    readonly fileName: string
    /** The source's parsed text, in the order the source holds it. */
    readonly text: string
    /** Whether the text was cut to the caller's character bound. */
    readonly truncated: boolean
  }

/** What a consumer asks for one document's content. */
export interface KnowledgeDocumentRequest {
  readonly docRef: KnowledgeDocRef
  /**
   * The most bytes the caller can accept. A document over it is answered as
   * parsed text rather than refused, because a member asked to read something
   * and the text is the part of it that still fits. The provider's own maximum
   * still applies.
   */
  readonly maxBytes?: number
  readonly signal?: AbortSignal
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
  /**
   * Documents inside this knowledge base, when the member narrowed the
   * conversation to them; absent means the whole knowledge base.
   *
   * An optional field on the recorded knowledge base rather than a mode of its
   * own: a new mode is a union change, which the persistence rules class as a
   * format-version bump, while an optional property is a same-version
   * addition. What it costs is a build that predates the field: resuming such
   * a Session, it ignores the narrowing and searches the whole knowledge base
   * — wider than the member chose, never narrower.
   *
   * Present only on a scope naming exactly one knowledge base, which
   * {@link parseKnowledgeScope} enforces: the upstream narrowing applies
   * inside one knowledge base, so a second one carrying documents would
   * describe a search nobody can perform.
   */
  readonly docRefs?: readonly KnowledgeDocRef[]
}

/**
 * Which knowledge the current Session may search.
 *
 * `off` is the state a Session starts in and the only one a log without a
 * scope event folds to. Scope narrows authorization and never widens it: `all`
 * means every knowledge base the principal is authorized for at the moment of
 * each call, not every knowledge base that exists.
 *
 * A `selected` scope naming one knowledge base may narrow further, to
 * documents inside it, through {@link KnowledgeScopeBase.docRefs}. No document
 * title is recorded: what the prompt says about such a scope is its knowledge
 * base and how many documents, both of which the log already holds, and the
 * passages a search returns name their documents anyway.
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
  | {
    readonly mode: 'documents'
    /** The one knowledge base to search, authorized as any other. */
    readonly ref: KnowledgeRef
    /** The documents inside it to search; never empty. */
    readonly docRefs: readonly KnowledgeDocRef[]
  }

/** One retrieved passage, already bounded by the provider. */
export interface KnowledgePassage {
  /** Which knowledge base produced it, so a reader can attribute the text. */
  readonly ref: KnowledgeRef
  /**
   * The document it came from, absent when the source named none this build
   * could address. Present, it is what a reader opens and what a conversation
   * narrows to; absent, the knowledge base is as far as either can go.
   */
  readonly docRef?: KnowledgeDocRef
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
  /** The document exists for the source but has no content it will serve. */
  | 'document-unavailable'
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
