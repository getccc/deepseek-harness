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
 * @module @deepseek-ai/dsh-bi-gateway-sqlite
 */

import { DatabaseSync } from 'node:sqlite'
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
  type BiSourceStatus,
  type GovernedChartsRequest,
  type GovernedQueryRequest,
} from '@deepseek-ai/dsh-bi-gateway'
import type { UpstreamChart, UpstreamProject } from '@deepseek-ai/dsh-bi-source'
import type {} from '@deepseek-ai/dsh-audit'
import { applySchema, type ProjectRow, type SourceRow } from './schema.ts'

export {
  BI_GATEWAY_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
} from './schema.ts'

/** Plugin config: where the catalog lives, and what one operation may return. */
export interface Config {
  /** Path to the catalog database. */
  path: string
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
    defaultChartPageSize: z.natural().min(1).default(DEFAULT_CHART_PAGE_SIZE),
    defaultMaxRows: z.natural().min(1).default(DEFAULT_MAX_ROWS),
  })

  private readonly db: DatabaseSync
  private readonly resolved: ResolvedConfig
  /** The synchronization in flight, so concurrent callers join it. */
  private running: Promise<BiCatalogView> | undefined

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.db = new DatabaseSync(config.path)
    applySchema(this.db)
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
    ctx.effect(() => () => { this.db.close() }, 'bi-gateway-sqlite: close the catalog')
  }

  async sync(orgId: OrgId): Promise<BiCatalogView> {
    // Concurrent callers join the operation in flight rather than racing two
    // reconciliations over the same rows.
    this.running ??= this.reconcile(orgId).finally(() => { this.running = undefined })
    return this.running
  }

  async catalogView(orgId: OrgId): Promise<BiCatalogView> {
    const resources = await this.resourcesByRef(orgId)
    return {
      source: this.sourceStatus(orgId),
      entries: this.rows(orgId).flatMap((row) => {
        const resource = resources.get(row.project_ref)
        // A row whose managed resource is missing is an interrupted
        // registration, which the next synchronization repairs. Showing it as
        // governed would offer a role editor an id no grant could name.
        return resource === undefined ? [] : [toEntry(row, resource)]
      }),
    }
  }

  async setEnabled(orgId: OrgId, ref: BiProjectRef, enabled: boolean): Promise<void> {
    const row = this.row(orgId, ref)
    if (row === undefined) throw new BiError('not-allowed', 'no such project')
    this.db.prepare('UPDATE bi_project SET admin_enabled = ? WHERE org_id = ? AND project_ref = ?')
      .run(enabled ? 1 : 0, orgId, ref)
    const resource = (await this.resourcesByRef(orgId)).get(ref)
    if (resource !== undefined) await this.ctx.accessControl.setResourceEnabled(resource.id, enabled)
  }

  async directory(principal: BiPrincipal): Promise<readonly BiProjectEntry[]> {
    const entries = await this.authorizedEntries(principal)
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
    const row = this.row(principal.orgId, ref)
    const usable = row !== undefined && row.admin_enabled === 1
    const allowed = usable && await this.may(principal, ref)
    if (!allowed) {
      await this.record(principal, ref, action, 'denied', undefined, undefined, 'no-grant')
      throw new BiError('not-allowed', 'that project is not available')
    }
    return row
  }

  /** Every catalog entry this principal currently holds `bi.query` on. */
  private async authorizedEntries(principal: BiPrincipal): Promise<readonly BiCatalogEntry[]> {
    const resources = await this.resourcesByRef(principal.orgId)
    const entries: BiCatalogEntry[] = []
    // The durable catalog is enumerated, never `listResources`: the catalog
    // administration resource shares this resource type, and an `all`-mode
    // type grant on bi.query would otherwise admit it as a project.
    for (const row of this.rows(principal.orgId)) {
      if (row.admin_enabled !== 1) continue
      const resource = resources.get(row.project_ref)
      if (resource === undefined) continue
      if (!await this.may(principal, BiProjectRef(row.project_ref))) continue
      entries.push(toEntry(row, resource))
    }
    return entries
  }

  /** One access decision, asked fresh so a revoked grant lands on this call. */
  private async may(principal: BiPrincipal, ref: BiProjectRef): Promise<boolean> {
    const decision = await this.ctx.accessControl.authorize({
      orgId: principal.orgId,
      principalId: principal.principalId,
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      action: BI_QUERY_ACTION,
      resourceType: BI_RESOURCE_TYPE,
      resourceId: ref,
      ...(principal.correlationId === undefined
        ? {}
        : { context: { sessionCorrelationId: principal.correlationId } }),
    })
    return decision.allowed
  }

  /** Reconcile the catalog against one full listing, then access control. */
  private async reconcile(orgId: OrgId): Promise<BiCatalogView> {
    const now = Date.now()
    const source = this.ctx.biSource
    this.touchSource(orgId, source.sourceCode, source.providerKind, now)
    let listed: readonly UpstreamProject[]
    try {
      listed = await source.listProjects()
    } catch (error) {
      // A failed listing leaves the last successful snapshot in place. One
      // outage must not disable every project an organization governs.
      const reason = error instanceof BiError ? error.reason : 'upstream-invalid'
      this.db.prepare('UPDATE bi_source SET last_failure = ? WHERE org_id = ? AND source_code = ?')
        .run(reason, orgId, source.sourceCode)
      await this.recordSync(orgId, 'error', undefined, reason)
      return this.catalogView(orgId)
    }
    // Every reference is minted before anything is written or retired: a
    // listing this build cannot express changes nothing at all.
    const named = listed.map(project => ({
      ref: formatBiProjectRef({
        providerKind: source.providerKind, sourceCode: source.sourceCode, upstreamId: project.upstreamId,
      }) as string,
      project,
    }))
    await this.retire(orgId, source.sourceCode, new Set(named.map(item => item.ref)))
    this.applyListing(orgId, source.sourceCode, named, now)
    await this.registerResources(orgId)
    await this.recordSync(orgId, 'allowed', listed.length)
    return this.catalogView(orgId)
  }

  /**
   * Write one successful listing into the catalog in a single transaction.
   * @param orgId - the organization being synchronized.
   * @param sourceCode - the source whose listing this is.
   * @param named - the listing, each entry beside the reference it was minted under.
   * @param now - the discovery time to stamp.
   */
  private applyListing(
    orgId: OrgId,
    sourceCode: string,
    named: readonly { readonly ref: string; readonly project: UpstreamProject }[],
    now: number,
  ): void {
    this.db.exec('BEGIN')
    try {
      for (const { ref, project } of named) {
        this.db.prepare(
          `INSERT INTO bi_project (
             org_id, project_ref, source_code, upstream_id, display_name, project_type, warehouse_type,
             admin_enabled, last_discovered_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (org_id, project_ref) DO UPDATE SET
             display_name = excluded.display_name,
             project_type = excluded.project_type,
             warehouse_type = excluded.warehouse_type,
             last_discovered_at = excluded.last_discovered_at`,
        ).run(orgId, ref, sourceCode, project.upstreamId, project.name, project.projectType, project.warehouseType, now)
      }
      for (const ref of this.absent(orgId, sourceCode, new Set(named.map(item => item.ref)))) {
        this.db.prepare('DELETE FROM bi_project WHERE org_id = ? AND project_ref = ?').run(orgId, ref)
      }
      this.db.prepare('UPDATE bi_source SET last_success_at = ?, last_failure = NULL WHERE org_id = ? AND source_code = ?')
        .run(now, orgId, sourceCode)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /**
   * The references this source governs that its listing no longer names.
   *
   * Scoped to one source: another source's projects are not missing from a
   * listing that never covered them.
   */
  private absent(orgId: OrgId, sourceCode: string, seen: ReadonlySet<string>): readonly string[] {
    return this.rows(orgId)
      .filter(row => row.source_code === sourceCode && !seen.has(row.project_ref))
      .map(row => row.project_ref)
  }

  /**
   * Stop governing what the source has stopped listing.
   *
   * The governed resources go before the catalog rows, and their grants with
   * them: a member cannot be granted a project that no longer exists, and an
   * interrupted retirement leaves a row whose resource the next
   * synchronization registers afresh, with no grants, which is the outcome
   * either way.
   */
  private async retire(orgId: OrgId, sourceCode: string, seen: ReadonlySet<string>): Promise<void> {
    const absent = this.absent(orgId, sourceCode, seen)
    if (absent.length === 0) return
    const resources = await this.resourcesByRef(orgId)
    for (const ref of absent) {
      const resource = resources.get(ref)
      /* v8 ignore next -- every catalog row is registered before it can be retired; the lookup answers its optional type. */
      if (resource === undefined) continue
      await this.ctx.accessControl.deleteResource(resource.id)
    }
  }

  /** Bring access control's governed resources up to the catalog. */
  private async registerResources(orgId: OrgId): Promise<void> {
    for (const row of this.rows(orgId)) {
      const resource = await this.ctx.accessControl.registerResource({
        orgId,
        type: BI_RESOURCE_TYPE,
        externalRef: row.project_ref,
        displayName: row.display_name,
      })
      const shouldEnable = row.admin_enabled === 1
      if (resource.enabled !== shouldEnable) {
        await this.ctx.accessControl.setResourceEnabled(resource.id, shouldEnable)
      }
    }
  }

  /** The governed BI resources of one organization, keyed by reference. */
  private async resourcesByRef(orgId: OrgId): Promise<ReadonlyMap<string, ManagedResource>> {
    const resources = await this.ctx.accessControl.listResources(orgId, BI_RESOURCE_TYPE)
    return new Map(resources.map(resource => [resource.externalRef, resource]))
  }

  /** Every catalog row of one organization, in reference order. */
  private rows(orgId: OrgId): readonly ProjectRow[] {
    return this.db.prepare('SELECT * FROM bi_project WHERE org_id = ? ORDER BY project_ref')
      .all(orgId) as unknown as ProjectRow[]
  }

  /** One catalog row, or undefined when the catalog holds none. */
  private row(orgId: OrgId, ref: string): ProjectRow | undefined {
    return this.db.prepare('SELECT * FROM bi_project WHERE org_id = ? AND project_ref = ?')
      .get(orgId, ref) as unknown as ProjectRow | undefined
  }

  /** Record that an attempt happened, creating the source row on first sight. */
  private touchSource(orgId: OrgId, sourceCode: string, providerKind: string, now: number): void {
    this.db.prepare(
      `INSERT INTO bi_source (org_id, source_code, provider_kind, last_attempt_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (org_id, source_code) DO UPDATE SET
         provider_kind = excluded.provider_kind,
         last_attempt_at = excluded.last_attempt_at`,
    ).run(orgId, sourceCode, providerKind, now)
  }

  /** How the configured source is doing, as the administration page reads it. */
  private sourceStatus(orgId: OrgId): BiSourceStatus {
    const row = this.db.prepare('SELECT * FROM bi_source WHERE org_id = ? LIMIT 1')
      .get(orgId) as unknown as SourceRow | undefined
    const source = this.ctx.biSource
    if (row === undefined) {
      return {
        sourceCode: source.sourceCode,
        providerKind: source.providerKind,
        health: 'never-synced',
        lastAttemptAt: undefined,
        lastSuccessAt: undefined,
        lastFailure: undefined,
      }
    }
    return {
      sourceCode: row.source_code,
      providerKind: row.provider_kind,
      health: row.last_failure !== null ? 'failing' : 'healthy',
      lastAttemptAt: row.last_attempt_at,
      lastSuccessAt: row.last_success_at ?? undefined,
      lastFailure: row.last_failure ?? undefined,
    }
  }

  /** Record one synchronization against the catalog administration resource. */
  private async recordSync(
    orgId: OrgId,
    outcome: 'allowed' | 'error',
    itemCount: number | undefined,
    failure?: string,
  ): Promise<void> {
    await this.ctx.audit.record({
      orgId,
      action: 'bi.catalog.sync',
      outcome,
      resourceId: BI_CATALOG_RESOURCE,
      metadata: {
        ...(itemCount === undefined ? {} : { itemCount }),
        ...(failure === undefined ? {} : { biFailure: failure }),
      },
    })
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
    await this.ctx.audit.record({
      orgId: principal.orgId,
      action,
      outcome,
      principalId: principal.principalId,
      ...(ref === undefined ? {} : { resourceId: ref }),
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      ...(principal.correlationId === undefined ? {} : { correlationId: principal.correlationId }),
      ...(reason === undefined ? {} : { reason }),
      metadata: {
        ...(itemCount === undefined ? {} : { itemCount }),
        ...(failure === undefined ? {} : { biFailure: failure }),
      },
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
