/**
 * The excel-tools GMO-source provider: the one place in a Control Plane that
 * holds the excel-tools gateway token and speaks its protocol.
 *
 * It mounts in the Control Plane only. Nothing here knows who is asking; the
 * gateway in front of it has already decided that. The provider's whole job is
 * to call a fixed set of read-only routes, bound what goes out and what comes
 * back, and refuse anything it cannot read.
 * @module @deepseek-ai/dsh-gmo-excel-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  GMO_REF_MAX_LENGTH,
  GMO_REF_SEGMENT,
  GMO_RESULT_ID_MAX_LENGTH,
  GMO_SOURCE_CODE_MAX_LENGTH,
  GmoError,
  type GmoDashboard,
  type GmoFailureReason,
  type GmoField,
  type GmoFilters,
  type GmoJson,
  type GmoQuery,
} from '@deepseek-ai/dsh-gmo'
import {
  GmoSource,
  type UpstreamAnswer,
  type UpstreamAskRequest,
  type UpstreamCategory,
  type UpstreamDescription,
  type UpstreamPlacement,
  type UpstreamResult,
  type UpstreamResultListing,
  type UpstreamResultsRequest,
  type UpstreamStage,
} from '@deepseek-ai/dsh-gmo-source'

/** Plugin config: which source, where it is, and what it may return. */
export interface Config {
  /** This deployment's code for the source, the second `GmoCategoryRef` segment. */
  sourceCode: string
  /** Origin the excel-tools service is served from, such as `http://10.1.120.90:8700`. */
  baseUrl: string
  /**
   * Credential reference resolving to an excel-tools gateway token, created in
   * its 管理 → 对话网关 page. The token reads statistics only: the gateway
   * serves no export, download, deletion, upload, or tool run.
   */
  credentialRef: string
  /** How long one upstream HTTP call may take before it is abandoned. */
  requestTimeoutMs?: number
  /** The most rows, groups, results, or ranked entries one request asks the source for. */
  maxItems?: number
  /** The most bytes of one upstream answer this process reads. */
  maxResponseBytes?: number
}

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** Cordis plugin name. */
export const name = 'gmo-excel-tools'

/** Path the source lists its categories under. */
export const CATEGORIES_PATH = '/api/gateway/categories'

/** Path every result route of the source sits under. */
export const RESULTS_PATH = '/api/gateway/results'

/** How long one upstream call may take when a deployment names no bound. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
/** The most rows, groups, or results one request asks for when a deployment names no bound. */
const DEFAULT_MAX_ITEMS = 200
/** The most bytes of one answer read when a deployment names no bound. */
const DEFAULT_MAX_RESPONSE_BYTES = 700_000

/**
 * The shape of an id this provider will put in a path.
 *
 * The source mints a 32-character hexadecimal id and, for one step of a
 * multi-step result, joins a step key to it with `~`. That separator is
 * outside the governed reference alphabet, so this provider's own id spells
 * it `.`, and translates only here.
 */
const RESULT_ID = /^[0-9a-f]{32}(?:\.[a-z0-9-]{1,24})?$/u

/** The upstream stage separator and the one this provider's ids carry instead. */
const WIRE_STAGE_SEPARATOR = '~'
const REF_STAGE_SEPARATOR = '.'

/** The dashboards served by the insights route, as opposed to the balance routes. */
const INSIGHT_WIDGETS: ReadonlySet<string> = new Set(['kpi', 'timeline', 'ranking', 'flow', 'heatmap', 'structure', 'quality'])

/**
 * An excel-tools deployment, as a GMO source.
 *
 * Every bound is a validated config field rather than a constant, because the
 * right values vary with how much a deployment is willing to put in front of a
 * model.
 */
export default class ExcelToolsGmoSource extends GmoSource {
  static inject = ['credentials']

