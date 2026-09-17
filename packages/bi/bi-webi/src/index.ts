/**
 * The webi BI-source provider: the one place in a Control Plane that holds a
 * BI credential and speaks a BI product's protocol.
 *
 * It mounts in the Control Plane only. Nothing here knows who is asking; the
 * gateway in front of it has already decided that. The provider's whole job
 * is to call a fixed set of routes, run a saved chart as it was saved, bound
 * what comes back, and refuse anything it cannot read.
 * @module @deepseek-ai/dsh-bi-webi
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import {
  BI_CHART_ID_MAX_LENGTH,
  BI_REF_MAX_LENGTH,
  BI_REF_SEGMENT,
  BI_SOURCE_CODE_MAX_LENGTH,
  BiError,
  type BiCell,
  type BiChartKind,
  type BiFailureReason,
  type BiField,
} from '@deepseek-ai/dsh-bi'
import {
  BiSource,
  type UpstreamChart,
  type UpstreamChartListing,
  type UpstreamChartPlacement,
  type UpstreamChartsRequest,
  type UpstreamProject,
  type UpstreamRun,
  type UpstreamRunRequest,
} from '@deepseek-ai/dsh-bi-source'
import {
  API_KEY_SCHEME,
  AUTHORIZATION_HEADER,
  PROJECTS_PATH,
  chartQueryPath,
  contentPath,
  errorStatus,
  okResults,
  queryCancelPath,
  queryResultsPath,
  savedChartPath,
  type WireChartContent,
  type WireExecuteResults,
  type WireProject,
  type WireResultsPage,
  type WireSavedChart,
} from './wire.ts'

export {
  API_KEY_SCHEME,
  AUTHORIZATION_HEADER,
  PROJECTS_PATH,
  chartQueryPath,
  contentPath,
  queryCancelPath,
  queryResultsPath,
  savedChartPath,
} from './wire.ts'

/** Plugin config: which source, where it is, and what it may return. */
export interface Config {
  /** This deployment's code for the source, the second `BiProjectRef` segment. */
  sourceCode: string
  /** Origin the webi API is served from, such as `http://127.0.0.1:8100`. */
  baseUrl: string
  /**
   * Credential reference resolving to a webi personal access token.
   *
   * The token's reach is its owner's: a project grant covers every space in
   * the project, private ones included, so the token belongs to a webi
   * organization administrator created for this deployment rather than to a
   * person.
   */
  credentialRef: string
  /** How long one upstream HTTP call may take before it is abandoned. */
  requestTimeoutMs?: number
  /** The most rows one run may return. */
  maxRows?: number
  /** The most characters one text cell may carry. */
  maxCellChars?: number
  /** The most charts one project listing may read. */
  maxCharts?: number
  /** How long to wait between two reads of a run that is not ready yet. */
  pollIntervalMs?: number
  /** How long one run may take, from start to its first ready page, before it is abandoned. */
  queryTimeoutMs?: number
}

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** Cordis plugin name. */
export const name = 'bi-webi'

/** How long one upstream call may take when a deployment names no bound. */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
/** The most rows one run returns when a deployment names no bound. */
const DEFAULT_MAX_ROWS = 500
/** The most characters one text cell carries when a deployment names no bound. */
const DEFAULT_MAX_CELL_CHARS = 200
/** The most charts one listing reads when a deployment names no bound. */
const DEFAULT_MAX_CHARTS = 500
/** How long to wait between two reads of an unfinished run when a deployment names no interval. */
const DEFAULT_POLL_INTERVAL_MS = 500
/** How long one run may take when a deployment names no bound. */
const DEFAULT_QUERY_TIMEOUT_MS = 60_000

/** The words the content listing and the saved-chart record use for a picture, as this build reads them. */
const CHART_KINDS: ReadonlySet<BiChartKind> = new Set<BiChartKind>([
  'line', 'horizontal_bar', 'vertical_bar', 'scatter', 'bubble', 'waterfall', 'area', 'mixed',
  'pie', 'table', 'big_number', 'funnel', 'map', 'sankey', 'radar', 'gauge', 'gantt', 'safety_cross', 'custom',
])

