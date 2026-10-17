/**
 * The SQLite-backed governed BI gateway: the durable project catalog, the
 * reconciliation that keeps it honest, and the authorization decision in
 * front of every member-facing operation.
 *
 * Two databases are involved and they cannot commit together. Access control
 * stays authoritative for roles, grants, and resources; this catalog records
 * what a project is. Reconciliation is therefore idempotent and repeated: a
 * write that failed after the first of the pair is discovered and repaired by
 * the next synchronization rather than left as a permanent disagreement.
 *
 * The catalog mechanics belong to `dsh-governed-catalog-sqlite`, shared with
 * the knowledge and GMO gateways. This module supplies the project tables'
 * description and the two member operations.
 * @module @deepseek-ai/dsh-bi-gateway-sqlite
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ManagedResource } from '@deepseek-ai/dsh-access-control'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import {
  BiError,
  BiProjectRef,
  formatBiChartRef,
  formatBiProjectRef,
  parseBiChartRef,
  type BiChartPage,
  type BiChartSummary,
  type BiProjectEntry,
  type BiQueryResult,
} from '@deepseek-ai/dsh-bi'
import {
  BI_CATALOG_RESOURCE,
  BI_QUERY_ACTION,
  BI_RESOURCE_TYPE,
  BiGateway,
  type BiCatalogEntry,
  type BiCatalogView,
  type BiPrincipal,
  type GovernedChartsRequest,
  type GovernedQueryRequest,
} from '@deepseek-ai/dsh-bi-gateway'
import type { UpstreamChart, UpstreamProject } from '@deepseek-ai/dsh-bi-source'
import type {} from '@deepseek-ai/dsh-audit'
import { GovernedCatalog } from '@deepseek-ai/dsh-governed-catalog-sqlite'
import { applySchema, type ProjectRow } from './schema.ts'

export {
  BI_GATEWAY_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
} from './schema.ts'

/** Plugin config: where the catalog lives, and what one operation may return. */
export interface Config {
  /** Path to the catalog database. */
  path: string
  /**
   * SQLite journal mode. `wal` lets readers run beside the one writer and
   * commits with a single sync of the log; a rollback journal (`delete`,
   * `truncate`, `persist`) serves filesystems where WAL's shared-memory file
   * does not work, such as network mounts.
   */
  journalMode?: 'wal' | 'delete' | 'truncate' | 'persist'
  /**
   * How long a statement waits for another connection's lock before failing
   * with `SQLITE_BUSY`, in milliseconds. The driver is synchronous, so the
   * wait blocks every request this process serves.
   */
  busyTimeoutMs?: number
  /** How many charts one listing page holds when a caller names no size. */
  defaultChartPageSize?: number
  /** The most rows one run returns when a caller names no bound. */
  defaultMaxRows?: number
}

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** How many charts one listing page holds when a caller names no size. */
const DEFAULT_CHART_PAGE_SIZE = 20

/** The most rows one run returns when a caller names no bound. */
const DEFAULT_MAX_ROWS = 200

/** The audited operations this gateway performs for a member. */
type MemberAction = 'bi.charts' | 'bi.query'

/** Cordis plugin name. */
export const name = 'bi-gateway-sqlite'

/**
 * The governed catalog over SQLite.
 *
 * Every member-facing operation resolves its project against this catalog and
 * evaluates access before the source is called. Nothing here caches a
 * decision: a role change, a disabled entry, a suspended member, and a
 * revoked device all take effect on the next call.
 */
