/**
 * The SQLite-backed governed GMO gateway: the durable category catalog, the
 * reconciliation that keeps it honest, and the authorization decision in
 * front of every member-facing operation.
 *
 * Two databases are involved and they cannot commit together. Access control
 * stays authoritative for roles, grants, and resources; this catalog records
 * what a category is. Reconciliation is therefore idempotent and repeated: a
 * write that failed after the first of the pair is discovered and repaired by
 * the next synchronization rather than left as a permanent disagreement.
 * @module @deepseek-ai/dsh-gmo-gateway-sqlite
 */

import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ManagedResource } from '@deepseek-ai/dsh-access-control'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import {
  GmoCategoryRef,
  GmoError,
  formatGmoCategoryRef,
  formatGmoResultRef,
  parseGmoResultRef,
  type GmoAnswer,
  type GmoCategoryEntry,
  type GmoDescription,
  type GmoJson,
  type GmoResultPage,
  type GmoResultSummary,
  type GmoStage,
} from '@deepseek-ai/dsh-gmo'
import {
  GMO_CATALOG_RESOURCE,
  GMO_QUERY_ACTION,
  GMO_RESOURCE_TYPE,
  GmoGateway,
  type GmoCatalogEntry,
  type GmoCatalogView,
  type GmoPrincipal,
  type GmoSourceStatus,
  type GovernedAskRequest,
  type GovernedDescribeRequest,
  type GovernedResultsRequest,
} from '@deepseek-ai/dsh-gmo-gateway'
import type { UpstreamCategory, UpstreamResult, UpstreamStage } from '@deepseek-ai/dsh-gmo-source'
import type {} from '@deepseek-ai/dsh-audit'
import { applySchema, type CategoryRow, type SourceRow } from './schema.ts'

export {
  GMO_GATEWAY_SQLITE_APPLICATION_ID,
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
  /** How many results one listing page holds when a caller names no size. */
  defaultResultPageSize?: number
}

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** How many results one listing page holds when a caller names no size. */
const DEFAULT_RESULT_PAGE_SIZE = 20

/** The audited operations this gateway performs for a member. */
type MemberAction = 'gmo.results' | 'gmo.describe' | 'gmo.ask'

/** Cordis plugin name. */
export const name = 'gmo-gateway-sqlite'

/**
 * The governed catalog over SQLite.
 *
 * Every member-facing operation resolves its category against this catalog and
 * evaluates access before the source is asked for anything. Nothing here
 * caches a decision: a role change, a disabled entry, a suspended member, and a
 * revoked device all take effect on the next call.
 */
export default class SqliteGmoGateway extends GmoGateway {
  static inject = ['accessControl', 'audit', 'gmoSource']

  static Config: z<Config> = z.object({
    path: z.string().required(),
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.natural().default(1_000),
    defaultResultPageSize: z.natural().min(1).default(DEFAULT_RESULT_PAGE_SIZE),
  })