  static Config: z<Config> = z.object({
    sourceCode: z.string().required(),
    baseUrl: z.string().required(),
    credentialRef: z.string().required(),
    requestTimeoutMs: z.natural().min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
    maxItems: z.natural().min(1).default(DEFAULT_MAX_ITEMS),
    maxResponseBytes: z.natural().min(1).default(DEFAULT_MAX_RESPONSE_BYTES),
  })

  override readonly providerKind = 'exceltools'
  override readonly sourceCode: string

  private readonly origin: string
  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Load-time, because each of these makes every later operation fail in a
    // way that reads as an outage rather than as the configuration mistake it
    // is. The source-code rule is the audit token bound that shapes every
    // GmoCategoryRef this source will mint.
    if (!GMO_REF_SEGMENT.test(config.sourceCode) || config.sourceCode.length > GMO_SOURCE_CODE_MAX_LENGTH) {
      throw new Error(`gmo-excel-tools: sourceCode ${JSON.stringify(config.sourceCode)} must be 1-${String(GMO_SOURCE_CODE_MAX_LENGTH)} characters over letters, digits, and . _ @ -`)
    }
    if (!isCredentialRefName(config.credentialRef)) {
      throw new Error(`gmo-excel-tools: credentialRef ${JSON.stringify(config.credentialRef)} is not a credential reference`)
    }
    let parsed: URL
    try {
      parsed = new URL(config.baseUrl)
    } catch {
      // URL is the only throw here, and its message names the input; a config
      // error should name the field instead.
      throw new Error(`gmo-excel-tools: baseUrl ${JSON.stringify(config.baseUrl)} is not a URL`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`gmo-excel-tools: baseUrl ${JSON.stringify(config.baseUrl)} must be http or https`)
    }
    this.origin = parsed.origin
    this.sourceCode = config.sourceCode
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
  }

  async listCategories(signal?: AbortSignal): Promise<readonly UpstreamCategory[]> {
    const body = await this.request('GET', CATEGORIES_PATH, undefined, signal, 'upstream-invalid')
    return array(body['categories']).map((entry) => {
      const row = record(entry)
      return {
        upstreamId: referenceSegment(row['key'], GMO_REF_MAX_LENGTH, 'a category key'),
        name: text(row['label']),
        resultCount: count(row['result_count']),
      }
    })
  }

  async listResults(request: UpstreamResultsRequest): Promise<UpstreamResultListing> {
    const pageSize = Math.min(request.pageSize, this.resolved.maxItems)
    const offset = (request.page - 1) * pageSize
    const body = await this.request(
      'GET',
      `${CATEGORIES_PATH}/${encodeURIComponent(request.upstreamId)}/results?limit=${String(pageSize)}&offset=${String(offset)}`,
      undefined,
      request.signal,
      'upstream-invalid',
    )
    return {
      results: array(body['results']).map(entry => toResult(entry)),
      pageSize,
      total: count(body['total']) ?? 0,
    }
  }

  async placeResult(upstreamResultId: string, signal?: AbortSignal): Promise<UpstreamPlacement> {
    const body = await this.request('GET', `${resultPath(upstreamResultId)}/placement`, undefined, signal, 'result-unavailable')
    return { upstreamId: categoryOf(body) }
  }

  async describeResult(upstreamResultId: string, signal?: AbortSignal): Promise<UpstreamDescription> {
    const body = await this.request('GET', resultPath(upstreamResultId), undefined, signal, 'result-unavailable')
    const tool = record(body['tool'])
    const dashboard = body['dashboard'] === undefined ? undefined : toDashboard(record(body['dashboard']))
    return {
      upstreamId: categoryOf(body),
      upstreamResultId: refResultId(body['id']),
      categoryLabel: text(body['category_label']),
      name: text(body['name']),
      toolName: text(tool['name']),
      period: text(body['period']),
      rows: count(body['total_rows']) ?? 0,
      createdAt: text(body['created_at']),
      today: text(body['today']),
      weekStart: text(body['week_start']),
      stages: array(body['stages']).map(entry => toStage(entry)),
      fields: array(body['fields']).map(entry => toField(entry)),
      ...(dashboard === undefined ? {} : { dashboard }),
      sources: array(body['sources']).map((entry) => {
        const row = record(entry)
        return { name: text(row['name']), slot: text(row['slot']), rows: count(row['rows']) }
      }),
      glossary: text(body['glossary']),
    }
  }

  async ask(request: UpstreamAskRequest): Promise<UpstreamAnswer> {
    const base = resultPath(request.upstreamResultId)
    const { query } = request
    let answered: Record<string, unknown>
    switch (query.kind) {
      case 'aggregate':
        answered = await this.request('POST', `${base}/aggregate`, this.aggregateBody(query), request.signal, 'result-unavailable')
        break
      case 'rows':
        answered = await this.request('POST', `${base}/query`, this.rowsBody(query), request.signal, 'result-unavailable')
        break
      case 'overview':
        answered = await this.overview(base, query, request.signal)
        break
    }
    const { category, ...data } = answered
    if (typeof category !== 'string') throw new GmoError('upstream-invalid', 'an answer does not name its category')
    return { upstreamId: category, data: data as { readonly [key: string]: GmoJson } }
  }

  /** One of the ready-made dashboards: the insights route, or one of the balance routes. */
  private overview(
    base: string,
    query: Extract<GmoQuery, { kind: 'overview' }>,
    signal: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> {
    if (INSIGHT_WIDGETS.has(query.widget)) {
      return this.request('POST', `${base}/insights/${query.widget}`, this.insightBody(query), signal, 'result-unavailable')
    }
    switch (query.widget) {
      case 'balance':
        return this.request('GET', `${base}/balance?q=${encodeURIComponent(query.search ?? '')}`, undefined, signal, 'result-unavailable')
      case 'balance_analysis':
        return this.request('GET', `${base}/balance/analysis?dim=${encodeURIComponent(query.dim ?? 'brand_l1')}`, undefined, signal, 'result-unavailable')
      case 'balance_material':
        if (query.material === undefined || query.material === '') {
          return Promise.reject(new GmoError('invalid-query', 'a material view names the material'))
        }
        return this.request('GET', `${base}/balance/material?material=${encodeURIComponent(query.material)}`, undefined, signal, 'result-unavailable')
      default:
        // An insights widget is handled above; anything else is a widget this
        // build does not know, which the type system keeps out but a wire value could carry.
        return Promise.reject(new GmoError('invalid-query', 'no such dashboard'))
    }
  }

  private aggregateBody(query: Extract<GmoQuery, { kind: 'aggregate' }>): Record<string, unknown> {
    return {
      metric: query.metric,
      ...(query.field === undefined ? {} : { field: query.field }),
      ...(query.groupBy === undefined ? {} : { group_by: query.groupBy }),
      ...(query.dateGrain === undefined ? {} : { date_grain: query.dateGrain }),
      ...(query.orderBy === undefined ? {} : { order_by: query.orderBy }),
      limit: Math.min(query.limit ?? this.resolved.maxItems, this.resolved.maxItems),
      filters: filtersBody(query.filters),
    }
  }

  private insightBody(query: Extract<GmoQuery, { kind: 'overview' }>): Record<string, unknown> {
    return {
      filters: filtersBody(query.filters),
      ...(query.dateField === undefined ? {} : { date_field: query.dateField }),
      ...(query.stack === undefined ? {} : { stack: query.stack }),
      ...(query.sub === undefined ? {} : { sub: query.sub }),
      ...(query.grain === undefined ? {} : { grain: query.grain }),
      ...(query.metric === undefined ? {} : { metric: query.metric }),
      ...(query.dim === undefined ? {} : { dim: query.dim }),
      ...(query.top === undefined ? {} : { top: Math.min(query.top, this.resolved.maxItems) }),
    }
  }

  private rowsBody(query: Extract<GmoQuery, { kind: 'rows' }>): Record<string, unknown> {
    return {
      filters: filtersBody(query.filters),
      ...(query.sort === undefined ? {} : { sort: query.sort }),
      page: query.page ?? 1,
      page_size: Math.min(query.pageSize ?? this.resolved.maxItems, this.resolved.maxItems),
    }
  }

  /** The current gateway token, or the reason there is none. */
  private async credential(): Promise<string> {
    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.credentialRef))
    if (credential === undefined) {
      throw new GmoError('upstream-unavailable', 'no GMO credential is configured')
    }
    return credential.value
  }

  /**
   * One upstream request, decoded as a JSON object. Everything every route
   * shares, the credential, the deadline, the size bound, and the failure
   * mapping, happens here once.
   *
   * The credential is resolved per operation rather than held, so a rotation
   * takes effect on the next call. It is attached here and nowhere else.
   * @param missing - what a `404` means for this route.
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | undefined,
    signal: AbortSignal | undefined,
    missing: GmoFailureReason,
  ): Promise<Record<string, unknown>> {
    // Read afresh each time rather than narrowed once: the caller can abort
    // while the request is in flight, which is the second read below.
    const cancelled = (): boolean => signal?.aborted === true
    // A caller that already stopped waiting gets its answer before a
    // credential is resolved or a request leaves on behalf of nobody.
    if (cancelled()) throw new GmoError('cancelled', 'the caller aborted the operation')
    const credential = await this.credential()
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, this.resolved.requestTimeoutMs)
    // `AbortSignal.any` rather than a listener on the caller's signal, so an
    // abort that lands between the check above and the call still stops it.
    const deadline = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
    let response: Response
    let raw: string
    try {
      response = await fetch(new URL(path, this.origin), {
        method,
        headers: {
          authorization: `Bearer ${credential}`,
          'X-Request-ID': randomUUID(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: deadline,
      })
      raw = await response.text()
    } catch {
      // fetch rejects for a refused connection, DNS failure, TLS failure, the
      // deadline above, and the caller's own abort alike. The caller's abort
      // is the one of those that is not the source's doing. The rejection's
      // own text can name an internal address, so it stays here.
      if (cancelled()) throw new GmoError('cancelled', 'the caller aborted the operation')
      throw new GmoError('upstream-unavailable', `${this.providerKind} did not answer`)
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) throw new GmoError(reasonOf(response.status, missing), `${this.providerKind} refused the operation`)
    if (Buffer.byteLength(raw) > this.resolved.maxResponseBytes) {
      throw new GmoError('too-large', `${this.providerKind} answered more than this deployment reads`)
    }
    let decoded: unknown
    try {
      decoded = JSON.parse(raw)
    } catch {
      // A non-JSON body is a proxy error page or a truncated response; either
      // way this build cannot read it, and its text is not ours to forward.
      throw new GmoError('upstream-invalid', `${this.providerKind} answered a body this build cannot read`)
    }
    return record(decoded)
  }
}

/**
 * Map an upstream refusal onto a closed reason.
 *
 * The distinctions a member can act on are whether the question was wrong,
 * whether the result lacks that view, whether the answer was too big, and
 * whether the source is answering at all. A misconfigured token, a revoked
 * token, and a disabled gateway are all "this source is not answering us right
 * now" to the member waiting on it, and the operator diagnoses which in the
 * excel-tools deployment's own page.
 */
