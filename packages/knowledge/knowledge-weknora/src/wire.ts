/**
 * The WeKnora HTTP contract this provider speaks: the endpoints it calls, the
 * envelopes it decodes, and the fields it reads.
 *
 * Pinned against a live deployment's own OpenAPI document and responses rather
 * than the upstream repository's published Markdown, which describes a
 * top-level `POST /knowledge-search` that deployments do not serve and omits
 * fields they do return. A provider written from the prose would call an
 * endpoint that is not there.
 * @module @deepseek-ai/dsh-knowledge-weknora/wire
 */

/** Path prefix every endpoint sits under. */
export const API_PREFIX = '/api/v1'

/** Lists the knowledge bases the API key's space owns. */
export const LIST_PATH = `${API_PREFIX}/knowledge-bases`

/**
 * Vector-plus-keyword retrieval within one knowledge base, or across several
 * when the body names them.
 *
 * The path id is required even when `knowledge_base_ids` overrides the scope,
 * and it must be a member of that list: a path id outside it is refused with
 * `ErrNotFound`. The provider therefore puts an authorized id in the path and
 * the full authorized set in the body, so the path can never widen scope.
 * @param upstreamId - an authorized knowledge base id to address the endpoint with.
 * @returns the path to POST to.
 */
export function hybridSearchPath(upstreamId: string): string {
  return `${API_PREFIX}/knowledge-bases/${encodeURIComponent(upstreamId)}/hybrid-search`
}

/**
 * One page of the documents in one knowledge base.
 *
 * Paginated with `page` (counting from one) and `page_size`, and its envelope
 * carries `total` beside `data` — the only endpoint here whose answer says how
 * much more there is.
 * @param upstreamId - an authorized knowledge base id.
 * @returns the path to GET, without its query.
 */
export function documentsPath(upstreamId: string): string {
  return `${API_PREFIX}/knowledge-bases/${encodeURIComponent(upstreamId)}/knowledge`
}

/**
 * One document's own record, which is what says which knowledge base holds it.
 * @param upstreamDocId - the source's document id.
 * @returns the path to GET.
 */
export function documentPath(upstreamDocId: string): string {
  return `${API_PREFIX}/knowledge/${encodeURIComponent(upstreamDocId)}`
}

/**
 * The original file, typed by its name for in-browser display.
 *
 * `preview` rather than `download`: the two serve the same bytes, but upstream
 * guards `download` with a contributor-and-write check while `preview` needs
 * only read access. A read-only product surface must not be built on a write
 * guard.
 * @param upstreamDocId - the source's document id.
 * @returns the path to GET.
 */
export function documentPreviewPath(upstreamDocId: string): string {
  return `${API_PREFIX}/knowledge/${encodeURIComponent(upstreamDocId)}/preview`
}

/**
 * The parsed chunks of one document, which is what stands in for a file the
 * caller cannot accept or the source does not hold.
 * @param upstreamDocId - the source's document id.
 * @returns the path to GET.
 */
export function documentChunksPath(upstreamDocId: string): string {
  return `${API_PREFIX}/chunks/${encodeURIComponent(upstreamDocId)}`
}

/** The header WeKnora authenticates with. */
export const API_KEY_HEADER = 'X-API-Key'

/** The header carrying this provider's own correlation id for one call. */
export const REQUEST_ID_HEADER = 'X-Request-ID'

/**
 * The error codes this build maps.
 *
 * WeKnora answers failures as `{ error: { code, message, details }, success:
 * false }` — the envelope nests `AppError` rather than returning it flat, as
 * its OpenAPI document declares. Only `code` is read; `message` and `details`
 * are upstream prose and never leave this module.
 */
export const ERROR_CODES = {
  badRequest: 1000,
  unauthorized: 1001,
  forbidden: 1002,
  notFound: 1003,
  tooManyRequests: 1006,
  internalServer: 1007,
  serviceUnavailable: 1008,
  timeout: 1009,
  validation: 1010,
} as const

/** One knowledge base as `GET /knowledge-bases` returns it. */
export interface WireKnowledgeBase {
  readonly id: string
  readonly name: string
  readonly description?: unknown
  readonly type?: unknown
  readonly knowledge_count?: unknown
  readonly processing_count?: unknown
  readonly embedding_model_id?: unknown
  readonly updated_at?: unknown
  readonly created_at?: unknown
}

/**
 * One document as a knowledge listing returns it.
 *
 * `parse_status` is `pending`, `processing`, `finalizing`, `completed`,
 * `failed`, `cancelled`, or `deleting`; `enable_status` is `enabled` or
 * `disabled`. Both are read as words rather than validated as enums: a source
 * that adds a state must not make a listing unreadable, and a state this build
 * does not know is the one it promises least about.
 */
export interface WireKnowledge {
  readonly id: string
  readonly title?: unknown
  /** The source's generated summary; absent until its summarization has run. */
  readonly description?: unknown
  readonly file_name?: unknown
  readonly file_type?: unknown
  readonly file_size?: unknown
  readonly parse_status?: unknown
  readonly enable_status?: unknown
  readonly updated_at?: unknown
  readonly processed_at?: unknown
  readonly created_at?: unknown
}

/**
 * One parsed chunk as a chunk listing returns it.
 *
 * `content` is the text; `chunk_index` is its position in the document, which
 * is what lets a reader reassemble them in the source's own order.
 */
export interface WireChunk {
  readonly id: string
  readonly content?: unknown
  readonly chunk_index?: unknown
  readonly chunk_type?: unknown
}

/** One retrieved chunk as `hybrid-search` returns it. */
export interface WireSearchResult {
  readonly id: string
  readonly content: string
  readonly knowledge_base_id: string
  readonly knowledge_id?: unknown
  readonly score?: unknown
  readonly chunk_type?: unknown
  readonly knowledge_title?: unknown
}

/**
 * Read a successful envelope's `data` array.
 *
 * Every endpoint answers `{ data: [...], success: true }`, the paginated one
 * with counts beside it. A body that is not that — including one whose
 * `success` is false without an `error` this build maps — is
 * `upstream-invalid` rather than an empty result, because a reader cannot tell
 * a source with nothing from a source it failed to understand.
 * @param body - the decoded JSON body.
 * @returns the data array, or undefined when the envelope is not a success envelope.
 */
export function successData(body: unknown): readonly unknown[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (record['success'] !== true) return undefined
  const data = record['data']
  return Array.isArray(data) ? data : undefined
}

/**
 * Read a paginated envelope's `data` array and the total beside it.
 *
 * The listing endpoint answers `{ data: [...], page, page_size, total,
 * success: true }`. The total is read only when it is a whole count: a missing
 * or unreadable one means "the source did not say", which a reader must not
 * mistake for zero.
 * @param body - the decoded JSON body.
 * @returns the data array with the reported total, or undefined when the envelope is not a success envelope.
 */
export function successPage(body: unknown): { readonly data: readonly unknown[]; readonly total: number | undefined } | undefined {
  const data = successData(body)
  if (data === undefined) return undefined
  const total = (body as Record<string, unknown>)['total']
  return {
    data,
    total: typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : undefined,
  }
}

/**
 * Read a failure envelope's numeric code.
 * @param body - the decoded JSON body.
 * @returns the upstream error code, or undefined when the body carries none.
 */
export function errorCode(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as Record<string, unknown>)['error']
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as Record<string, unknown>)['code']
  return typeof code === 'number' ? code : undefined
}
