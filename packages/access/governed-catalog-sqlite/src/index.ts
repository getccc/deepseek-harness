/**
 * The governed catalog engine shared by the knowledge, BI, and GMO gateways:
 * a durable SQLite catalog of what a source governs, the reconciliation that
 * keeps it honest, and the access decision in front of each entry.
 *
 * Two databases are involved and they cannot commit together. Access control
 * stays authoritative for roles, grants, and resources; the catalog records
 * what an entry is. Reconciliation is therefore idempotent and repeated: a
 * write that failed after the first of the pair is discovered and repaired by
 * the next synchronization rather than left as a permanent disagreement.
 *
 * A capability describes its tables, vocabulary, and row mapping in a
 * {@link GovernedCatalogSpec} and keeps everything that is its own: the shape
 * of its operations, what it asks its source, and what it records beyond the
 * common audit fields.
 * @module @deepseek-ai/dsh-governed-catalog-sqlite
 */

import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import type { ManagedResource } from '@deepseek-ai/dsh-access-control'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import type { AuditMetadata, MetadataKey } from '@deepseek-ai/dsh-audit'
import type {
  CatalogDatabaseConfig,
  CatalogRow,
  CatalogView,
  GovernedCatalogSpec,
  GovernedPrincipal,
  ListedEntry,
  MemberRecord,
  SourceRow,
  SourceStatus,
} from './types.ts'

export { applyCatalogSchema } from './schema.ts'
export type {
  CatalogDatabaseConfig,
  CatalogRow,
  CatalogSchema,
  CatalogSource,
  CatalogView,
  GovernedCatalogSpec,
  GovernedPrincipal,
  JournalMode,
  ListedEntry,
  MemberRecord,
  SourceHealth,
  SourceRow,
  SourceStatus,
} from './types.ts'

/**
 * The governed catalog of one capability over SQLite.
 *
 * Every member-facing operation resolves its entry against this catalog and
 * evaluates access before the source is asked for anything. Nothing here
 * caches a decision: a role change, a disabled entry, a suspended member, and
 * a revoked device all take effect on the next call.
 */
export class GovernedCatalog<
  C extends string,
  Row extends CatalogRow<C>,
  Entry extends { readonly ref: string },
  Listed,