function reasonOf(status: number, missing: GmoFailureReason): GmoFailureReason {
  switch (status) {
    case 400:
    case 422:
      return 'invalid-query'
    case 404:
      return missing
    case 409:
      return 'unsupported'
    case 413:
      return 'too-large'
    case 401:
    case 403:
    case 429:
      return 'upstream-unavailable'
    default:
      return status >= 500 ? 'upstream-unavailable' : 'upstream-invalid'
  }
}

/** The path of one result's routes, refusing an id that is not one this provider mints. */
function resultPath(upstreamResultId: string): string {
  if (!RESULT_ID.test(upstreamResultId)) throw new GmoError('result-unavailable', 'not a result id')
  return `${RESULTS_PATH}/${encodeURIComponent(upstreamResultId.replace(REF_STAGE_SEPARATOR, WIRE_STAGE_SEPARATOR))}`
}

/** One answer's category, which every result route names. */
function categoryOf(body: Record<string, unknown>): string {
  return referenceSegment(body['category'], GMO_REF_MAX_LENGTH, 'a category key')
}

/** Read an upstream result id as this provider's own, within the reference grammar. */
function refResultId(value: unknown): string {
  const id = typeof value === 'string' ? value.replace(WIRE_STAGE_SEPARATOR, REF_STAGE_SEPARATOR) : undefined
  if (id === undefined || !RESULT_ID.test(id) || id.length > GMO_RESULT_ID_MAX_LENGTH) {
    throw new GmoError('upstream-invalid', 'a result id is not one this build can govern')
  }
  return id
}

