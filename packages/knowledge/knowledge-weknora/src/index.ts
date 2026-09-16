/**
 * The WeKnora knowledge-source provider: the one place in a Control Plane that
 * holds a knowledge credential and speaks a knowledge product's protocol.
 *
 * It mounts in the Control Plane only. Nothing here knows who is asking — the
 * gateway in front of it has already decided that — so the provider's whole
 * job is to call a fixed set of endpoints, bound what comes back, and refuse
 * anything it cannot read.
 * @module @deepseek-ai/dsh-knowledge-weknora
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  KNOWLEDGE_DOC_ID_MAX_LENGTH,
  KNOWLEDGE_REF_SEGMENT,
  KNOWLEDGE_SOURCE_CODE_MAX_LENGTH,
  KnowledgeError,
  type KnowledgeDocumentState,
  type KnowledgeKind,
} from '@deepseek-ai/dsh-knowledge'
import {
  KnowledgeSource,
  type UpstreamDocument,
  type UpstreamDocumentContent,
  type UpstreamDocumentPage,
  type UpstreamDocumentPlacement,
  type UpstreamDocumentRequest,
  type UpstreamDocumentsRequest,
  type UpstreamKnowledgeBase,
  type UpstreamPassage,
  type UpstreamSearchRequest,
} from '@deepseek-ai/dsh-knowledge-source'
import {
  API_KEY_HEADER,
  ERROR_CODES,
  LIST_PATH,
  REQUEST_ID_HEADER,
  documentChunksPath,
  documentPath,
  documentPreviewPath,
  documentsPath,
  errorCode,
  hybridSearchPath,
  successData,
  successPage,
  type WireChunk,
  type WireKnowledge,
  type WireKnowledgeBase,
  type WireSearchResult,
} from './wire.ts'

export {
  API_KEY_HEADER,
  API_PREFIX,
  ERROR_CODES,
  LIST_PATH,
  REQUEST_ID_HEADER,
  documentChunksPath,
  documentPath,
  documentPreviewPath,
  documentsPath,
  hybridSearchPath,
} from './wire.ts'

/** What the placeholder replaces an unresolvable source reference with. */
export const RESOURCE_PLACEHOLDER = '[attachment]'

/**
 * References WeKnora leaves in passage text when it is not asked to resolve
 * them into loadable links.
 *
 * `hybrid-search` takes no `resource_urls` parameter — that switch exists only
 * on the chat and session endpoints, none of which is on this path — so the
 * references arrive unresolved, which is what keeps a loadable upstream URL
 * out of a result. Nothing in this delivery can redeem one, so showing a model
 * a scheme it cannot use would only invite a call that cannot happen.
 */
const RESOURCE_REFERENCE = /resource:\/\/\S*/gu

/** Plugin config: which source, where it is, and what it may return. */
export interface Config {
  /** This deployment's code for the source, the second `KnowledgeRef` segment. */
  sourceCode: string
  /** Origin the WeKnora API is served from, such as `http://127.0.0.1:8080`. */
  baseUrl: string
  /**
   * Credential reference resolving to a WeKnora **space** key.
   *
   * A space key is fixed to the space it belongs to. A platform key reaches
   * any space and takes an `X-Tenant-ID` header to say which, so a Control
   * Plane holding one could read knowledge outside the space it governs. That
   * is also why there is no tenant field: with a space key there is nothing
   * to name.
   */
  credentialRef: string
  /** How long one upstream call may take before it is abandoned. */
  requestTimeoutMs?: number
  /** The most passages one search may return, after enrichment. */
  maxSearchResults?: number
  /** The most documents one listing page may return. */
  maxDocumentsPerPage?: number
  /**
   * The largest original file this Control Plane will pull from the source and
   * hold in memory. A document over it is served as parsed text instead.
   */
  maxDocumentBytes?: number
  /** The most characters of parsed text one document may return. */
  maxDocumentTextChars?: number
  /** The most characters one passage may carry. */
  maxPassageChars?: number
}

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** Cordis plugin name. */
export const name = 'knowledge-weknora'