  private readonly db: DatabaseSync
  private readonly resolved: ResolvedConfig
  /** The synchronization in flight, so concurrent callers join it. */
  private running: Promise<GmoCatalogView> | undefined

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.db = new DatabaseSync(config.path, { timeout: config.busyTimeoutMs })
    applySchema(this.db)
    this.db.exec(`PRAGMA journal_mode = ${(config as Required<Config>).journalMode}`)
    // SQLite builds may default WAL to NORMAL, which can lose a resolved write to power loss.
    this.db.exec('PRAGMA synchronous = FULL')
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
    ctx.effect(() => () => { this.db.close() }, 'gmo-gateway-sqlite: close the catalog')
  }

  async sync(orgId: OrgId): Promise<GmoCatalogView> {
    // Concurrent callers join the operation in flight rather than racing two
    // reconciliations over the same rows.
    this.running ??= this.reconcile(orgId).finally(() => { this.running = undefined })
    return this.running
  }

  async catalogView(orgId: OrgId): Promise<GmoCatalogView> {
    const resources = await this.resourcesByRef(orgId)
    return {
      source: this.sourceStatus(orgId),
      entries: this.rows(orgId).flatMap((row) => {
        const resource = resources.get(row.category_ref)
        // A row whose managed resource is missing is an interrupted
        // registration, which the next synchronization repairs. Showing it as
        // governed would offer a role editor an id no grant could name.
        return resource === undefined ? [] : [toEntry(row, resource)]
      }),
    }
  }

  async setEnabled(orgId: OrgId, ref: GmoCategoryRef, enabled: boolean): Promise<void> {
    const row = this.row(orgId, ref)
    if (row === undefined) throw new GmoError('not-allowed', 'no such category')
    this.db.prepare('UPDATE gmo_category SET admin_enabled = ? WHERE org_id = ? AND category_ref = ?')
      .run(enabled ? 1 : 0, orgId, ref)
    const resource = (await this.resourcesByRef(orgId)).get(ref)
    if (resource !== undefined) await this.ctx.accessControl.setResourceEnabled(resource.id, enabled)
  }

  async directory(principal: GmoPrincipal): Promise<readonly GmoCategoryEntry[]> {
    const entries = await this.authorizedEntries(principal)
    return entries.map(entry => ({ ref: entry.ref, displayName: entry.displayName }))
  }

  async results(request: GovernedResultsRequest): Promise<GmoResultPage> {
    const row = await this.admitted(request, request.ref, 'gmo.results')
    const page = request.page ?? 1
    let listing
    try {
      listing = await this.ctx.gmoSource.listResults({
        upstreamId: row.upstream_id,
        page,
        pageSize: request.pageSize ?? this.resolved.defaultResultPageSize,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      await this.record(request, request.ref, 'gmo.results', 'error', undefined, undefined, upstreamLabel(error))
      throw error
    }
    const results = listing.results.map(result => toSummary(request.ref, result))
    await this.record(request, request.ref, 'gmo.results', 'allowed', undefined, results.length)
    return { ref: request.ref, results, page, pageSize: listing.pageSize, total: listing.total }
  }

  async describe(request: GovernedDescribeRequest): Promise<GmoDescription> {
    const { row, ref, upstreamResultId } = await this.place(request, request.resultRef, 'gmo.describe', request.signal)
    let described
    try {
      described = await this.ctx.gmoSource.describeResult(upstreamResultId, request.signal)
    } catch (error) {
      await this.record(request, ref, 'gmo.describe', 'error', undefined, undefined, upstreamLabel(error))
      throw error
    }
    // The description names its own category: a source that placed the result
    // in one category and describes it as another has contradicted itself, and
    // nothing it says is trusted.
    if (described.upstreamId !== row.upstream_id) {
      await this.record(request, ref, 'gmo.describe', 'error', undefined, undefined, 'result-unavailable')
      throw new GmoError('result-unavailable', 'that result is not in the category the reference names')
    }
    await this.record(request, ref, 'gmo.describe', 'allowed', undefined, undefined)
    const { upstreamId: _upstreamId, upstreamResultId: _resultId, stages, ...rest } = described
    return { ...rest, resultRef: request.resultRef, ref, stages: stages.map(stage => toStage(ref, stage)) }
  }

  async ask(request: GovernedAskRequest): Promise<GmoAnswer> {
    const { row, ref, upstreamResultId } = await this.place(request, request.resultRef, 'gmo.ask', request.signal)
    let answer
    try {
      answer = await this.ctx.gmoSource.ask({
        upstreamId: row.upstream_id,
        upstreamResultId,
        query: request.query,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      await this.record(request, ref, 'gmo.ask', 'error', request.query.kind, undefined, upstreamLabel(error))
      throw error
    }
    // The figures are checked against the category that was authorized, so an
    // answer the source attributes elsewhere is dropped unread.
    if (answer.upstreamId !== row.upstream_id) {
      await this.record(request, ref, 'gmo.ask', 'error', request.query.kind, undefined, 'result-unavailable')
      throw new GmoError('result-unavailable', 'that result is not in the category the reference names')
    }
    await this.record(request, ref, 'gmo.ask', 'allowed', request.query.kind, listLength(answer.data))
    return { resultRef: request.resultRef, ref, kind: request.query.kind, data: answer.data }
  }

  /**
   * Prove the two halves of a result reference agree before anything is read:
   * the category it names admits this principal now, and the source places the
   * result in that category.
   */
  private async place(
    principal: GmoPrincipal,
    resultRef: string,
    action: 'gmo.describe' | 'gmo.ask',
    signal: AbortSignal | undefined,
  ): Promise<{ row: CategoryRow; ref: GmoCategoryRef; upstreamResultId: string }> {
    const parts = parseGmoResultRef(resultRef)
    if (parts === undefined) {
      // A reference that is not one names no category to record against, and
      // is refused as any unknown category is, so a malformed reference learns
      // nothing a forged one would not.
      await this.record(principal, undefined, action, 'denied', undefined, undefined, undefined, 'no-grant')
      throw new GmoError('not-allowed', 'that category is not available')
    }
    const row = await this.admitted(principal, parts.ref, action)
    let placement
    try {
      // The source is asked where the result sits before it is asked to read
      // anything: a reference whose category disagrees with the source's is
      // refused with nothing read.
      placement = await this.ctx.gmoSource.placeResult(parts.upstreamResultId, signal)
    } catch (error) {
      await this.record(principal, parts.ref, action, 'error', undefined, undefined, upstreamLabel(error))
      throw error
    }
    if (placement.upstreamId !== row.upstream_id) {
      await this.record(principal, parts.ref, action, 'error', undefined, undefined, 'result-unavailable')
      throw new GmoError('result-unavailable', 'that result is not in the category the reference names')
    }
    return { row, ref: parts.ref, upstreamResultId: parts.upstreamResultId }
  }

  /**
   * The catalog row one member-facing operation may act on.
   *
   * An unknown, disabled, and unauthorized category are one refusal, recorded
   * the same way, so a member holding nothing cannot learn that one exists.
   */
  private async admitted(principal: GmoPrincipal, ref: GmoCategoryRef, action: MemberAction): Promise<CategoryRow> {
    const row = this.row(principal.orgId, ref)
    const usable = row !== undefined && row.admin_enabled === 1
    const allowed = usable && await this.may(principal, ref)
    if (!allowed) {
      await this.record(principal, ref, action, 'denied', undefined, undefined, undefined, 'no-grant')
      throw new GmoError('not-allowed', 'that category is not available')
    }
    return row
  }

  /** Every catalog entry this principal currently holds `gmo.query` on. */
  private async authorizedEntries(principal: GmoPrincipal): Promise<readonly GmoCatalogEntry[]> {
    const resources = await this.resourcesByRef(principal.orgId)
    const entries: GmoCatalogEntry[] = []
    // The durable catalog is enumerated, never `listResources`: the catalog
    // administration resource shares this resource type, and an `all`-mode
    // type grant on gmo.query would otherwise admit it as a category.
    for (const row of this.rows(principal.orgId)) {
      if (row.admin_enabled !== 1) continue
      const resource = resources.get(row.category_ref)
      if (resource === undefined) continue
      if (!await this.may(principal, GmoCategoryRef(row.category_ref))) continue
      entries.push(toEntry(row, resource))
    }
    return entries
  }

  /** One access decision, asked fresh so a revoked grant lands on this call. */
  private async may(principal: GmoPrincipal, ref: GmoCategoryRef): Promise<boolean> {
    const decision = await this.ctx.accessControl.authorize({
      orgId: principal.orgId,
      principalId: principal.principalId,
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      action: GMO_QUERY_ACTION,
      resourceType: GMO_RESOURCE_TYPE,
      resourceId: ref,
      ...(principal.correlationId === undefined
        ? {}
        : { context: { sessionCorrelationId: principal.correlationId } }),
    })
    return decision.allowed
  }

  /** Reconcile the catalog against one full listing, then access control. */
  private async reconcile(orgId: OrgId): Promise<GmoCatalogView> {
    const now = Date.now()
    const source = this.ctx.gmoSource
    this.touchSource(orgId, source.sourceCode, source.providerKind, now)
    let listed: readonly UpstreamCategory[]
    try {
      listed = await source.listCategories()
    } catch (error) {
      // A failed listing leaves the last successful snapshot in place. One
      // outage must not disable every category an organization governs.
      const reason = error instanceof GmoError ? error.reason : 'upstream-invalid'
      this.db.prepare('UPDATE gmo_source SET last_failure = ? WHERE org_id = ? AND source_code = ?')
        .run(reason, orgId, source.sourceCode)
      await this.recordSync(orgId, 'error', undefined, reason)
      return this.catalogView(orgId)
    }
    // Every reference is minted before anything is written or retired: a
    // listing this build cannot express changes nothing at all.
    const named = listed.map(category => ({
      ref: formatGmoCategoryRef({
        providerKind: source.providerKind, sourceCode: source.sourceCode, upstreamId: category.upstreamId,
      }) as string,
      category,
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
    named: readonly { readonly ref: string; readonly category: UpstreamCategory }[],
    now: number,
  ): void {
    this.db.exec('BEGIN')
    try {
      for (const { ref, category } of named) {
        // A category seen for the first time starts switched off; one already
        // known keeps whatever an administrator chose, so the conflict arm
        // leaves admin_enabled alone.
        this.db.prepare(
          `INSERT INTO gmo_category (
             org_id, category_ref, source_code, upstream_id, display_name, result_count, admin_enabled, last_discovered_at
           ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT (org_id, category_ref) DO UPDATE SET
             display_name = excluded.display_name,
             result_count = excluded.result_count,
             last_discovered_at = excluded.last_discovered_at`,
        ).run(orgId, ref, sourceCode, category.upstreamId, category.name, category.resultCount ?? null, now)
      }
      for (const ref of this.absent(orgId, sourceCode, new Set(named.map(item => item.ref)))) {
        this.db.prepare('DELETE FROM gmo_category WHERE org_id = ? AND category_ref = ?').run(orgId, ref)
      }
      this.db.prepare('UPDATE gmo_source SET last_success_at = ?, last_failure = NULL WHERE org_id = ? AND source_code = ?')
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
   * Scoped to one source: another source's categories are not missing from a
   * listing that never covered them.
   */
  private absent(orgId: OrgId, sourceCode: string, seen: ReadonlySet<string>): readonly string[] {
    return this.rows(orgId)
      .filter(row => row.source_code === sourceCode && !seen.has(row.category_ref))
      .map(row => row.category_ref)
  }

  /**
   * Stop governing what the source has stopped listing.
   *
   * The governed resources go before the catalog rows, and their grants with
   * them: a member cannot be granted a category that no longer exists, and an
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
        type: GMO_RESOURCE_TYPE,
        externalRef: row.category_ref,
        displayName: row.display_name,
      })
      const shouldEnable = row.admin_enabled === 1
      if (resource.enabled !== shouldEnable) {
        await this.ctx.accessControl.setResourceEnabled(resource.id, shouldEnable)
      }
    }
  }

  /** The governed GMO resources of one organization, keyed by reference. */
  private async resourcesByRef(orgId: OrgId): Promise<ReadonlyMap<string, ManagedResource>> {
    const resources = await this.ctx.accessControl.listResources(orgId, GMO_RESOURCE_TYPE)
    return new Map(resources.map(resource => [resource.externalRef, resource]))
  }

  /** Every catalog row of one organization, in reference order. */
  private rows(orgId: OrgId): readonly CategoryRow[] {
    return this.db.prepare('SELECT * FROM gmo_category WHERE org_id = ? ORDER BY category_ref')
      .all(orgId) as CategoryRow[]
  }

  /** One catalog row, or undefined when the catalog holds none. */
  private row(orgId: OrgId, ref: string): CategoryRow | undefined {
    return this.db.prepare('SELECT * FROM gmo_category WHERE org_id = ? AND category_ref = ?')
      .get(orgId, ref) as CategoryRow | undefined
  }

  /** Record that an attempt happened, creating the source row on first sight. */
  private touchSource(orgId: OrgId, sourceCode: string, providerKind: string, now: number): void {
    this.db.prepare(
      `INSERT INTO gmo_source (org_id, source_code, provider_kind, last_attempt_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (org_id, source_code) DO UPDATE SET
         provider_kind = excluded.provider_kind,
         last_attempt_at = excluded.last_attempt_at`,
    ).run(orgId, sourceCode, providerKind, now)
  }

  /** How the configured source is doing, as the administration page reads it. */
  private sourceStatus(orgId: OrgId): GmoSourceStatus {
    const row = this.db.prepare('SELECT * FROM gmo_source WHERE org_id = ? LIMIT 1')
      .get(orgId) as SourceRow | undefined
    const source = this.ctx.gmoSource
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
      action: 'gmo.catalog.sync',
      outcome,
      resourceId: GMO_CATALOG_RESOURCE,
      metadata: {
        ...(itemCount === undefined ? {} : { itemCount }),
        ...(failure === undefined ? {} : { gmoFailure: failure }),
      },
    })
  }

  /**
   * Record one member-facing outcome against one governed category, or against
   * none when the request named no category this build could read.
   *
   * The metadata is references, counts, and closed words only: which kind of
   * question was asked, how many items came back, and why it failed. The
   * question's columns and filters, and every figure, stay out of the audit
   * store.
   */
  private async record(
    principal: GmoPrincipal,
    ref: string | undefined,
    action: MemberAction,
    outcome: 'allowed' | 'denied' | 'error',
    queryKind: string | undefined,
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
        ...(queryKind === undefined ? {} : { queryKind }),
        ...(itemCount === undefined ? {} : { itemCount }),
        ...(failure === undefined ? {} : { gmoFailure: failure }),
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
  const reason = error instanceof GmoError ? error.reason : 'upstream-invalid'
  switch (reason) {
    case 'upstream-unavailable':
    case 'upstream-invalid':
    case 'result-unavailable':
    case 'unsupported':
    case 'invalid-query':
    case 'too-large':
      return reason
    default:
      return undefined
  }
}

/** How many items an answer lists, when it lists any: detail rows, or an aggregation's groups. */
function listLength(data: { readonly [key: string]: GmoJson }): number | undefined {
  const rows = data['rows']
  if (Array.isArray(rows)) return rows.length
  const groups = data['returned']
  return typeof groups === 'number' && Number.isSafeInteger(groups) && groups >= 0 ? groups : undefined
}

/** Project one catalog row for a reader, with its governed resource state. */
function toEntry(row: CategoryRow, resource: ManagedResource): GmoCatalogEntry {
  const adminEnabled = row.admin_enabled === 1
  return {
    ref: GmoCategoryRef(row.category_ref),
    resourceId: resource.id,
    displayName: row.display_name,
    resultCount: row.result_count ?? undefined,
    adminEnabled,
    // The governed resource is the authority on whether anything is admitted,
    // so an interrupted write that left it disabled reads as disabled here too.
    effectiveEnabled: adminEnabled && resource.enabled,
    lastDiscoveredAt: row.last_discovered_at,
  }
}

/** Address one upstream step by a governed reference over its category. */
function toStage(ref: GmoCategoryRef, stage: UpstreamStage): GmoStage {
  // The provider answers only ids a governed reference can carry, so minting
  // one here cannot fail; a source that broke that promise was refused as
  // unreadable before this line.
  return { key: stage.key, label: stage.label, resultRef: formatGmoResultRef({ ref, upstreamResultId: stage.upstreamResultId }) }
}

/** Address one upstream result, and its steps, by governed references over its category. */
function toSummary(ref: GmoCategoryRef, result: UpstreamResult): GmoResultSummary {
  return {
    resultRef: formatGmoResultRef({ ref, upstreamResultId: result.upstreamResultId }),
    ref,
    name: result.name,
    toolName: result.toolName,
    period: result.period,
    rows: result.rows,
    createdAt: result.createdAt,
    stages: result.stages.map(stage => toStage(ref, stage)),
  }
}