/** One string proved to sit in the reference alphabet and under its bound. */
function referenceSegment(value: unknown, maxLength: number, what: string): string {
  if (typeof value !== 'string' || !GMO_REF_SEGMENT.test(value) || value.length > maxLength) {
    throw new GmoError('upstream-invalid', `${what} is not one this build can govern`)
  }
  return value
}

/** A decoded value that must be a JSON object. */
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GmoError('upstream-invalid', 'expected an object')
  }
  return value as Record<string, unknown>
}

/** A decoded value that must be a JSON array, or absent for an empty one. */
function array(value: unknown): readonly unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new GmoError('upstream-invalid', 'expected a list')
  return value as readonly unknown[]
}

/** A decoded string, empty when the upstream sent none. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A decoded whole number, or undefined when the upstream sent none. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function toStage(entry: unknown): UpstreamStage {
  const row = record(entry)
  return { key: text(row['key']), label: text(row['label']), upstreamResultId: refResultId(row['id']) }
}

function toResult(entry: unknown): UpstreamResult {
  const row = record(entry)
  return {
    upstreamResultId: refResultId(row['id']),
    name: text(row['name']),
    toolName: text(row['tool_name']),
    period: text(row['period']),
    rows: count(row['total_rows']) ?? 0,
    createdAt: text(row['created_at']),
    stages: array(row['stages']).map(stage => toStage(stage)),
  }
}

function toField(entry: unknown): GmoField {
  const row = record(entry)
  return {
    key: text(row['key']),
    label: text(row['label']),
    type: text(row['type']),
    filter: text(row['filter']),
    description: text(row['description']),
  }
}

function toDashboard(row: Record<string, unknown>): GmoDashboard {
  const strings = (value: unknown): readonly string[] => array(value).map(item => text(item))
  const dims = record(row['dims'])
  return {
    measure: text(row['measure']),
    measureLabel: text(row['measure_label']),
    dateFields: array(row['date_fields']).map((entry) => {
      const field = record(entry)
      return { key: text(field['key']), label: text(field['label']) }
    }),
    dims: Object.fromEntries(Object.entries(dims).map(([key, label]) => [key, text(label)])),
    stackDims: strings(row['stack_dims']),
    rankDims: strings(row['rank_dims']),
    heatDims: strings(row['heat_dims']),
    flow: strings(row['flow']),
    subDim: text(row['sub_dim']),
    balance: row['balance'] === true,
    structure: row['structure'] === true,
  }
}

/** The filters as the source names them; an absent filter set is an empty one. */
function filtersBody(filters: GmoFilters | undefined): Record<string, unknown> {
  return filters === undefined ? {} : { ...filters }
}