/** How long one upstream call may take when a deployment names no bound. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** The most passages one search returns when a deployment names no bound. */
const DEFAULT_MAX_SEARCH_RESULTS = 20
/** The most characters one passage carries when a deployment names no bound. */
const DEFAULT_MAX_PASSAGE_CHARS = 4_000
/** The most documents one listing page carries when a deployment names no bound. */
const DEFAULT_MAX_DOCUMENTS_PER_PAGE = 100
/** The largest file pulled from the source when a deployment names no bound. */
const DEFAULT_MAX_DOCUMENT_BYTES = 16 * 1024 * 1024
/** The most characters of parsed text returned when a deployment names no bound. */
const DEFAULT_MAX_DOCUMENT_TEXT_CHARS = 200_000

/**
 * A WeKnora deployment, as a knowledge source.
 *
 * Every bound is a validated config field rather than a constant, because the
 * right values vary with how much retrieved text a deployment is willing to
 * put in a model request.
 */
export default class WeknoraKnowledgeSource extends KnowledgeSource {
  static inject = ['credentials']

  static Config: z<Config> = z.object({
    sourceCode: z.string().required(),
    baseUrl: z.string().required(),
    credentialRef: z.string().required(),
    requestTimeoutMs: z.natural().default(DEFAULT_REQUEST_TIMEOUT_MS),
    maxSearchResults: z.natural().default(DEFAULT_MAX_SEARCH_RESULTS),
    maxPassageChars: z.natural().default(DEFAULT_MAX_PASSAGE_CHARS),
    maxDocumentsPerPage: z.natural().min(1).default(DEFAULT_MAX_DOCUMENTS_PER_PAGE),
    maxDocumentBytes: z.natural().min(1).default(DEFAULT_MAX_DOCUMENT_BYTES),
    maxDocumentTextChars: z.natural().min(1).default(DEFAULT_MAX_DOCUMENT_TEXT_CHARS),
  })

  override readonly providerKind = 'weknora'
  override readonly sourceCode: string

