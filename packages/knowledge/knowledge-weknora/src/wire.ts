/**
 * The WeKnora HTTP contract this provider speaks: the two endpoints it calls,
 * the envelopes it decodes, and the fields it reads.
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
  readonly chunk_count?: unknown
  readonly processing_count?: unknown
  readonly embedding_model_id?: unknown
  readonly updated_at?: unknown
}

/** One retrieved chunk as `hybrid-search` returns it. */
export interface WireSearchResult {
  readonly id: string
  readonly content: string
  readonly knowledge_base_id: string
  readonly score?: unknown
  readonly chunk_type?: unknown
  readonly knowledge_title?: unknown
}

/**
 * Read a successful envelope's `data` array.
 *
 * Both endpoints answer `{ data: [...], success: true }`. A body that is not
 * that — including one whose `success` is false without an `error` this build
 * maps — is `upstream-invalid` rather than an empty result, because a reader
 * cannot tell a source with nothing from a source it failed to understand.
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