/**
 * A webi deployment, as a BI source.
 *
 * Every bound is a validated config field rather than a constant, because the
 * right values vary with how many rows a deployment is willing to put in front
 * of a model.
 */
export default class WebiBiSource extends BiSource {
  static inject = ['credentials']

  static Config: z<Config> = z.object({
    sourceCode: z.string().required(),
    baseUrl: z.string().required(),
    credentialRef: z.string().required(),
    requestTimeoutMs: z.natural().min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
    maxRows: z.natural().min(1).default(DEFAULT_MAX_ROWS),
    maxCellChars: z.natural().min(1).default(DEFAULT_MAX_CELL_CHARS),
    maxCharts: z.natural().min(1).default(DEFAULT_MAX_CHARTS),
    pollIntervalMs: z.natural().min(1).default(DEFAULT_POLL_INTERVAL_MS),
    queryTimeoutMs: z.natural().min(1).default(DEFAULT_QUERY_TIMEOUT_MS),
  })

  override readonly providerKind = 'webi'
  override readonly sourceCode: string

  private readonly origin: string
  private readonly resolved: ResolvedConfig

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // Load-time, because each of these makes every later operation fail in a
    // way that reads as an outage rather than as the configuration mistake it
    // is. The source-code rule is the audit token bound that shapes every
    // BiProjectRef this source will mint.
    if (!BI_REF_SEGMENT.test(config.sourceCode) || config.sourceCode.length > BI_SOURCE_CODE_MAX_LENGTH) {
      throw new Error(`bi-webi: sourceCode ${JSON.stringify(config.sourceCode)} must be 1-${String(BI_SOURCE_CODE_MAX_LENGTH)} characters over letters, digits, and . _ @ -`)
    }
    if (!isCredentialRefName(config.credentialRef)) {
      throw new Error(`bi-webi: credentialRef ${JSON.stringify(config.credentialRef)} is not a credential reference`)
    }
    let parsed: URL
    try {
      parsed = new URL(config.baseUrl)
    } catch {
      // URL is the only throw here, and its message names the input; a config
      // error should name the field instead.
      throw new Error(`bi-webi: baseUrl ${JSON.stringify(config.baseUrl)} is not a URL`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`bi-webi: baseUrl ${JSON.stringify(config.baseUrl)} must be http or https`)
    }
    this.origin = parsed.origin
    this.sourceCode = config.sourceCode
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
  }

  async listProjects(signal?: AbortSignal): Promise<readonly UpstreamProject[]> {
    const results = await this.request(PROJECTS_PATH, undefined, signal, asArray)
    return results.map(entry => toProject(entry))
  }

  async listCharts(request: UpstreamChartsRequest): Promise<UpstreamChartListing> {
    const page = await this.request(contentPath(request.upstreamId, this.resolved.maxCharts), undefined, request.signal, asContentPage)
    return {
      charts: page.data.map(entry => toChartContent(entry)),
      truncated: page.total !== undefined && page.total > page.data.length,
    }
  }

  async describeChart(upstreamChartId: string, signal?: AbortSignal): Promise<UpstreamChartPlacement> {
    const record = await this.request(savedChartPath(upstreamChartId), undefined, signal, asRecord, 'chart-unavailable')
    const chart = record as unknown as WireSavedChart
    if (typeof chart.projectUuid !== 'string' || chart.projectUuid === '') {
      // Without the project there is nothing to authorize, which makes this
      // unreadable rather than a chart that happens to be missing one.
      throw new BiError('upstream-invalid', 'a chart record is missing its project')
    }
    return {
      upstreamId: chart.projectUuid,
      chart: {
        upstreamChartId: chartId(chart.uuid),
        name: text(chart.name),
        spaceName: text(chart.spaceName),
        description: text(chart.description),
        kind: chartKindOf(chart.chartConfig),
        updatedAt: timestamp(chart.updatedAt),
      },
    }
  }

  async runChart(request: UpstreamRunRequest): Promise<UpstreamRun> {
    const limit = Math.min(request.limit, this.resolved.maxRows)
    const startedAt = Date.now()
    // The run goes out as the chart was saved: the body names the chart and
    // nothing else, so no filter, parameter, sort, or row limit of this
    // process's own reaches the warehouse. The row bound applies to the page
    // this process reads, and the source reports how many rows it produced.
    const started = await this.request(
      chartQueryPath(request.upstreamId), { chartUuid: request.upstreamChartId }, request.signal, asExecuteResults, 'chart-unavailable',
    )
    const path = queryResultsPath(request.upstreamId, started.queryUuid, limit)
    for (;;) {
      const page = await this.request(path, undefined, request.signal, asResultsPage)
      switch (page.status) {
        case 'ready':
          return this.toRun(started, page, limit)
        case 'pending':
          break
        case 'cancelled':
          throw new BiError('query-failed', 'the source cancelled the run')
        default:
          throw new BiError('query-failed', 'the warehouse refused or failed the run')
      }
      if (Date.now() - startedAt >= this.resolved.queryTimeoutMs) {
        await this.cancel(request.upstreamId, started.queryUuid)
        throw new BiError('upstream-unavailable', 'the run did not finish in time')
      }
      try {
        await sleep(this.resolved.pollIntervalMs, request.signal)
      } catch {
        // The caller stopped waiting; the run is stopped upstream too, best
        // effort, so the warehouse does not keep working for nobody.
        await this.cancel(request.upstreamId, started.queryUuid)
        throw new BiError('cancelled', 'the caller aborted the run')
      }
    }
  }

  /** Cut one ready page down to what may leave this module. */
  private toRun(started: WireExecuteResults, page: WireResultsPage, limit: number): UpstreamRun {
    const entries = asRows(page.rows)
    const fields = fieldsOf(started, page, entries[0])
    const rows: BiCell[][] = []
    let cellsTruncated = false
    for (const entry of entries) {
      rows.push(fields.map((field) => {
        const cell = toCell(entry[field.id], this.resolved.maxCellChars)
        cellsTruncated ||= cell.truncated
        return cell.value
      }))
      if (rows.length === limit) break
    }
    const rowCount = count(page.totalResults)
    return {
      fields,
      filters: filtersOf(started.metricQuery),
      rows,
      rowCount,
      truncated: rowCount === undefined ? entries.length > rows.length : rowCount > rows.length,
      cellsTruncated,
    }
  }

  /** Stop one run, ignoring an answer nobody is waiting for. */
  private async cancel(projectUuid: string, queryUuid: string): Promise<void> {
    try {
      await this.request(queryCancelPath(projectUuid, queryUuid), {}, undefined, () => true)
    } catch {
      // Best effort: the caller already has its answer, and a cancellation
      // the source refused changes nothing about it.
    }
  }

  /** The current BI credential, or the reason there is none. */
  private async credential(): Promise<string> {
    const credential = await this.ctx.credentials.resolve(credentialRef(this.config.credentialRef))
    if (credential === undefined) {
      throw new BiError('upstream-unavailable', 'no BI credential is configured')
    }
    return credential.value
  }

  /**
   * One upstream request, decoded by the reader its route answers with.
   * Everything every route shares, the credential, the deadline, and the
   * failure mapping, happens here once.
   *
   * The credential is resolved per operation rather than held, so a rotation
   * takes effect on the next call. It is attached here and nowhere else.
   * @param missing - what a `404` means for this route, when it means something a caller can act on.
   */
  private async request<T>(
    path: string,
    body: Record<string, unknown> | undefined,
    signal: AbortSignal | undefined,
    read: (results: unknown) => T | undefined,
    missing: BiFailureReason = 'upstream-invalid',
  ): Promise<T> {
    // Read afresh each time rather than narrowed once: the caller can abort
    // while the request is in flight, which is the second read below.
    const cancelled = (): boolean => signal?.aborted === true
    // A caller that already stopped waiting gets its answer before a
    // credential is resolved or a request leaves on behalf of nobody.
    if (cancelled()) throw new BiError('cancelled', 'the caller aborted the operation')
    const credential = await this.credential()
    const controller = new AbortController()
    const timeout = setTimeout(() => { controller.abort() }, this.resolved.requestTimeoutMs)
    // `AbortSignal.any` rather than a listener on the caller's signal, so an
    // abort that lands between the check above and the call still stops it.
    const deadline = signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal])
    let response: Response
    try {
      response = await fetch(new URL(path, this.origin), {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          [AUTHORIZATION_HEADER]: `${API_KEY_SCHEME} ${credential}`,
          'X-Request-ID': randomUUID(),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: deadline,
      })
    } catch {
      // fetch rejects for a refused connection, DNS failure, TLS failure, the
      // deadline above, and the caller's own abort alike. The caller's abort
      // is the one of those that is not the source's doing. The rejection's
      // own text can name an internal address, so it stays here.
      if (cancelled()) throw new BiError('cancelled', 'the caller aborted the operation')
      throw new BiError('upstream-unavailable', `${this.providerKind} did not answer`)
    } finally {
      clearTimeout(timeout)
    }
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch {
      // A non-JSON body is a proxy error page or a truncated response; either
      // way this build cannot read it, and its text is not ours to forward.
      throw new BiError('upstream-invalid', `${this.providerKind} answered a body this build cannot read`)
    }
    const results = okResults(decoded)
    const value = results === undefined ? undefined : read(results)
    if (value !== undefined) return value
    throw new BiError(reasonOf(errorStatus(decoded) ?? response.status, missing), `${this.providerKind} refused the operation`)
  }
}