  private readonly origin: string
  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Load-time, because each of these makes every later operation fail in a
    // way that reads as an outage rather than as the configuration mistake it
    // is. The source-code rule is the audit token bound that shapes every
    // KnowledgeRef this source will mint.
    if (!KNOWLEDGE_REF_SEGMENT.test(config.sourceCode)
      || config.sourceCode.length > KNOWLEDGE_SOURCE_CODE_MAX_LENGTH) {
      throw new Error(`knowledge-weknora: sourceCode ${JSON.stringify(config.sourceCode)} must be 1-${String(KNOWLEDGE_SOURCE_CODE_MAX_LENGTH)} characters over letters, digits, and . _ @ -`)
    }
    if (!isCredentialRefName(config.credentialRef)) {
      throw new Error(`knowledge-weknora: credentialRef ${JSON.stringify(config.credentialRef)} is not a credential reference`)
    }
    let parsed: URL
    try {
      parsed = new URL(config.baseUrl)
    } catch {
      // URL is the only throw here, and its message names the input; a config
      // error should name the field instead.
      throw new Error(`knowledge-weknora: baseUrl ${JSON.stringify(config.baseUrl)} is not a URL`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`knowledge-weknora: baseUrl ${JSON.stringify(config.baseUrl)} must be http or https`)
    }
    this.origin = parsed.origin
    this.sourceCode = config.sourceCode
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
  }

  async list(signal?: AbortSignal): Promise<readonly UpstreamKnowledgeBase[]> {
    const data = await this.call(LIST_PATH, undefined, signal)
    return data.map(entry => toKnowledgeBase(entry))
  }

  async listDocuments(request: UpstreamDocumentsRequest): Promise<UpstreamDocumentPage> {
    const pageSize = Math.min(request.pageSize, this.resolved.maxDocumentsPerPage)
    const query = new URLSearchParams({ page: String(request.page), page_size: String(pageSize) })
    const page = await this.page(`${documentsPath(request.upstreamId)}?${query.toString()}`, request.signal)
    return {
      documents: page.data.map(entry => toDocument(entry)),
      pageSize,
      total: page.total,
    }
  }

  async describeDocument(upstreamDocId: string, signal?: AbortSignal): Promise<UpstreamDocumentPlacement> {
    const row = await this.record(documentPath(upstreamDocId), signal)
    const upstreamId = row['knowledge_base_id']
    if (typeof upstreamId !== 'string' || upstreamId === '') {
      // Without the knowledge base there is nothing to authorize, which makes
      // this unreadable rather than a document that happens to be missing one.
      throw new KnowledgeError('upstream-invalid', 'a document record is missing its knowledge base')
    }
    return { upstreamId, document: toDocument(row) }
  }

  async fetchDocument(request: UpstreamDocumentRequest): Promise<UpstreamDocumentContent> {
    const placement = await this.describeDocument(request.upstreamDocId, request.signal)
    const { fileName, byteSize } = placement.document
    const bound = Math.min(request.maxBytes, this.resolved.maxDocumentBytes)
    // The size the source reports decides this, because reading the file to
    // find out would mean pulling bytes nobody can be served.
    const servable = fileName !== '' && byteSize > 0 && byteSize <= bound
    if (servable) {
      const bytes = await this.bytes(documentPreviewPath(request.upstreamDocId), bound, request.signal)
      if (bytes !== undefined) {
        return { kind: 'bytes', fileName, contentType: contentTypeOf(fileName), bytes }
      }
    }
    return this.text(request, fileName)
  }

  async search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]> {
    // Never empty by contract, and the gateway proves it before calling; an
    // empty array would ask WeKnora to fall back to its path id, which is the
    // one way this request could search something nobody authorized.
    const [first] = request.upstreamIds
    if (first === undefined) throw new KnowledgeError('upstream-invalid', 'search scope is empty')
    const bound = Math.min(request.maxResults, this.resolved.maxSearchResults)
    const data = await this.call(hybridSearchPath(first), {
      query_text: request.query,
      match_count: bound,
      knowledge_base_ids: [...request.upstreamIds],
      // Present only when the caller narrowed to documents: the field means
      // "inside these", and an empty array would mean the opposite upstream.
      ...(request.upstreamDocIds === undefined ? {} : { knowledge_ids: [...request.upstreamDocIds] }),
    }, request.signal)
    const authorized = new Set(request.upstreamIds)
    const passages: UpstreamPassage[] = []
    for (const entry of data) {
      const result = toSearchResult(entry)
      // Non-text chunks carry their payload in `image_info`, which this
      // delivery has no way to redeem, and a hit from a base nobody named is
      // one the gateway never authorized.
      if (result.chunkType !== 'text' || !authorized.has(result.upstreamId)) continue
      passages.push(this.toPassage(result))
      // `match_count` is not a hard cap while context enrichment is on: the
      // endpoint returns the top matches plus their parent, nearby, and
      // relation chunks, so asking for ten answers with eleven. Enrichment is
      // kept — the surrounding context is what partly stands in for the
      // document read this delivery does not have — and the bound is applied
      // here instead.
      if (passages.length === bound) break
    }
    return passages
  }

  /** Cut one wire result down to what may leave this module. */
  private toPassage(result: SearchFields): UpstreamPassage {
    const cleaned = result.content.replace(RESOURCE_REFERENCE, RESOURCE_PLACEHOLDER)
    const truncated = cleaned.length > this.resolved.maxPassageChars
    return {
      upstreamId: result.upstreamId,
      ...(result.upstreamDocId === '' ? {} : { upstreamDocId: result.upstreamDocId }),
      title: result.title,
      text: truncated ? cleaned.slice(0, this.resolved.maxPassageChars) : cleaned,
      truncated,
      score: result.score,
    }
  }

  /**
   * The parsed text of one document, as the chunk listing holds it.
   *
   * Chunks are ordered by the index the source gives them, because their
   * order in the answer is not the document's. A document with no text chunks
   * at all is `document-unavailable`: the source has the document and nothing
   * it will serve from it, which is a different fact from a failure.
   */
  private async text(request: UpstreamDocumentRequest, fileName: string): Promise<UpstreamDocumentContent> {
    const data = await this.call(documentChunksPath(request.upstreamDocId), undefined, request.signal)
    const chunks = data.flatMap((entry) => {
      const chunk = asRecord(entry) as unknown as WireChunk
      const text = typeof chunk.content === 'string' ? chunk.content : ''
      if (text === '' || (typeof chunk.chunk_type === 'string' && chunk.chunk_type !== 'text')) return []
      return [{ index: count(chunk.chunk_index), text }]
    })
    if (chunks.length === 0) {
      throw new KnowledgeError('document-unavailable', 'the source serves neither a file nor text for this document')
    }
    chunks.sort((left, right) => left.index - right.index)
    const joined = chunks.map(chunk => chunk.text).join('\n\n')
    const bound = Math.min(request.maxTextChars, this.resolved.maxDocumentTextChars)
    const truncated = joined.length > bound
    return { kind: 'text', fileName, text: truncated ? joined.slice(0, bound) : joined, truncated }
  }

  /**
   * One document record, which every content operation starts from.
   *
   * The record endpoint answers a single object under `data` rather than an
   * array, so it is read with its own envelope reader instead of the one the
   * listings share.
   */
  private async record(path: string, signal: AbortSignal | undefined): Promise<Record<string, unknown>> {
    return this.request(path, undefined, signal, (decoded) => {
      if (typeof decoded !== 'object' || decoded === null) return undefined
      const body = decoded as Record<string, unknown>
      if (body['success'] !== true) return undefined
      const data = body['data']
      return typeof data === 'object' && data !== null && !Array.isArray(data)
        ? data as Record<string, unknown>
        : undefined
    })
  }

  /**
   * The bytes one file endpoint serves, or undefined when they do not fit.
   *
   * The bound is enforced against what actually arrived as well as against the
   * declared length, because a source that under-reports a length would
   * otherwise decide how much memory this process spends. Not fitting is not a
   * failure: the caller falls back to text.
   */
  private async bytes(
    path: string,
    bound: number,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array | undefined> {
    const credential = await this.credential()
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, this.resolved.requestTimeoutMs)
    const deadline = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
    try {
      const response = await fetch(new URL(path, this.origin), {
        method: 'GET',
        headers: { [API_KEY_HEADER]: credential, [REQUEST_ID_HEADER]: randomUUID() },
        signal: deadline,
      })
      if (!response.ok) {
        throw new KnowledgeError(reasonOf(undefined, response.status), `${this.providerKind} refused the file`)
      }
      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > bound) return undefined
      const buffer = await response.arrayBuffer()
      return buffer.byteLength > bound ? undefined : new Uint8Array(buffer)
    } catch (error) {
      if (error instanceof KnowledgeError) throw error
      // fetch rejects for a refused connection, a TLS failure, and the abort
      // above alike; all of them are "the source did not answer" here.
      throw new KnowledgeError('upstream-unavailable', `${this.providerKind} did not answer`)
    } finally {
      clearTimeout(timeout)
    }
  }

  /** The current knowledge credential, or the reason there is none. */
  private async credential(): Promise<string> {
    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.credentialRef))
    if (credential === undefined) {
      throw new KnowledgeError('upstream-unavailable', 'no knowledge credential is configured')
    }
    return credential.value
  }

  /**
   * Perform one upstream GET and return its page, total included.
   *
   * Separate from {@link call} because only this envelope carries counts, and a
   * caller that read them off the other one would be reading a field the
   * endpoint does not send.
   */
  private async page(
    path: string,
    signal: AbortSignal | undefined,
  ): Promise<{ readonly data: readonly unknown[]; readonly total: number | undefined }> {
    return this.request(path, undefined, signal, successPage)
  }

  /**
   * Perform one upstream call and return its `data` array.
   *
   * The credential is resolved per operation rather than held, so a rotation
   * takes effect on the next call. It is attached here and nowhere else.
   */
  private async call(
    path: string,
    body: Record<string, unknown> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<readonly unknown[]> {
    return this.request(path, body, signal, successData)
  }

  /**
   * One upstream request, decoded by the envelope reader its endpoint answers
   * with. Everything both readers share — the credential, the deadline, the
   * failure mapping — happens here once.
   */
  private async request<T>(
    path: string,
    body: Record<string, unknown> | undefined,
    signal: AbortSignal | undefined,
    read: (decoded: unknown) => T | undefined,
  ): Promise<T> {
    const credential = await this.credential()
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, this.resolved.requestTimeoutMs)
    // `AbortSignal.any` rather than a listener on the caller's signal: a
    // caller that aborted before this line would never fire one, and the
    // request would go out on behalf of an operation nobody is waiting for.
    const deadline = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
    let response: Response
    try {
      response = await fetch(new URL(path, this.origin), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          [API_KEY_HEADER]: credential,
          [REQUEST_ID_HEADER]: randomUUID(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: deadline,
      })
    } catch {
      // fetch rejects for a refused connection, DNS failure, TLS failure, and
      // the abort above alike. All of them are the same fact to a reader: the
      // source did not answer. The rejection's own text can name an internal
      // address, so it stays here.
      throw new KnowledgeError('upstream-unavailable', `${this.providerKind} did not answer`)
    } finally {
      clearTimeout(timeout)
    }
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch {
      // A non-JSON body is a proxy error page or a truncated response; either
      // way this build cannot read it, and its text is not ours to forward.
      throw new KnowledgeError('upstream-invalid', `${this.providerKind} answered a body this build cannot read`)
    }
    const value = read(decoded)
    if (value !== undefined) return value
    throw new KnowledgeError(reasonOf(errorCode(decoded), response.status), `${this.providerKind} refused the operation`)
  }
}

