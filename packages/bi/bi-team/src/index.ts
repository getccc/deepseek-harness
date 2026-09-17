/**
 * BI analysis, as a Team Runner reaches it: an outbound request to the
 * company Control Plane carrying the current device token and nothing else.
 *
 * What this sends is a governed reference, a keyword, or a row bound, and
 * nothing more. What it does not send, and could not, because the protocol
 * has no place for it, is a BI address, a credential, an upstream id, a
 * filter, a parameter, or a query of its own. The decision about who may run
 * what is made on the other side, on every call.
 * @module @deepseek-ai/dsh-bi-team
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  Bi,
  BiChartRef,
  BiError,
  BiProjectRef,
  isBiChartRef,
  isBiProjectRef,
  type BiCell,
  type BiChartKind,
  type BiChartPage,
  type BiChartSummary,
  type BiChartsRequest,
  type BiFailureReason,
  type BiField,
  type BiProjectEntry,
  type BiQueryRequest,
  type BiQueryResult,
} from '@deepseek-ai/dsh-bi'
import {
  ACCESS_TOKEN_HEADER,
  BI_CATALOG_PATH,
  BI_CHARTS_PATH,
  BI_PROTOCOL_VERSION,
  BI_QUERY_PATH,
} from '@deepseek-ai/dsh-bi-gateway-http'
import {
  controlPlaneConfigFields,
  controlPlaneFetch,
  type ControlPlaneFetch,
  type Response,
} from '@deepseek-ai/dsh-team-account-client'

/** Every reason the Control Plane may answer with, for decoding one back. */
const KNOWN_REASONS: readonly string[] = [
  'unauthenticated', 'not-allowed', 'scope-unavailable', 'chart-unavailable', 'query-failed',
  'upstream-unavailable', 'upstream-invalid', 'control-plane-unreachable', 'update-required', 'cancelled',
]

/** Every chart kind the Control Plane may answer with, for decoding one back. */
const KNOWN_KINDS: readonly string[] = [
  'line', 'horizontal_bar', 'vertical_bar', 'scatter', 'bubble', 'waterfall', 'area', 'mixed', 'pie', 'table',
  'big_number', 'funnel', 'map', 'sankey', 'radar', 'gauge', 'gantt', 'safety_cross', 'custom', 'other',
]

/** Plugin config: which Control Plane this Runner belongs to. */
export interface Config {
  /**
   * Origin of the company Control Plane, such as `https://dsh.company.com`.
   *
   * Carried per row rather than read from the account client, matching the
   * company model transport. The desktop installer's generated profile patch
   * writes every row from one deployment fact, which is where a single source
   * of truth belongs.
   */
  controlPlaneUrl: string
  /**
   * Path to a PEM file whose certificates are the only ones this Runner
   * accepts for the Control Plane, carried per row for the same reason
   * `controlPlaneUrl` is.
   */
  controlPlaneCa?: string
}

/** Cordis plugin name. */
export const name = 'bi-team'

/**
 * The Team BI provider.
 *
 * The access token is read per call rather than held, because the account
 * client refreshes it and a cached one would be the stale copy, the same
 * reason no BI credential comes here at all.
 */
export default class TeamBi extends Bi {
  static inject = ['teamAccountClient']

  static Config: z<Config> = z.object({ ...controlPlaneConfigFields })