/**
 * Map an upstream refusal onto a closed reason.
 *
 * Availability and readability are the distinctions a member can act on: a
 * misconfigured key, a revoked key, and a rate limit are all "this source is
 * not answering us right now" to the member waiting on it, and the operator
 * diagnoses which in the webi deployment's own logs. A `404` means what the
 * route makes it mean: a missing chart on a chart route, and an unreadable
 * answer anywhere else.
 */
function reasonOf(status: number, missing: BiFailureReason): BiFailureReason {
  if (status === 404) return missing
  if (status === 401 || status === 403 || status === 429 || status >= 500) return 'upstream-unavailable'
  return 'upstream-invalid'
}

/** Wait, unless the caller stops waiting first. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort(): void {
      clearTimeout(timer)
      reject(new Error('aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** Validate one project row, refusing one this build could not govern. */
function toProject(entry: unknown): UpstreamProject {
  const row = asRecord(entry) as unknown as WireProject | undefined
  const id = row?.projectUuid
  const projectName = row?.name
  if (row === undefined || typeof id !== 'string' || typeof projectName !== 'string') {
    throw new BiError('upstream-invalid', 'a project is missing its id or name')
  }
  // The governed reference grammar, checked here so the catalog can mint a
  // reference from this id without a second guard.
  if (!BI_REF_SEGMENT.test(id) || id.length > BI_REF_MAX_LENGTH) {
    throw new BiError('upstream-invalid', 'a project id is not one this build can govern')
  }
  // The deployment answers the warehouse inside `warehouseConnection`, beside
  // its host and user, which this provider does not read; `warehouseType` is
  // where the same word sits on the organization's project summary.
  const warehouse = asRecord(row.warehouseConnection)?.['type'] ?? row.warehouseType
  return {
    upstreamId: id,
    name: projectName,
    description: text(row.description),
    projectType: text(row.type),
    warehouseType: text(warehouse),
  }
}