/** The fields one search result contributes, once validated. */
interface SearchFields {
  readonly upstreamId: string
  /** Empty when the hit named no document this build could address. */
  readonly upstreamDocId: string
  readonly title: string
  readonly content: string
  readonly score: number
  readonly chunkType: string
}

/**
 * Map an upstream refusal onto a closed reason.
 *
 * Availability and readability are the only two distinctions a caller can act
 * on: a misconfigured key, a revoked key, and a rate limit are all "this
 * source is not answering us right now" to the member waiting on it, and the
 * operator diagnoses which in the WeKnora deployment's own logs.
 */
function reasonOf(code: number | undefined, status: number): 'upstream-unavailable' | 'upstream-invalid' {
  if (code === undefined) return status >= 500 ? 'upstream-unavailable' : 'upstream-invalid'
  switch (code) {
    case ERROR_CODES.internalServer:
    case ERROR_CODES.serviceUnavailable:
    case ERROR_CODES.timeout:
    case ERROR_CODES.tooManyRequests:
    case ERROR_CODES.unauthorized:
    case ERROR_CODES.forbidden:
      return 'upstream-unavailable'
    default:
      return 'upstream-invalid'
  }
}

/** Validate one listing entry, refusing a row this build cannot use. */
function toKnowledgeBase(entry: unknown): UpstreamKnowledgeBase {
  const row = asRecord(entry)
  const id = row['id']
  const name = row['name']
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') {
    throw new KnowledgeError('upstream-invalid', 'a knowledge base is missing its id or name')
  }
  return {
    upstreamId: id,
    name,
    description: text(row['description']),
    kind: row['type'] === 'faq' ? 'faq' satisfies KnowledgeKind : 'document',
    documentCount: count(row['knowledge_count']),
    processingCount: count(row['processing_count']),
    embeddingModelId: text(row['embedding_model_id']),
    updatedAt: timestamp(row['updated_at']),
    createdAt: timestamp(row['created_at']),
  }
}

