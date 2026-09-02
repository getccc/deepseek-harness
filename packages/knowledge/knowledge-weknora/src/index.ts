/**
 * The WeKnora knowledge-source provider: the one place in a Control Plane that
 * holds a knowledge credential and speaks a knowledge product's protocol.
 *
 * It mounts in the Control Plane only. Nothing here knows who is asking — the
 * gateway in front of it has already decided that — so the provider's whole
 * job is to call two fixed endpoints, bound what comes back, and refuse
 * anything it cannot read.
 * @module @deepseek-ai/dsh-knowledge-weknora
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  KNOWLEDGE_REF_SEGMENT,
  KNOWLEDGE_SOURCE_CODE_MAX_LENGTH,
  KnowledgeError,
  type KnowledgeKind,
} from '@deepseek-ai/dsh-knowledge'
import {
  KnowledgeSource,
  type UpstreamKnowledgeBase,
  type UpstreamPassage,
  type UpstreamSearchRequest,
} from '@deepseek-ai/dsh-knowledge-source'
import {
  API_KEY_HEADER,
  ERROR_CODES,
  LIST_PATH,
  REQUEST_ID_HEADER,
  errorCode,
  hybridSearchPath,
  successData,
  type WireKnowledgeBase,
  type WireSearchResult,
} from './wire.ts'

export {
  API_KEY_HEADER,
  API_PREFIX,
  ERROR_CODES,
  LIST_PATH,
  REQUEST_ID_HEADER,
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
      title: result.title,
      text: truncated ? cleaned.slice(0, this.resolved.maxPassageChars) : cleaned,
      truncated,
      score: result.score,
    }
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
    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.credentialRef))
    if (credential === undefined) {
      throw new KnowledgeError('upstream-unavailable', 'no knowledge credential is configured')
    }
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
          [API_KEY_HEADER]: credential.value,
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
    const data = successData(decoded)
    if (data !== undefined) return data
    throw new KnowledgeError(reasonOf(errorCode(decoded), response.status), `${this.providerKind} refused the operation`)
  }
}

/** The fields one search result contributes, once validated. */
interface SearchFields {
  readonly upstreamId: string
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
  return {
    upstreamId,
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

/** The listing row shape this provider reads, for a fixture author. */
export type { WireKnowledgeBase, WireSearchResult }