/** Validate one listing entry, refusing a chart this build could not address. */
function toChartContent(entry: unknown): UpstreamChart {
  const row = asRecord(entry) as unknown as WireChartContent | undefined
  if (row === undefined || typeof row.name !== 'string') {
    throw new BiError('upstream-invalid', 'a chart is missing its name')
  }
  const space = asRecord(row.space)
  return {
    upstreamChartId: chartId(row.uuid),
    name: row.name,
    spaceName: text(space?.['name']),
    description: text(row.description),
    kind: kindWord(row.chartKind),
    updatedAt: timestamp(row.lastUpdatedAt) ?? timestamp(row.createdAt),
  }
}

/**
 * One chart id the governed reference can carry.
 *
 * A source that answered an id outside the grammar is a source this build
 * cannot address, and a chart it cannot address is one no later operation
 * could name.
 */
function chartId(value: unknown): string {
  if (typeof value !== 'string' || !BI_REF_SEGMENT.test(value) || value.length > BI_CHART_ID_MAX_LENGTH) {
    throw new BiError('upstream-invalid', 'a chart id is not one this build can address')
  }
  return value
}

/** The listing's own kind word, read as one this build knows or as `other`. */
function kindWord(value: unknown): BiChartKind {
  // The source spells one of its kinds `watefall`; a reader of this build's
  // vocabulary should not have to.
  const word = value === 'watefall' ? 'waterfall' : value
  return typeof word === 'string' && CHART_KINDS.has(word as BiChartKind) ? word as BiChartKind : 'other'
}