/**
 * Validate one document row, refusing one this build could not address.
 *
 * The id is the only required field, and it has to be one a governed reference
 * can carry: a row without such an id is a document no later operation could
 * name, while a missing title or file name is a document the source simply
 * holds less about.
 */
function toDocument(entry: unknown): UpstreamDocument {
  const row = asRecord(entry)
  const id = row['id']
  if (typeof id !== 'string' || id === '') {
    throw new KnowledgeError('upstream-invalid', 'a document is missing its id')
  }
  // The governed reference grammar, checked here so the gateway can mint a
  // reference from this id without a second guard. A source that answered an
  // id outside it is a source this build cannot address.
  if (!KNOWLEDGE_REF_SEGMENT.test(id) || id.length > KNOWLEDGE_DOC_ID_MAX_LENGTH) {
    throw new KnowledgeError('upstream-invalid', 'a document id is not one this build can address')
  }
  const knowledge: WireKnowledge = row as unknown as WireKnowledge
  return {
    upstreamDocId: id,
    title: text(knowledge.title),
    description: text(knowledge.description),
    fileName: text(knowledge.file_name),
    fileType: text(knowledge.file_type),
    byteSize: count(knowledge.file_size),
    state: documentState(text(knowledge.parse_status), text(knowledge.enable_status)),
    // The source reports three timestamps and they answer different questions;
    // the most recent change a member cares about is when it was last written,
    // then when it finished parsing, then when it arrived.
    updatedAt: timestamp(knowledge.updated_at) ?? timestamp(knowledge.processed_at) ?? timestamp(knowledge.created_at),
  }
}