export default class SqliteBiGateway extends BiGateway {
  static inject = ['accessControl', 'audit', 'biSource']

  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.natural().default(1_000),
    defaultChartPageSize: z.natural().min(1).default(DEFAULT_CHART_PAGE_SIZE),
    defaultMaxRows: z.natural().min(1).default(DEFAULT_MAX_ROWS),
  })

  private readonly resolved: ResolvedConfig
  private readonly catalog: GovernedCatalog<'project_ref', ProjectRow, BiCatalogEntry, UpstreamProject>

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
    this.catalog = new GovernedCatalog(ctx, this.resolved, {
      name,
      table: 'bi_project',
      sourceTable: 'bi_source',
      refColumn: 'project_ref',
      resourceType: BI_RESOURCE_TYPE,
      catalogResource: BI_CATALOG_RESOURCE,
      syncAction: 'bi.catalog.sync',
      failureKey: 'biFailure',
      startsEnabled: true,
      listedColumns: ['description', 'project_type', 'warehouse_type'],
      applySchema,
      source: () => {
        const source = ctx.biSource
        return { sourceCode: source.sourceCode, providerKind: source.providerKind, list: () => source.listProjects() }
      },
      describe: (project, source) => ({
        ref: formatBiProjectRef({
          providerKind: source.providerKind, sourceCode: source.sourceCode, upstreamId: project.upstreamId,
        }),
        upstreamId: project.upstreamId,
        displayName: project.name,
        values: [project.description, project.projectType, project.warehouseType],
      }),
      failureReason: error => error instanceof BiError ? error.reason : 'upstream-invalid',
      unknownEntry: () => new BiError('not-allowed', 'no such project'),
      entry: toEntry,
    })
  }

  sync(orgId: OrgId): Promise<BiCatalogView> {
    return this.catalog.sync(orgId)
  }

  catalogView(orgId: OrgId): Promise<BiCatalogView> {
    return this.catalog.view(orgId)
  }

  setEnabled(orgId: OrgId, ref: BiProjectRef, enabled: boolean): Promise<void> {
    return this.catalog.setEnabled(orgId, ref, enabled)
  }

  async directory(principal: BiPrincipal): Promise<readonly BiProjectEntry[]> {
    const entries = await this.catalog.authorizedEntries(principal, BI_QUERY_ACTION)
    return entries.map(entry => ({ ref: entry.ref, displayName: entry.displayName }))
  }

  async charts(request: GovernedChartsRequest): Promise<BiChartPage> {
    const row = await this.admitted(request, request.ref, 'bi.charts')
    let listing
    try {
      listing = await this.ctx.biSource.listCharts({
        upstreamId: row.upstream_id,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      await this.record(request, request.ref, 'bi.charts', 'error', undefined, upstreamLabel(error))
      throw error
    }
    // The keyword narrows over names the source does not index, so it is
    // applied here, over the whole listing, and the page is cut from what
    // matched: a total counts matches, not charts the source holds.
    const needle = request.query?.trim().toLowerCase() ?? ''
    const matched = needle === ''
      ? listing.charts
      : listing.charts.filter(chart => [chart.name, chart.spaceName, chart.description].some(field => field.toLowerCase().includes(needle)))
    const page = request.page ?? 1
    const pageSize = request.pageSize ?? this.resolved.defaultChartPageSize
    const charts = matched.slice((page - 1) * pageSize, page * pageSize).map(chart => toSummary(request.ref, chart))
    await this.record(request, request.ref, 'bi.charts', 'allowed', charts.length)
    return { ref: request.ref, charts, page, pageSize, total: matched.length }
  }

  async query(request: GovernedQueryRequest): Promise<BiQueryResult> {
    const parts = parseBiChartRef(request.chartRef)
    if (parts === undefined) {
      // A reference that is not one names no project to record against, and
      // is refused as any unknown project is, so a malformed reference learns
      // nothing a forged one would not.
      await this.record(request, undefined, 'bi.query', 'denied', undefined, undefined, 'no-grant')
      throw new BiError('not-allowed', 'that project is not available')
    }
    const ref = parts.ref
    const row = await this.admitted(request, ref, 'bi.query')
    let placement
    try {
      // The source is asked where the chart sits before it is asked to run
      // anything: a reference whose project disagrees with the source's is
      // refused with nothing read.
      placement = await this.ctx.biSource.describeChart(parts.upstreamChartId, request.signal)
    } catch (error) {
      await this.record(request, ref, 'bi.query', 'error', undefined, upstreamLabel(error))
      throw error
    }
    if (placement.upstreamId !== row.upstream_id) {
      await this.record(request, ref, 'bi.query', 'error', undefined, 'chart-unavailable')
      throw new BiError('chart-unavailable', 'that chart is not in the project the reference names')
    }
    let run
    try {
      run = await this.ctx.biSource.runChart({
        upstreamId: row.upstream_id,
        upstreamChartId: placement.chart.upstreamChartId,
        limit: request.limit ?? this.resolved.defaultMaxRows,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      await this.record(request, ref, 'bi.query', 'error', undefined, upstreamLabel(error))
      throw error
    }
    await this.record(request, ref, 'bi.query', 'allowed', run.rows.length)
    return {
      chartRef: request.chartRef,
      ref,
      name: placement.chart.name,
      kind: placement.chart.kind,
      description: placement.chart.description,
      fields: run.fields,
      filters: run.filters,
      rows: run.rows,
      rowCount: run.rowCount,
      truncated: run.truncated,
      cellsTruncated: run.cellsTruncated,
    }
  }

  /**
   * The catalog row one member-facing operation may act on.
   *
   * An unknown, disabled, and unauthorized project are one refusal, recorded
   * the same way, so a member holding nothing cannot learn that one exists.
   */
  private async admitted(principal: BiPrincipal, ref: BiProjectRef, action: MemberAction): Promise<ProjectRow> {
    const row = await this.catalog.admit(principal, ref, BI_QUERY_ACTION)
    if (row === undefined) {
      await this.record(principal, ref, action, 'denied', undefined, undefined, 'no-grant')
      throw new BiError('not-allowed', 'that project is not available')
    }
    return row
  }

  /**
   * Record one member-facing outcome against one governed project, or against
   * none when the request named no project this build could read.
   */
  private async record(
    principal: BiPrincipal,
    ref: string | undefined,
    action: MemberAction,
    outcome: 'allowed' | 'denied' | 'error',
    itemCount: number | undefined,
    failure?: string,
    reason?: 'no-grant',
  ): Promise<void> {
    await this.catalog.record(principal, {
      action,
      outcome,
      resourceId: ref,
      reason,
      metadata: { itemCount, biFailure: failure },
    })
  }
}

/**
 * The failure label one upstream error is recorded under.
 *
 * Only the closed upstream classes are recordable metadata: a cancellation or
 * an authorization reason arriving here would be a caller's, not the source's,
 * and carries no failure label.
 */
function upstreamLabel(error: unknown): string | undefined {
  const reason = error instanceof BiError ? error.reason : 'upstream-invalid'
  switch (reason) {
    case 'upstream-unavailable':
    case 'upstream-invalid':
    case 'chart-unavailable':
    case 'query-failed':
      return reason
    default:
      return undefined
  }
}

/** Project one catalog row for a reader, with its governed resource state. */
function toEntry(row: ProjectRow, resource: ManagedResource): BiCatalogEntry {
  const adminEnabled = row.admin_enabled === 1
  return {
    ref: BiProjectRef(row.project_ref),
    resourceId: resource.id,
    displayName: row.display_name,
    description: row.description,
    projectType: row.project_type,
    warehouseType: row.warehouse_type,
    adminEnabled,
    // The governed resource is the authority on whether anything is admitted,
    // so an interrupted write that left it disabled reads as disabled here too.
    effectiveEnabled: adminEnabled && resource.enabled,
    lastDiscoveredAt: row.last_discovered_at,
  }
}

/** Address one upstream chart by a governed reference over its project. */
function toSummary(ref: BiProjectRef, chart: UpstreamChart): BiChartSummary {
  return {
    // The provider answers only ids a governed reference can carry, so
    // minting one here cannot fail; a source that broke that promise was
    // refused as unreadable before this line.
    chartRef: formatBiChartRef({ ref, upstreamChartId: chart.upstreamChartId }),
    ref,
    name: chart.name,
    spaceName: chart.spaceName,
    description: chart.description,
    kind: chart.kind,
    updatedAt: chart.updatedAt,
  }
}