> {
  private readonly db: DatabaseSync
  /** The synchronization in flight, so concurrent callers join it. */
  private running: Promise<CatalogView<Entry>> | undefined
  private readonly upsert: string

  /**
   * Open the database, apply the capability's schema, and tie the connection to the caller's fiber.
   * @param ctx - the gateway's context; the connection closes when its fiber is disposed.
   * @param config - where the database lives and how it journals.
   * @param spec - the capability's tables, vocabulary, and row mapping.
   */
  constructor(
    private readonly ctx: Context,
    config: CatalogDatabaseConfig,
    private readonly spec: GovernedCatalogSpec<C, Row, Entry, Listed>,
  ) {
    this.db = new DatabaseSync(config.path, { timeout: config.busyTimeoutMs })
    spec.applySchema(this.db)
    this.db.exec(`PRAGMA journal_mode = ${config.journalMode}`)
    // SQLite builds may default WAL to NORMAL, which can lose a resolved write to power loss.
    this.db.exec('PRAGMA synchronous = FULL')
    this.upsert = upsertStatement(spec)
    ctx.effect(() => () => { this.db.close() }, `${spec.name}: close the catalog`)
  }

  /**
   * Reconcile the catalog against one full listing of the source.
   *
   * Concurrent callers join the operation in flight rather than racing two
   * reconciliations over the same rows.
   * @param orgId - the organization to synchronize.
   * @returns the catalog as an administrator reads it afterwards.
   */
  async sync(orgId: OrgId): Promise<CatalogView<Entry>> {
    this.running ??= this.reconcile(orgId).finally(() => { this.running = undefined })
    return this.running
  }

  /**
   * The catalog as an administrator reads it.
   * @param orgId - the organization to read.
   * @returns the source status and every entry that has a governed resource.
   */
  async view(orgId: OrgId): Promise<CatalogView<Entry>> {
    const resources = await this.resourcesByRef(orgId)
    return {
      source: this.sourceStatus(orgId),
      entries: this.rows(orgId).flatMap((row) => {
        const resource = resources.get(row[this.spec.refColumn])
        // A row whose managed resource is missing is an interrupted
        // registration, which the next synchronization repairs. Showing it as
        // governed would offer a role editor an id no grant could name.
        return resource === undefined ? [] : [this.spec.entry(row, resource)]
      }),
    }
  }

  /**
   * Switch one entry on or off, in the catalog and on its governed resource.
   * @param orgId - the organization that owns the entry.
   * @param ref - the governed reference of the entry.
   * @param enabled - the administrator's choice.
   * @throws the capability's refusal when the catalog holds no such entry.
   */
  async setEnabled(orgId: OrgId, ref: string, enabled: boolean): Promise<void> {
    if (this.row(orgId, ref) === undefined) throw this.spec.unknownEntry()
    const { table, refColumn } = this.spec
    this.db.prepare(`UPDATE ${table} SET admin_enabled = ? WHERE org_id = ? AND ${refColumn} = ?`)
      .run(enabled ? 1 : 0, orgId, ref)
    const resource = (await this.resourcesByRef(orgId)).get(ref)
    if (resource !== undefined) await this.ctx.accessControl.setResourceEnabled(resource.id, enabled)
  }

  /**
   * Every catalog row of one organization, in reference order.
   * @param orgId - the organization to read.
   * @returns the rows.
   */
  rows(orgId: OrgId): readonly Row[] {
    const { table, refColumn } = this.spec
    return this.db.prepare(`SELECT * FROM ${table} WHERE org_id = ? ORDER BY ${refColumn}`)
      .all(orgId) as Row[]
  }

  /**
   * One catalog row.
   * @param orgId - the organization to read.
   * @param ref - the governed reference.
   * @returns the row, or undefined when the catalog holds none.
   */
  row(orgId: OrgId, ref: string): Row | undefined {
    const { table, refColumn } = this.spec
    return this.db.prepare(`SELECT * FROM ${table} WHERE org_id = ? AND ${refColumn} = ?`)
      .get(orgId, ref) as Row | undefined
  }

  /**
   * The catalog row one member-facing operation may act on.
   *
   * An unknown, disabled, and unauthorized entry are one outcome, so a member
   * holding nothing cannot learn that one exists.
   * @param principal - who is asking.
   * @param ref - the governed reference.
   * @param action - the permission to evaluate, asked fresh.
   * @returns the row, or undefined when the principal may not act on it.
   */
  async admit(principal: GovernedPrincipal, ref: string, action: string): Promise<Row | undefined> {
    const row = this.row(principal.orgId, ref)
    const usable = row !== undefined && row.admin_enabled === 1
    return usable && await this.may(principal, ref, action) ? row : undefined
  }

  /**
   * Every catalog entry a principal currently holds an action on.
   *
   * The durable catalog is enumerated, never `listResources`: the catalog
   * administration resource shares the resource type, and an `all`-mode type
   * grant would otherwise admit it as an entry.
   * @param principal - who is asking.
   * @param action - the permission to evaluate, asked fresh per entry.
   * @returns the entries, in reference order.
   */
  async authorizedEntries(principal: GovernedPrincipal, action: string): Promise<readonly Entry[]> {
    const resources = await this.resourcesByRef(principal.orgId)
    const entries: Entry[] = []
    for (const row of this.rows(principal.orgId)) {
      if (row.admin_enabled !== 1) continue
      const ref = row[this.spec.refColumn]
      const resource = resources.get(ref)
      if (resource === undefined) continue
      if (!await this.may(principal, ref, action)) continue
      entries.push(this.spec.entry(row, resource))
    }
    return entries
  }

  /**
   * Record one member-facing outcome.
   *
   * The metadata is references, counts, and closed words only; the audit
   * store refuses anything else.
   * @param principal - who acted.
   * @param record - the action, its outcome, and the catalog metadata keys it declares.
   */
  async record(principal: GovernedPrincipal, record: MemberRecord): Promise<void> {
    await this.ctx.audit.record({
      orgId: principal.orgId,
      action: record.action,
      outcome: record.outcome,
      principalId: principal.principalId,
      ...(record.resourceId === undefined ? {} : { resourceId: record.resourceId }),
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      ...(principal.correlationId === undefined ? {} : { correlationId: principal.correlationId }),
      ...(record.reason === undefined ? {} : { reason: record.reason }),
      metadata: definedMetadata(record.metadata),
    })
  }

  /** One access decision, asked fresh so a revoked grant lands on this call. */
  private async may(principal: GovernedPrincipal, ref: string, action: string): Promise<boolean> {
    const decision = await this.ctx.accessControl.authorize({
      orgId: principal.orgId,
      principalId: principal.principalId,
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      action,
      resourceType: this.spec.resourceType,
      resourceId: ref,
      ...(principal.correlationId === undefined
        ? {}
        : { context: { sessionCorrelationId: principal.correlationId } }),
    })
    return decision.allowed
  }

  /** Reconcile the catalog against one full listing, then access control. */
  private async reconcile(orgId: OrgId): Promise<CatalogView<Entry>> {
    const now = Date.now()
    const source = this.spec.source()
    this.touchSource(orgId, source.sourceCode, source.providerKind, now)
    let listed: readonly Listed[]
    try {
      listed = await source.list()
    } catch (error) {
      // A failed listing leaves the last successful snapshot in place. One
      // outage must not disable every entry an organization governs.
      const reason = this.spec.failureReason(error)
      this.db.prepare(`UPDATE ${this.spec.sourceTable} SET last_failure = ? WHERE org_id = ? AND source_code = ?`)
        .run(reason, orgId, source.sourceCode)
      await this.recordSync(orgId, 'error', undefined, reason)
      return this.view(orgId)
    }
    // Every entry is described, and so every reference minted, before
    // anything is written or retired: a listing this build cannot express
    // changes nothing at all.
    const named = listed.map(item => this.spec.describe(item, source))
    await this.retire(orgId, source.sourceCode, new Set(named.map(item => item.ref)))
    this.applyListing(orgId, source.sourceCode, named, now)
    await this.registerResources(orgId)
    await this.recordSync(orgId, 'allowed', listed.length)
    return this.view(orgId)
  }

  /**
   * Write one successful listing into the catalog in a single transaction.
   * @param orgId - the organization being synchronized.
   * @param sourceCode - the source whose listing this is.
   * @param named - the listing, each entry beside the reference it was minted under.
   * @param now - the discovery time to stamp.
   */
  private applyListing(orgId: OrgId, sourceCode: string, named: readonly ListedEntry[], now: number): void {
    const { table, refColumn, sourceTable } = this.spec
    this.db.exec('BEGIN')
    try {
      for (const item of named) {
        this.db.prepare(this.upsert)
          .run(orgId, item.ref, sourceCode, item.upstreamId, item.displayName, ...item.values, now)
      }
      for (const ref of this.absent(orgId, sourceCode, new Set(named.map(item => item.ref)))) {
        this.db.prepare(`DELETE FROM ${table} WHERE org_id = ? AND ${refColumn} = ?`).run(orgId, ref)
      }
      this.db.prepare(`UPDATE ${sourceTable} SET last_success_at = ?, last_failure = NULL WHERE org_id = ? AND source_code = ?`)
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
   * Scoped to one source: another source's entries are not missing from a
   * listing that never covered them.
   * @param orgId - the organization being synchronized.
   * @param sourceCode - the source whose listing this is.
   * @param seen - the references the listing named.
   * @returns the references to retire.
   */
  private absent(orgId: OrgId, sourceCode: string, seen: ReadonlySet<string>): readonly string[] {
    return this.rows(orgId)
      .filter(row => row.source_code === sourceCode && !seen.has(row[this.spec.refColumn]))
      .map(row => row[this.spec.refColumn])
  }

  /**
   * Stop governing what the source has stopped listing.
   *
   * The governed resources go before the catalog rows, and their grants with
   * them: a member cannot be granted an entry that no longer exists, and an
   * interrupted retirement leaves a row whose resource the next
   * synchronization registers afresh, with no grants, which is the outcome
   * either way.
   * @param orgId - the organization being synchronized.
   * @param sourceCode - the source whose listing this is.
   * @param seen - the references the listing named.
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
        type: this.spec.resourceType,
        externalRef: row[this.spec.refColumn],
        displayName: row.display_name,
      })
      const shouldEnable = row.admin_enabled === 1
      if (resource.enabled !== shouldEnable) {
        await this.ctx.accessControl.setResourceEnabled(resource.id, shouldEnable)
      }
    }
  }

  /** The governed resources of one organization, keyed by reference. */
  private async resourcesByRef(orgId: OrgId): Promise<ReadonlyMap<string, ManagedResource>> {
    const resources = await this.ctx.accessControl.listResources(orgId, this.spec.resourceType)
    return new Map(resources.map(resource => [resource.externalRef, resource]))
  }

  /** Record that an attempt happened, creating the source row on first sight. */
  private touchSource(orgId: OrgId, sourceCode: string, providerKind: string, now: number): void {
    this.db.prepare(
      `INSERT INTO ${this.spec.sourceTable} (org_id, source_code, provider_kind, last_attempt_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (org_id, source_code) DO UPDATE SET
         provider_kind = excluded.provider_kind,
         last_attempt_at = excluded.last_attempt_at`,
    ).run(orgId, sourceCode, providerKind, now)
  }

  /** How the configured source is doing, as the administration page reads it. */
  private sourceStatus(orgId: OrgId): SourceStatus {
    const row = this.db.prepare(`SELECT * FROM ${this.spec.sourceTable} WHERE org_id = ? LIMIT 1`)
      .get(orgId) as SourceRow | undefined
    if (row === undefined) {
      const source = this.spec.source()
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
      action: this.spec.syncAction,
      outcome,
      resourceId: this.spec.catalogResource,
      metadata: definedMetadata({ itemCount, [this.spec.failureKey]: failure }),
    })
  }
}

/**
 * The statement that writes one listed entry.
 *
 * A first sighting inserts the row with the capability's starting enablement;
 * a known entry updates its name, listed columns, and discovery time and
 * leaves `admin_enabled` alone, so a listing never overrides an
 * administrator's choice.
 */
function upsertStatement(spec: {
  readonly table: string
  readonly refColumn: string
  readonly listedColumns: readonly string[]
  readonly startsEnabled: boolean
}): string {
  const columns = spec.listedColumns
  return `INSERT INTO ${spec.table} (
      org_id, ${spec.refColumn}, source_code, upstream_id, display_name, ${columns.map(column => `${column}, `).join('')}admin_enabled, last_discovered_at
    ) VALUES (?, ?, ?, ?, ?, ${columns.map(() => '?, ').join('')}${spec.startsEnabled ? 1 : 0}, ?)
    ON CONFLICT (org_id, ${spec.refColumn}) DO UPDATE SET
      display_name = excluded.display_name,
      ${columns.map(column => `${column} = excluded.${column},\n      `).join('')}last_discovered_at = excluded.last_discovered_at`
}

/** Drop the metadata entries whose value is undefined, keeping the order of the rest. */
function definedMetadata(metadata: MemberRecord['metadata']): AuditMetadata {
  const defined: Partial<Record<MetadataKey, number | string>> = {}
  for (const [key, value] of Object.entries(metadata) as [MetadataKey, number | string | undefined][]) {
    if (value !== undefined) defined[key] = value
  }
  return defined
}