/**
 * Read a source's parse and enablement words as one product state.
 *
 * `ready` is claimed only for a document the source both finished parsing and
 * has switched on, because that is the pair that decides whether retrieval
 * reaches it. Everything else is either still in progress or will not be
 * retrieved, and a word this build does not know takes the second reading.
 */
function documentState(parseStatus: string, enableStatus: string): KnowledgeDocumentState {
  switch (parseStatus) {
    case 'completed':
      return enableStatus === 'disabled' ? 'unavailable' : 'ready'
    case 'pending':
    case 'processing':
    case 'finalizing':
      return 'processing'
    default:
      return 'unavailable'
  }
}

/** Validate one search result, refusing a row this build cannot attribute. */
function toSearchResult(entry: unknown): SearchFields {
  const row = asRecord(entry)
  const upstreamId = row['knowledge_base_id']
  const content = row['content']
  if (typeof upstreamId !== 'string' || upstreamId === '' || typeof content !== 'string') {
    throw new KnowledgeError('upstream-invalid', 'a search result is missing its knowledge base or content')
  }
  const result: WireSearchResult = row as unknown as WireSearchResult
  // A document id the governed reference could not carry is dropped rather
  // than refused: the passage is still attributable to its knowledge base,
  // which is what a result needs, and only the "open it" step is lost.
  const docId = text(result.knowledge_id)
  const addressable = docId !== '' && KNOWLEDGE_REF_SEGMENT.test(docId) && docId.length <= KNOWLEDGE_DOC_ID_MAX_LENGTH
  return {
    upstreamId,
    upstreamDocId: addressable ? docId : '',
    content,
    title: text(result.knowledge_title),
    score: typeof result.score === 'number' && Number.isFinite(result.score) ? result.score : 0,
    chunkType: typeof result.chunk_type === 'string' ? result.chunk_type : 'text',
  }
}

/** Narrow one decoded array element to string-keyed fields. */
function asRecord(entry: unknown): Record<string, unknown> {
  if (typeof entry !== 'object' || entry === null) {
    throw new KnowledgeError('upstream-invalid', 'an entry is not an object')
  }
  return entry as Record<string, unknown>
}

/** An optional upstream string, absent when the source supplies none. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** An optional upstream count, zero when the source supplies none. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

/** An optional upstream timestamp, in epoch milliseconds. */
function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * The media type a file name is served as.
 *
 * Derived from the name rather than forwarded from the source: the bytes reach
 * a browser, and a type a source chose is a type a source could use to make a
 * browser treat a file as something else. The set is what this build's
 * renderers can draw; anything else is delivered as an opaque download type.
 * @param fileName - the document's original file name.
 * @returns the media type to serve the bytes as.
 */
export function contentTypeOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const extension = dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

/** Media types by file extension, for the kinds a preview can draw. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** The row shapes this provider reads, for a fixture author. */
export type { WireChunk, WireKnowledge, WireKnowledgeBase, WireSearchResult }