/**
 * The kind of picture a saved chart's configuration draws.
 *
 * The record carries the family in `chartConfig.type`; a cartesian family is
 * told apart by its series. Several series of different types are `mixed`, a
 * bar is horizontal when the layout flips its axes and a waterfall when the
 * layout says so, a line with an area style is an area, and a scatter with a
 * bubble layout is a bubble. A family or series this build does not know
 * reads as `other`, which promises nothing about the picture.
 * @param chartConfig - the record's `chartConfig`, as decoded.
 * @returns the kind the listing would report for the same chart.
 */
export function chartKindOf(chartConfig: unknown): BiChartKind {
  const config = asRecord(chartConfig)
  const family = config?.['type']
  if (family !== 'cartesian') return kindWord(family)
  const inner = asRecord(config?.['config'])
  const echarts = asRecord(inner?.['eChartsConfig'])
  const layout = asRecord(inner?.['layout'])
  const series = Array.isArray(echarts?.['series']) ? echarts['series'] as unknown[] : []
  const shapes = new Set(series.map((entry) => {
    const item = asRecord(entry)
    return `${text(item?.['type'])}:${item?.['type'] === 'line' && item['areaStyle'] !== undefined ? 'area' : ''}`
  }))
  if (shapes.size > 1) return 'mixed'
  const [first] = series
  const item = asRecord(first)
  switch (item?.['type']) {
    case 'area':
      return 'area'
    case 'bar':
      if (layout?.['flipAxes'] === true) return 'horizontal_bar'
      return layout?.['isWaterfall'] === true ? 'waterfall' : 'vertical_bar'
    case 'line':
      return item['areaStyle'] === undefined ? 'line' : 'area'
    case 'scatter':
      return layout?.['isBubble'] === true ? 'bubble' : 'scatter'
    default:
      return 'other'
  }
}

/**
 * The columns a run answers, in the order the saved query names them:
 * dimensions, then metrics, then table calculations, then whatever else the
 * source's field map holds. A run whose query and field map both say nothing
 * takes the first row's own keys, so a page is never read as having no
 * columns while it plainly has cells.
 */
function fieldsOf(started: WireExecuteResults, page: WireResultsPage, firstRow: Record<string, unknown> | undefined): BiField[] {
  const items = asRecord(page.fields) ?? asRecord(started.fields) ?? {}
  const query = asRecord(started.metricQuery)
  const ordered: string[] = []
  const push = (value: unknown): void => {
    if (typeof value === 'string' && value !== '' && !ordered.includes(value)) ordered.push(value)
  }
  for (const key of ['dimensions', 'metrics'] as const) {
    for (const id of Array.isArray(query?.[key]) ? query[key] as unknown[] : []) push(id)
  }
  for (const calculation of Array.isArray(query?.['tableCalculations']) ? query['tableCalculations'] as unknown[] : []) {
    push(asRecord(calculation)?.['name'])
  }
  for (const id of Object.keys(items)) push(id)
  if (ordered.length === 0) for (const id of Object.keys(firstRow ?? {})) push(id)
  return ordered.map((id): BiField => {
    const item = asRecord(items[id])
    return {
      id,
      label: text(item?.['label']) || text(item?.['displayName']) || id,
      role: item?.['fieldType'] === 'dimension' ? 'dimension' : 'metric',
      type: text(item?.['type']),
    }
  })
}

/**
 * The rows a page carries, each as the source keyed it.
 *
 * A row is `{ [fieldId]: { value: { raw, formatted } } }`; a column the row
 * does not carry becomes a `null` cell rather than a refusal, because a table
 * calculation the source did not evaluate is still a column the chart has.
 */
function asRows(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new BiError('upstream-invalid', 'a ready page carries no rows')
  return (value as unknown[]).map((entry) => {
    const row = asRecord(entry)
    if (row === undefined) throw new BiError('upstream-invalid', 'a row is not an object')
    return row
  })
}