  /** The fetch every Control Plane call goes through, carrying this deployment's trust. */
  private readonly fetch: ControlPlaneFetch

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.fetch = controlPlaneFetch(ctx, config.controlPlaneCa)
  }

  async catalog(signal?: AbortSignal): Promise<readonly BiProjectEntry[]> {
    const body = await this.call(BI_CATALOG_PATH, {}, signal)
    const entries = body['entries']
    if (!Array.isArray(entries)) throw new BiError('upstream-invalid', 'directory is not a list')
    return entries.map(entry => readEntry(entry))
  }

  async charts(request: BiChartsRequest): Promise<BiChartPage> {
    const body = await this.call(BI_CHARTS_PATH, {
      ref: request.ref,
      ...(request.query === undefined ? {} : { query: request.query }),
      ...(request.page === undefined ? {} : { page: request.page }),
      ...(request.pageSize === undefined ? {} : { pageSize: request.pageSize }),
    }, request.signal)
    const charts = body['charts']
    const page = body['page']
    const pageSize = body['pageSize']
    if (!Array.isArray(charts) || typeof page !== 'number' || typeof pageSize !== 'number') {
      throw new BiError('upstream-invalid', 'chart page is missing its fields')
    }
    const total = body['total']
    return {
      ref: request.ref,
      charts: charts.map(chart => readChart(chart)),
      page,
      pageSize,
      // A total this build cannot read is reported as unknown rather than as
      // zero: a reader must not be told the list ends where it does not.
      total: typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : undefined,
    }
  }

  async query(request: BiQueryRequest): Promise<BiQueryResult> {
    const body = await this.call(BI_QUERY_PATH, {
      chartRef: request.chartRef,
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    }, request.signal)
    const ref = body['ref']
    const fields = body['fields']
    const rows = body['rows']
    if (typeof ref !== 'string' || !isBiProjectRef(ref) || !Array.isArray(fields) || !Array.isArray(rows)) {
      throw new BiError('upstream-invalid', 'run answer is missing its fields')
    }
    const columns = fields.map(field => readField(field))
    const rowCount = body['rowCount']
    return {
      chartRef: request.chartRef,
      ref: BiProjectRef(ref),
      name: text(body['name']),
      kind: kindOf(body['kind']),
      description: text(body['description']),
      fields: columns,
      filters: text(body['filters']),
      rows: rows.map(row => readRow(row, columns.length)),
      rowCount: typeof rowCount === 'number' && Number.isSafeInteger(rowCount) && rowCount >= 0 ? rowCount : undefined,
      truncated: body['truncated'] === true,
      cellsTruncated: body['cellsTruncated'] === true,
    }
  }

  /**
   * Perform one Control Plane call and return its decoded object.
   *
   * Every failure that is not an answer this build can read becomes
   * `control-plane-unreachable`: from a member's seat, a DNS failure, a TLS
   * failure, a proxy that ate the request, and a Control Plane that is down
   * are the same fact, and none of them is something they can act on
   * differently.
   */
  private async call(
    path: string,
    fields: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> {
    const token = await this.accessToken()
    let response: Response
    try {
      response = await this.fetch(new URL(path, this.config.controlPlaneUrl), {
        method: 'POST',
        headers: {
          [ACCESS_TOKEN_HEADER]: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ protocolVersion: BI_PROTOCOL_VERSION, ...fields }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      // Includes the caller's own abort, which reaches the tool as a
      // cancellation through its execution signal rather than through here.
      throw new BiError('control-plane-unreachable', 'the Control Plane did not answer')
    }
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch {
      // A reverse proxy error page rather than a Control Plane answer.
      throw new BiError('control-plane-unreachable', 'the answer was not a Control Plane answer')
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new BiError('control-plane-unreachable', 'the answer was not an object')
    }
    const body = decoded as Record<string, unknown>
    if (response.ok) return body
    throw new BiError(refusalOf(body), `the Control Plane answered HTTP ${String(response.status)}`)
  }

  /** The Runner's current access token, or the reason there is none. */
  private async accessToken(): Promise<string> {
    try {
      return await this.ctx.teamAccountClient.accessToken()
    } catch {
      // Not bound and refused are the same to a BI caller: neither is a BI
      // failure, and both are answered by signing this computer in.
      throw new BiError('unauthenticated', 'this computer is not signed in')
    }
  }
}

/**
 * Read the reason out of a refusal.
 *
 * An unknown word is treated as unreachable rather than passed through: a
 * Control Plane speaking reasons this build does not know is one this build
 * cannot act on, and inventing a meaning would tell a member to do something
 * that may not help.
 */
function refusalOf(body: Record<string, unknown>): BiFailureReason {
  const reason = body['reason']
  return typeof reason === 'string' && KNOWN_REASONS.includes(reason)
    ? reason as BiFailureReason
    : 'control-plane-unreachable'
}

/** Validate one directory entry at the wire. */
function readEntry(value: unknown): BiProjectEntry {
  const row = asRecord(value)
  const ref = row['ref']
  const displayName = row['displayName']
  if (typeof ref !== 'string' || !isBiProjectRef(ref) || typeof displayName !== 'string') {
    throw new BiError('upstream-invalid', 'a project is missing its reference or name')
  }
  return { ref: BiProjectRef(ref), displayName }
}

/** Validate one chart summary at the wire. */
function readChart(value: unknown): BiChartSummary {
  const row = asRecord(value)
  const chartRef = row['chartRef']
  const ref = row['ref']
  if (typeof chartRef !== 'string' || !isBiChartRef(chartRef) || typeof ref !== 'string' || !isBiProjectRef(ref)) {
    throw new BiError('upstream-invalid', 'a chart is missing its reference')
  }
  const updatedAt = row['updatedAt']
  return {
    chartRef: BiChartRef(chartRef),
    ref: BiProjectRef(ref),
    name: text(row['name']),
    spaceName: text(row['spaceName']),
    description: text(row['description']),
    kind: kindOf(row['kind']),
    updatedAt: typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : undefined,
  }
}

/** Validate one column at the wire. */
function readField(value: unknown): BiField {
  const row = asRecord(value)
  const id = row['id']
  if (typeof id !== 'string' || id === '') throw new BiError('upstream-invalid', 'a field is missing its id')
  return {
    id,
    label: text(row['label']) || id,
    role: row['role'] === 'dimension' ? 'dimension' : 'metric',
    type: text(row['type']),
  }
}

/**
 * Read one row at the wire: one cell per column, a cell this build cannot
 * read as empty, and a row shorter than the columns padded with empty cells.
 */
function readRow(value: unknown, width: number): readonly BiCell[] {
  if (!Array.isArray(value)) throw new BiError('upstream-invalid', 'a row is not a list')
  const cells = (value as unknown[]).slice(0, width).map((cell): BiCell =>
    typeof cell === 'string' || typeof cell === 'boolean' || (typeof cell === 'number' && Number.isFinite(cell)) ? cell : null)
  while (cells.length < width) cells.push(null)
  return cells
}

/**
 * A kind word this build knows, or `other`.
 *
 * A newer Control Plane's richer vocabulary reads as `other` rather than as
 * unreadable: the kind is a hint to the model, and a run is not lost over it.
 */
function kindOf(value: unknown): BiChartKind {
  return typeof value === 'string' && KNOWN_KINDS.includes(value) ? value as BiChartKind : 'other'
}

/** An optional wire string, absent when the answer supplies none. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Narrow one decoded array element to string-keyed fields. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new BiError('upstream-invalid', 'an entry is not an object')
  }
  return value as Record<string, unknown>
}
