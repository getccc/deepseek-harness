/**
 * The upstream knowledge-source seam: what a Control Plane provider offers the
 * governed gateway in front of it.
 *
 * This is the only place an upstream knowledge product is spoken to, and it is
 * mounted in the Control Plane alone. Every operation is one the gateway can
 * authorize: enumerate what a source holds, list one knowledge base's
 * documents, and search an explicit set of its knowledge bases. There is no
 * operation that takes a URL, a caller-chosen header, or an arbitrary upstream
 * path, so the gateway cannot be talked into an operation the permission
 * catalog does not govern.
 *
 * Everything here is in upstream terms — upstream ids, not `KnowledgeRef`s —
 * because mapping between the two is the catalog's job, and a provider that
 * knew about governed resources would be authorizing.
 * @module @deepseek-ai/dsh-knowledge-source
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { KnowledgeDocumentState, KnowledgeKind } from '@deepseek-ai/dsh-knowledge'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeSource: KnowledgeSource
  }
}

/** One knowledge base as its upstream source describes it. */
export interface UpstreamKnowledgeBase {
  /** The source's own identifier, meaningful only to this provider. */
  readonly upstreamId: string
  readonly name: string
  /** Empty when the source supplies none. */
  readonly description: string
  readonly kind: KnowledgeKind
  readonly documentCount: number
  /** Documents the source is still ingesting. */
  readonly processingCount: number
  /**
   * Which embedding model indexes this knowledge base.
   *
   * The catalog records it because multi-base retrieval is only defined for
   * knowledge bases that share one: the gateway refuses a mixed set rather
   * than sending an upstream request whose behavior nobody specified.
   */
  readonly embeddingModelId: string
  /** Epoch milliseconds, or undefined when the source supplies no timestamp. */
  readonly updatedAt: number | undefined
  /** When the source created it, in epoch milliseconds, or undefined when it supplies none. */
  readonly createdAt: number | undefined
}

/** What the gateway asks a source for one page of a knowledge base's documents. */
export interface UpstreamDocumentsRequest {
  /** The knowledge base to list, already authorized. */
  readonly upstreamId: string
  /** Which page, counting from one. */
  readonly page: number
  /** How many documents to return, before the provider's own maximum applies. */
  readonly pageSize: number
  readonly signal?: AbortSignal
}

/** One document as its upstream source describes it. */
export interface UpstreamDocument {
  /**
   * The source's own document identifier, meaningful only to this provider.
   *
   * A provider returns only ids the governed reference grammar accepts —
   * within `KNOWLEDGE_DOC_ID_MAX_LENGTH` and over the reference alphabet — and
   * refuses a row with anything else as `upstream-invalid`. That is what lets
   * the gateway mint a reference from one without a second guard: a document
   * it could not address is one no later operation could name.
   */
  readonly upstreamDocId: string
  /** Empty when the source supplies none. */
  readonly title: string
  /**
   * The source's own summary of the document, empty when it supplies none.
   *
   * Upstream text, like a passage: it reaches a browser as display copy and is
   * never an instruction to anything that reads it.
   */
  readonly description: string
  /** Empty for a document the source holds no file for. */
  readonly fileName: string
  /** The source's own word for the file kind, empty when it supplies none. */
  readonly fileType: string
  /** Zero when the source supplies none. */
  readonly byteSize: number
  /** The provider's reading of the source's ingestion and enablement state. */
  readonly state: KnowledgeDocumentState
  /** Epoch milliseconds, or undefined when the source supplies no timestamp. */
  readonly updatedAt: number | undefined
}

/** One page of documents, with the total the source reports. */
export interface UpstreamDocumentPage {
  readonly documents: readonly UpstreamDocument[]
  /** The page size the provider applied, after its own maximum. */
  readonly pageSize: number
  /** Undefined when the source reports no total; never inferred from a page. */
  readonly total: number | undefined
}

/** What the gateway asks a source about where one document sits. */
export interface UpstreamDocumentPlacement {
  /** The knowledge base the source says holds it. */
  readonly upstreamId: string
  /** The document itself, as a listing would describe it. */
  readonly document: UpstreamDocument
}

/** What the gateway asks a source for one document's content. */
export interface UpstreamDocumentRequest {
  /** The document to read; its knowledge base is already authorized. */
  readonly upstreamDocId: string
  /**
   * The most bytes to return. A file over it is answered as parsed text
   * instead of refused, because the text is the part of the document that
   * still fits; the provider's own maximum applies first.
   */
  readonly maxBytes: number
  /** The most characters of parsed text to return when text is answered. */
  readonly maxTextChars: number
  readonly signal?: AbortSignal
}

