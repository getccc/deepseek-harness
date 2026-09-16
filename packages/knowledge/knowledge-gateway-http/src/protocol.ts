/**
 * The Runner-facing knowledge protocol: its paths, its version, and the facts
 * a Runner sends.
 *
 * A Runner and the Control Plane ship as separate installations, so the wire
 * facts live in one module that both import rather than in two hand-matched
 * copies.
 * @module @deepseek-ai/dsh-knowledge-gateway-http/protocol
 */

/** Path the Control Plane serves the current principal's authorized directory under. */
export const KNOWLEDGE_CATALOG_PATH = '/team/knowledge/catalog'

/** Path the Control Plane serves one knowledge base's document listing under. */
export const KNOWLEDGE_DOCUMENTS_PATH = '/team/knowledge/documents'

/** Path the Control Plane serves one document's content under. */
export const KNOWLEDGE_DOCUMENT_PATH = '/team/knowledge/document'

/** Path the Control Plane serves governed knowledge search under. */
export const KNOWLEDGE_SEARCH_PATH = '/team/knowledge/search'

/** Header carrying the Runner's device access token. */
export const ACCESS_TOKEN_HEADER = 'authorization'

/**
 * The newest knowledge protocol version this Control Plane answers.
 *
 * Knowledge owns its own version rather than sharing the device-binding one.
 * The two protocols evolve independently: a knowledge-only change must not
 * force the binding version up, and raising the knowledge minimum must not
 * lock an old Runner out of binding, which is the one operation it would need
 * in order to recover.
 */
export const KNOWLEDGE_PROTOCOL_VERSION = 3

/**
 * The version a directory request declares. It is the first version, and the
 * route's facts have not changed since.
 */
export const KNOWLEDGE_CATALOG_VERSION = 1

/** The version a search over whole knowledge bases declares. */
export const KNOWLEDGE_SEARCH_VERSION = 1

/**
 * The version a search narrowed to named documents declares.
 *
 * Narrowing arrived with the document routes, and a Control Plane that
 * predates it would read the request as a search of the whole knowledge base —
 * a wider answer than the member asked for, which is why this is a version and
 * not an extra field an older deployment may ignore.
 */
export const KNOWLEDGE_SEARCH_DOCUMENTS_VERSION = 3

/** The version a document-listing request declares. */
export const KNOWLEDGE_DOCUMENTS_VERSION = 2

/** The version a document-content request declares. */
export const KNOWLEDGE_DOCUMENT_VERSION = 3

/**
 * The oldest knowledge protocol version this Control Plane still answers.
 *
 * Raising it is how a deployment stops serving Runners too old to be trusted
 * with a change — a refusal a Runner can act on, rather than a request that
 * fails for a reason it cannot distinguish from its own mistake. Adding a route
 * does not raise it: a Runner that speaks version 1 keeps its directory and its
 * search, and simply has nothing that calls the newer route.
 *
 * The version comes per request, not per Runner, so the range holds in both
 * directions: a Runner updated ahead of its deployment keeps the routes that
 * deployment has, and only the request declaring a version past
 * {@link KNOWLEDGE_PROTOCOL_VERSION} is refused with `update-required`.
 */
export const MINIMUM_KNOWLEDGE_PROTOCOL_VERSION = 1

/**
 * What a Runner sends to read its authorized directory.
 *
 * The version is the only field, and it is deliberately not optional: a
 * request that omitted it would be a Runner this build cannot identify, and
 * guessing which protocol it meant is how a version check stops being one.
 */
export interface CatalogBody {
  readonly protocolVersion: number
}

/**
 * What a Runner sends to list one knowledge base's documents.
 *
 * The reference is the only thing a Runner names, and it is a governed
 * reference rather than an upstream id: the Control Plane resolves which source
 * holds it, and authorizes the knowledge base before it asks.
 */
export interface DocumentsBody {
  readonly protocolVersion: number
  /** The governed knowledge-base reference to list. */
  readonly ref: string
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many documents one page holds; the deployment's own maximum still applies. */
  readonly pageSize?: number
}

/**
 * What a Runner sends to read one document.
 *
 * The document reference is the only address here, and `maxBytes` is what this
 * Runner can carry rather than what the deployment allows: the Control Plane
 * applies its own bound first, and a file over either is answered as parsed
 * text rather than refused.
 */
export interface DocumentBody {
  readonly protocolVersion: number
  /** The governed document reference to read. */
  readonly docRef: string
  /** The most bytes this Runner accepts; the deployment's own maximum applies first. */
  readonly maxBytes?: number
}

/**
 * How one document's content travels.
 *
 * Bytes are base64 in a JSON body rather than a binary response, because every
 * other knowledge route is JSON and one binary exception would need its own
 * refusal, size, and cancellation handling. The bound that keeps this
 * affordable is the deployment's `maxDocumentBytes`, applied before the file
 * is read.
 */
export type DocumentContentBody =
  | { readonly kind: 'bytes'; readonly docRef: string; readonly fileName: string; readonly contentType: string; readonly base64: string }
  | { readonly kind: 'text'; readonly docRef: string; readonly fileName: string; readonly text: string; readonly truncated: boolean }

/**
 * What a Runner sends to search.
 *
 * There is no source, address, tenant, credential, upstream id, or knowledge
 * base outside the scope here. A Runner names a query and the references its
 * Session scope resolved to; the Control Plane authorizes each one and
 * resolves the rest from the catalog.
 */
export interface SearchBody {
  readonly protocolVersion: number
  readonly query: string
  /**
   * `all` for every authorized base, the exact references to search, or one
   * knowledge base narrowed to documents inside it.
   */
  readonly scope:
    | { readonly mode: 'all' }
    | { readonly mode: 'selected'; readonly refs: readonly string[] }
    | { readonly mode: 'documents'; readonly ref: string; readonly docRefs: readonly string[] }
  /** At most this many passages; the deployment's own maximum still applies. */
  readonly maxResults?: number
  /**
   * Rank documents: the best passages of at most this many distinct
   * documents. No version marks it — a deployment that predates it ignores
   * the field and ranks passages, which answers fewer documents and never a
   * wider scope.
   */
  readonly maxDocuments?: number
}

/**
 * What the Control Plane answers a Runner it refuses.
 *
 * The reason is a closed knowledge failure word, so a Runner distinguishes
 * "sign in again" from "ask an administrator" from "try later" without parsing
 * a message. No upstream text ever reaches it.
 */
export interface KnowledgeRefusal {
  readonly error: string
  readonly reason: string
}

/**
 * What the Control Plane answers a Runner whose protocol version it cannot
 * speak, alongside HTTP 426.
 *
 * The range travels with the refusal because the Runner is the party that has
 * to act on it, and it cannot ask for the range through a protocol the other
 * side has just said it does not speak.
 */
export interface KnowledgeProtocolRefusal extends KnowledgeRefusal {
  readonly reason: 'update-required'
  /** The oldest version this Control Plane answers. */
  readonly minimum: number
  /** The newest version this Control Plane speaks. */
  readonly current: number
}