/** One cell's raw value, bounded when it is text. */
function toCell(value: unknown, maxCellChars: number): { value: BiCell; truncated: boolean } {
  const inner = asRecord(asRecord(value)?.['value'])
  const raw = inner?.['raw']
  if (inner === undefined || raw === undefined || raw === null) return { value: null, truncated: false }
  // A number decoded from JSON is always finite: the source writes an infinite
  // or missing number as `null`, which the line above already read.
  if (typeof raw === 'number' || typeof raw === 'boolean') return { value: raw, truncated: false }
  // A structured value webi did not format is rendered as its JSON, which is
  // the one text every reader can take apart again.
  const rendered = typeof raw === 'string' ? raw : text(inner['formatted']) || JSON.stringify(raw)
  const truncated = rendered.length > maxCellChars
  return { value: truncated ? rendered.slice(0, maxCellChars) : rendered, truncated }
}

/**
 * The saved filters as one line a reader can follow.
 *
 * Rules read `field operator values`; a group joins its rules with the word
 * that names it, and a nested group is parenthesized. A rule the author
 * switched off is left out, because the warehouse leaves it out too.
 */
function filtersOf(metricQuery: unknown): string {
  const filters = asRecord(asRecord(metricQuery)?.['filters'])
  if (filters === undefined) return ''
  return ['dimensions', 'metrics', 'tableCalculations']
    .map(key => renderGroup(filters[key]))
    .filter(part => part !== '')
    .join(' and ')
}

/** Render one filter group, or one rule, as text. */
function renderGroup(value: unknown): string {
  const group = asRecord(value)
  if (group === undefined) return ''
  const items = Array.isArray(group['and']) ? { word: 'and', items: group['and'] as unknown[] }
    : Array.isArray(group['or']) ? { word: 'or', items: group['or'] as unknown[] } : undefined
  if (items === undefined) return renderRule(group)
  const parts = items.items.map(item => renderGroup(item)).filter(part => part !== '')
  if (parts.length <= 1) return parts[0] ?? ''
  return `(${parts.join(` ${items.word} `)})`
}

/** Render one filter rule as text, or nothing for a disabled or unreadable one. */
function renderRule(rule: Record<string, unknown>): string {
  if (rule['disabled'] === true) return ''
  const target = asRecord(rule['target'])
  const field = text(target?.['fieldId']) || text(target?.['fieldRef'])
  const operator = text(rule['operator'])
  if (field === '' || operator === '') return ''
  const values = Array.isArray(rule['values'])
    ? (rule['values'] as unknown[]).map(entry => typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean' ? String(entry) : '')
      .filter(entry => entry !== '')
    : []
  return values.length === 0 ? `${field} ${operator}` : `${field} ${operator} ${values.join(', ')}`
}

/** The listing envelope: a `data` array with a pagination block beside it. */
function asContentPage(results: unknown): { data: readonly unknown[]; total: number | undefined } | undefined {
  const record = asRecord(results)
  const data = record?.['data']
  if (record === undefined || !Array.isArray(data)) return undefined
  return { data, total: count(asRecord(record['pagination'])?.['totalResults']) }
}

/** What starting a run answers, with the id every later read needs. */
function asExecuteResults(results: unknown): WireExecuteResults | undefined {
  const record = asRecord(results)
  const queryUuid = record?.['queryUuid']
  if (typeof queryUuid !== 'string' || queryUuid === '') return undefined
  return record as unknown as WireExecuteResults
}

/** One results page, whatever state it reports. */
function asResultsPage(results: unknown): WireResultsPage | undefined {
  const record = asRecord(results)
  return typeof record?.['status'] === 'string' ? record as unknown as WireResultsPage : undefined
}

/** A results value that is an array. */
function asArray(results: unknown): readonly unknown[] | undefined {
  return Array.isArray(results) ? results : undefined
}

/** Narrow one decoded value to string-keyed fields, or nothing. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** An optional upstream string, absent when the source supplies none. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** An optional upstream count, absent when the source supplies none or something else. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** An optional upstream timestamp, in epoch milliseconds. */
function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/** The row shapes this provider reads, for a fixture author. */
export type { WireChartContent, WireExecuteResults, WireProject, WireResultsPage, WireSavedChart }