/**
 * One document's content as its source serves it.
 *
 * `bytes` is the original file and is never partial: a provider that cannot
 * deliver the whole file within the caller's bound answers `text` instead.
 */
export type UpstreamDocumentContent =
  | { readonly kind: 'bytes'; readonly fileName: string; readonly contentType: string; readonly bytes: Uint8Array }
  | { readonly kind: 'text'; readonly fileName: string; readonly text: string; readonly truncated: boolean }

/** What the gateway asks a source to search. */
export interface UpstreamSearchRequest {
  /**
   * The upstream ids to search, already authorized. Never empty: an empty set
   * is not a request for everything, and a provider that widened one would be
   * making a decision the gateway already made.
   */
  readonly upstreamIds: readonly string[]
  /**
   * Narrow the search to these documents inside the single knowledge base
   * `upstreamIds` names. Absent searches the whole knowledge base; present and
   * empty is not a thing a caller may ask for, because it would read as "no
   * documents" and answer as "every document".
   */
  readonly upstreamDocIds?: readonly string[]
  readonly query: string
  /** The most passages to return, after the provider's own bounds apply. */
  readonly maxResults: number
  readonly signal?: AbortSignal
}

/** One passage a source returned, already bounded and cleaned by its provider. */
export interface UpstreamPassage {
  /** Which knowledge base produced it, so the gateway can map it back. */
  readonly upstreamId: string
  /**
   * The document it came from, absent when the source named none the governed
   * document reference could carry. A provider answers it when it can: it is
   * what lets a reader open the document a passage is in.
   */
  readonly upstreamDocId?: string
  /** The source document's title, empty when the source supplies none. */
  readonly title: string
  /** Passage text with any unresolvable source reference neutralized. */
  readonly text: string
  /** Whether {@link text} was cut to the provider's per-passage maximum. */
  readonly truncated: boolean
  readonly score: number
}

/**
 * One upstream knowledge product. A provider mounts this service; the governed
 * gateway injects `knowledgeSource`.
 *
 * Failures are raised as `KnowledgeError` with `upstream-unavailable` or
 * `upstream-invalid`. A provider never raises an authorization reason: it does
 * not know who is asking, which is the point.
 */
export abstract class KnowledgeSource extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledgeSource')
  }

  /**
   * Which upstream product this is, as the first segment of a `KnowledgeRef`.
   *
   * A constant of the provider rather than configuration: it names the code
   * that speaks the protocol, and a deployment renaming it would change the
   * identity of every knowledge base already governed.
   */
  abstract readonly providerKind: string

  /**
   * The deployment's code for this source, as the second `KnowledgeRef`
   * segment. Configuration, because one company's `prod` is another's `kb`.
   */
  abstract readonly sourceCode: string

  /**
   * Everything the configured source holds.
   * @param signal - aborts the operation.
   * @returns every knowledge base, in whatever order the source lists them.
   * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
   */
  abstract list(signal?: AbortSignal): Promise<readonly UpstreamKnowledgeBase[]>

  /**
   * One page of the documents in one already-authorized knowledge base.
   * @param request - the authorized upstream id, and which page of it.
   * @returns the page, empty when the knowledge base holds no document.
   * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
   */
  abstract listDocuments(request: UpstreamDocumentsRequest): Promise<UpstreamDocumentPage>

  /**
   * Where one document sits, so the gateway can authorize the knowledge base
   * that holds it before asking for anything in it.
   * @param upstreamDocId - the source's own document id.
   * @param signal - aborts the operation.
   * @returns the knowledge base it belongs to, and the document.
   * @throws {KnowledgeError} `upstream-unavailable`, `upstream-invalid`, or
   * `document-unavailable` when the source holds no such document.
   */
  abstract describeDocument(upstreamDocId: string, signal?: AbortSignal): Promise<UpstreamDocumentPlacement>

  /**
   * One already-authorized document's content.
   * @param request - the document and the caller's bounds.
   * @returns the original file, or the parsed text when the file does not fit or does not exist.
   * @throws {KnowledgeError} `upstream-unavailable`, `upstream-invalid`, or
   * `document-unavailable` when the source will serve neither a file nor text.
   */
  abstract fetchDocument(request: UpstreamDocumentRequest): Promise<UpstreamDocumentContent>

  /**
   * Search an explicit, already-authorized set of knowledge bases.
   * @param request - the authorized upstream ids, the query, and the result bound.
   * @returns the passages, at most `maxResults` of them.
   * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
   */
  abstract search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]>
}
