/**
 * The SQLite-backed governed knowledge gateway: the durable catalog, the
 * reconciliation that keeps it honest, and the authorization decision in front
 * of every member-facing operation.
 *
 * Two databases are involved and they cannot commit together. Access control
 * stays authoritative for roles, grants, and resources; this catalog records
 * what a knowledge base is. Reconciliation is therefore idempotent and
 * repeated: a write that failed after the first of the pair is discovered and
 * repaired by the next synchronization rather than left as a permanent
 * disagreement.
 * @module @deepseek-ai/dsh-knowledge-gateway-sqlite
 */

import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ManagedResource } from '@deepseek-ai/dsh-access-control'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import {
  KnowledgeError,
  KnowledgeRef,
  formatKnowledgeRef,
  type KnowledgeBaseEntry,
  type KnowledgeKind,
  type KnowledgePassage,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import {
  KNOWLEDGE_CATALOG_RESOURCE,
  KNOWLEDGE_RESOURCE_TYPE,
  KnowledgeGateway,
  type GovernedSearchRequest,
  type KnowledgeCatalogEntry,
  type KnowledgeCatalogView,
  type KnowledgePrincipal,
  type KnowledgeSourceStatus,
} from '@deepseek-ai/dsh-knowledge-gateway'
import type { UpstreamKnowledgeBase } from '@deepseek-ai/dsh-knowledge-source'
import type {} from '@deepseek-ai/dsh-audit'
import { applySchema, type KnowledgeBaseRow, type SourceRow } from './schema.ts'

export {
  KNOWLEDGE_GATEWAY_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
} from './schema.ts'

/** Plugin config: where the catalog lives, and what one search may return. */
export interface Config {
  /** Path to the catalog database. */
  path: string
  /** The most passages one search returns when a caller names no bound. */
  defaultMaxResults?: number
}

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** The most passages one search returns when a caller names no bound. */
const DEFAULT_MAX_RESULTS = 10

/** Cordis plugin name. */
export const name = 'knowledge-gateway-sqlite'

/**
 * The governed catalog over SQLite.
 *
 * Every member-facing operation resolves its scope against this catalog and
 * evaluates access per knowledge base before the source is called. Nothing here
 * caches a decision: a role change, a disabled entry, a suspended member, and a
 * revoked device all take effect on the next call.
 */
export default class SqliteKnowledgeGateway extends KnowledgeGateway {
  static inject = ['accessControl', 'audit', 'knowledgeSource']

  static Config: z<Config> = z.object({
    path: z.string().required(),
    defaultMaxResults: z.natural().default(DEFAULT_MAX_RESULTS),
  })

  private readonly db: DatabaseSync
  private readonly resolved: ResolvedConfig
  /** The synchronization in flight, so concurrent callers join it. */
  private running: Promise<KnowledgeCatalogView> | undefined

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.db = new DatabaseSync(config.path)
    applySchema(this.db)
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
    ctx.effect(() => () => { this.db.close() }, 'knowledge-gateway-sqlite: close the catalog')
  }

  async sync(orgId: OrgId): Promise<KnowledgeCatalogView> {
    // Concurrent callers join the operation in flight rather than racing two
    // reconciliations over the same rows.
    this.running ??= this.reconcile(orgId).finally(() => { this.running = undefined })
    return this.running
  }

  async catalogView(orgId: OrgId): Promise<KnowledgeCatalogView> {
    const resources = await this.resourcesByRef(orgId)
    return {
      source: this.sourceStatus(orgId),
      entries: this.rows(orgId).flatMap((row) => {
        const resource = resources.get(row.knowledge_ref)
        // A row whose managed resource is missing is an interrupted
        // registration, which the next synchronization repairs. Showing it as
        // governed would offer a role editor an id no grant could name.
        return resource === undefined ? [] : [toEntry(row, resource)]
      }),
    }
  }

  async setEnabled(orgId: OrgId, ref: KnowledgeRef, enabled: boolean): Promise<void> {
    const row = this.row(orgId, ref)
    if (row === undefined) throw new KnowledgeError('not-allowed', 'no such knowledge base')
    this.db.prepare('UPDATE knowledge_base SET admin_enabled = ? WHERE org_id = ? AND knowledge_ref = ?')
      .run(enabled ? 1 : 0, orgId, ref)
    const resource = (await this.resourcesByRef(orgId)).get(ref)
    if (resource !== undefined) {
      // Effective access is the conjunction: an entry the source no longer
      // lists stays unusable however an administrator switches it.
      await this.ctx.accessControl.setResourceEnabled(resource.id, enabled && row.remote_present === 1)
    }
  }

  async directory(principal: KnowledgePrincipal): Promise<readonly KnowledgeBaseEntry[]> {
    const entries = await this.authorizedEntries(principal)
    return entries.map(entry => ({
      ref: entry.ref,
      displayName: entry.displayName,
      description: entry.description,
      kind: entry.kind,
    }))
  }

  async search(request: GovernedSearchRequest): Promise<KnowledgeSearchResult> {
    const scoped = await this.resolveScope(request)
    if (scoped.length === 0) {
      // `all` for a principal holding nothing, which is a refusal rather than
      // an empty search: calling the source with no scope would let its own
      // configuration decide what to read.
      await this.record(request, 'denied', undefined, 'no-grant')
      throw new KnowledgeError('not-allowed', 'no authorized knowledge base is in scope')
    }
    this.assertOneEmbeddingModel(scoped, request)
    const maxResults = request.maxResults ?? this.resolved.defaultMaxResults
    const byUpstream = new Map(scoped.map(row => [row.upstream_id, row]))
    let passages: readonly KnowledgePassage[]
    try {
      const upstream = await this.ctx.knowledgeSource.search({
        upstreamIds: scoped.map(row => row.upstream_id),
        query: request.query,
        maxResults,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      passages = upstream.flatMap((passage) => {
        const row = byUpstream.get(passage.upstreamId)
        // The source can answer with a base the request did not name; a hit
        // this gateway cannot attribute to something it authorized is dropped
        // rather than shown without provenance.
        return row === undefined ? [] : [{
          ref: KnowledgeRef(row.knowledge_ref),
          title: passage.title,
          text: passage.text,
          truncated: passage.truncated,
          score: passage.score,
        }]
      })
    } catch (error) {
      await this.recordUpstreamFailure(request, scoped, error)
      throw error
    }
    for (const row of scoped) {
      await this.record({ ...request, resourceRef: row.knowledge_ref }, 'allowed', passages.length)
    }
    return {
      query: request.query,
      searched: scoped.map(row => ({
        ref: KnowledgeRef(row.knowledge_ref),
        displayName: row.display_name,
        description: row.description,
        kind: row.kind as KnowledgeKind,
      })),
      passages,
      truncated: passages.length >= maxResults,
    }
  }

  /**
   * Turn one request's scope into the catalog rows it may search.
   *
   * `all` expands to what the principal currently holds; `selected` authorizes
   * each named reference and refuses the whole request on the first failure. An
   * unknown reference and an unauthorized one produce the same refusal, so a
   * member holding nothing cannot learn that a knowledge base exists.
   */
  private async resolveScope(request: GovernedSearchRequest): Promise<readonly KnowledgeBaseRow[]> {
    if (request.scope.mode === 'all') {
      // Every authorized entry came from a catalog row, so the lookup cannot
      // miss: `authorizedEntries` enumerates the same table.
      const authorized = new Set<string>((await this.authorizedEntries(request)).map(entry => entry.ref))
      return this.rows(request.orgId).filter(row => authorized.has(row.knowledge_ref))
    }
    const rows: KnowledgeBaseRow[] = []
    for (const ref of request.scope.refs) {
      const row = this.row(request.orgId, ref)
      const usable = row !== undefined && row.remote_present === 1 && row.admin_enabled === 1
      const allowed = usable && await this.maySearch(request, ref)
      if (!allowed) {
        await this.record({ ...request, resourceRef: ref }, 'denied', undefined, 'no-grant')
        throw new KnowledgeError('not-allowed', 'a knowledge base in scope is not available')
      }
      rows.push(row)
    }
    return rows
  }

  /**
   * Refuse a multi-base scope whose members do not share an embedding model.
   *
   * Cross-knowledge-base retrieval is defined only for knowledge bases that
   * share one, and a source declares no error for a set that does not — so the
   * behavior of such a call is unspecified. Unspecified upstream behavior must
   * not become a silent product behavior.
   */
  private assertOneEmbeddingModel(rows: readonly KnowledgeBaseRow[], principal: KnowledgePrincipal): void {
    const models = new Set(rows.map(row => row.embedding_model_id))
    if (models.size <= 1) return
    void this.record(principal, 'denied', undefined, undefined, 'scope-incompatible')
    throw new KnowledgeError('scope-incompatible', 'the selected knowledge bases do not share one embedding model')
  }

  /** Every catalog entry this principal currently holds `knowledge.search` on. */
  private async authorizedEntries(principal: KnowledgePrincipal): Promise<readonly KnowledgeCatalogEntry[]> {
    const resources = await this.resourcesByRef(principal.orgId)
    const entries: KnowledgeCatalogEntry[] = []
    // The durable catalog is enumerated, never `listResources`: the catalog
    // administration resource shares this resource type, and an `all`-mode type
    // grant on knowledge.search would otherwise admit it as a knowledge base.
    for (const row of this.rows(principal.orgId)) {
      if (row.remote_present !== 1 || row.admin_enabled !== 1) continue
      const resource = resources.get(row.knowledge_ref)
      if (resource === undefined) continue
      if (!await this.maySearch(principal, KnowledgeRef(row.knowledge_ref))) continue
      entries.push(toEntry(row, resource))
    }
    return entries
  }

  /** One access decision, asked fresh so a revoked grant lands on this call. */
  private async maySearch(principal: KnowledgePrincipal, ref: KnowledgeRef): Promise<boolean> {
    const decision = await this.ctx.accessControl.authorize({
      orgId: principal.orgId,
      principalId: principal.principalId,
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      action: 'knowledge.search',
      resourceType: KNOWLEDGE_RESOURCE_TYPE,
      resourceId: ref,
      ...(principal.correlationId === undefined
        ? {}
        : { context: { sessionCorrelationId: principal.correlationId } }),
    })
    return decision.allowed
  }

  /** Reconcile the catalog against one full listing, then access control. */
  private async reconcile(orgId: OrgId): Promise<KnowledgeCatalogView> {
    const now = Date.now()
    const source = this.ctx.knowledgeSource
    this.touchSource(orgId, source.sourceCode, source.providerKind, now)
    let listed: readonly UpstreamKnowledgeBase[]
    try {
      listed = await source.list()
    } catch (error) {
      // A failed listing leaves the last successful snapshot in place. One
      // outage must not disable every knowledge base an organization governs.
      const reason = error instanceof KnowledgeError ? error.reason : 'upstream-invalid'
      this.db.prepare('UPDATE knowledge_source SET last_failure = ? WHERE org_id = ? AND source_code = ?')
        .run(reason, orgId, source.sourceCode)
      await this.recordSync(orgId, 'error', undefined, reason)
      return this.catalogView(orgId)
    }
    this.applyListing(orgId, source.sourceCode, source.providerKind, listed, now)
    await this.registerResources(orgId)
    await this.recordSync(orgId, 'allowed', listed.length)
    return this.catalogView(orgId)
  }

  /** Write one successful listing into the catalog in a single transaction. */
  private applyListing(
    orgId: OrgId,
    sourceCode: string,
    providerKind: string,
    listed: readonly UpstreamKnowledgeBase[],
    now: number,
  ): void {
    const seen = new Set<string>()
    this.db.exec('BEGIN')
    try {
      for (const base of listed) {
        const ref = formatKnowledgeRef({ providerKind, sourceCode, upstreamId: base.upstreamId })
        seen.add(ref)
        this.db.prepare(
          `INSERT INTO knowledge_base (
             org_id, knowledge_ref, source_code, upstream_id, display_name, description, kind,
             document_count, processing_count, embedding_model_id,
             admin_enabled, remote_present, last_discovered_at, upstream_updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
           ON CONFLICT (org_id, knowledge_ref) DO UPDATE SET
             display_name = excluded.display_name,
             description = excluded.description,
             kind = excluded.kind,
             document_count = excluded.document_count,
             processing_count = excluded.processing_count,
             embedding_model_id = excluded.embedding_model_id,
             remote_present = 1,
             last_discovered_at = excluded.last_discovered_at,
             upstream_updated_at = excluded.upstream_updated_at`,
        ).run(
          orgId, ref, sourceCode, base.upstreamId, base.name, base.description, base.kind,
          base.documentCount, base.processingCount, base.embeddingModelId,
          now, base.updatedAt ?? null,
        )
      }
      for (const row of this.rows(orgId)) {
        // Absent from a successful full listing: the row and its grants stay,
        // because a temporary removal must not silently replace identity, and
        // deleting the resource would delete every grant naming it.
        if (!seen.has(row.knowledge_ref) && row.remote_present === 1) {
          this.db.prepare('UPDATE knowledge_base SET remote_present = 0 WHERE org_id = ? AND knowledge_ref = ?')
            .run(orgId, row.knowledge_ref)
        }
      }
      this.db.prepare('UPDATE knowledge_source SET last_success_at = ?, last_failure = NULL WHERE org_id = ? AND source_code = ?')
        .run(now, orgId, sourceCode)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  /** Bring access control's governed resources up to the catalog. */
  private async registerResources(orgId: OrgId): Promise<void> {
    for (const row of this.rows(orgId)) {
      const resource = await this.ctx.accessControl.registerResource({
        orgId,
        type: KNOWLEDGE_RESOURCE_TYPE,
        externalRef: row.knowledge_ref,
        displayName: row.display_name,
      })
      const shouldEnable = row.remote_present === 1 && row.admin_enabled === 1
      if (resource.enabled !== shouldEnable) {
        await this.ctx.accessControl.setResourceEnabled(resource.id, shouldEnable)
      }
    }
  }

  /** The governed knowledge resources of one organization, keyed by reference. */
  private async resourcesByRef(orgId: OrgId): Promise<ReadonlyMap<string, ManagedResource>> {
    const resources = await this.ctx.accessControl.listResources(orgId, KNOWLEDGE_RESOURCE_TYPE)
    return new Map(resources.map(resource => [resource.externalRef, resource]))
  }

  /** Every catalog row of one organization, in reference order. */
  private rows(orgId: OrgId): readonly KnowledgeBaseRow[] {
    return this.db.prepare('SELECT * FROM knowledge_base WHERE org_id = ? ORDER BY knowledge_ref')
      .all(orgId) as unknown as KnowledgeBaseRow[]
  }

  /** One catalog row, or undefined when the catalog holds none. */
  private row(orgId: OrgId, ref: string): KnowledgeBaseRow | undefined {
    return this.db.prepare('SELECT * FROM knowledge_base WHERE org_id = ? AND knowledge_ref = ?')
      .get(orgId, ref) as unknown as KnowledgeBaseRow | undefined
  }

  /** Record that an attempt happened, creating the source row on first sight. */
  private touchSource(orgId: OrgId, sourceCode: string, providerKind: string, now: number): void {
    this.db.prepare(
      `INSERT INTO knowledge_source (org_id, source_code, provider_kind, last_attempt_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (org_id, source_code) DO UPDATE SET
         provider_kind = excluded.provider_kind,
         last_attempt_at = excluded.last_attempt_at`,
    ).run(orgId, sourceCode, providerKind, now)
  }

  /** How the configured source is doing, as the administration page reads it. */
  private sourceStatus(orgId: OrgId): KnowledgeSourceStatus {
    const row = this.db.prepare('SELECT * FROM knowledge_source WHERE org_id = ? LIMIT 1')
      .get(orgId) as unknown as SourceRow | undefined
    const source = this.ctx.knowledgeSource
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
      action: 'knowledge.catalog.sync',
      outcome,
      resourceId: KNOWLEDGE_CATALOG_RESOURCE,
      metadata: {
        ...(itemCount === undefined ? {} : { itemCount }),
        ...(failure === undefined ? {} : { knowledgeFailure: failure }),
      },
    })
  }

  /** Record one search outcome against one governed knowledge resource. */
  private async record(
    principal: KnowledgePrincipal & { resourceRef?: string },
    outcome: 'allowed' | 'denied' | 'error',
    itemCount: number | undefined,
    reason?: 'no-grant',
    failure?: string,
  ): Promise<void> {
    await this.ctx.audit.record({
      orgId: principal.orgId,
      action: 'knowledge.search',
      outcome,
      principalId: principal.principalId,
      ...(principal.resourceRef === undefined ? {} : { resourceId: principal.resourceRef }),
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      ...(principal.correlationId === undefined ? {} : { correlationId: principal.correlationId }),
      ...(reason === undefined ? {} : { reason }),
      metadata: {
        ...(itemCount === undefined ? {} : { itemCount }),
        ...(failure === undefined ? {} : { knowledgeFailure: failure }),
      },
    })
  }

  /** Record that the source failed after this request was authorized. */
  private async recordUpstreamFailure(
    request: GovernedSearchRequest,
    scoped: readonly KnowledgeBaseRow[],
    error: unknown,
  ): Promise<void> {
    const reason = error instanceof KnowledgeError ? error.reason : 'upstream-invalid'
    // Only the closed upstream classes are recordable metadata; a cancellation
    // or an authorization reason arriving here would be a caller's, not the
    // source's, and carries no failure label.
    const label = reason === 'upstream-unavailable' || reason === 'upstream-invalid' ? reason : undefined
    for (const row of scoped) {
      await this.record({ ...request, resourceRef: row.knowledge_ref }, 'error', undefined, undefined, label)
    }
  }
}

/** Project one catalog row for a reader, with its governed resource state. */
function toEntry(row: KnowledgeBaseRow, resource: ManagedResource): KnowledgeCatalogEntry {
  const adminEnabled = row.admin_enabled === 1
  const remotePresent = row.remote_present === 1
  return {
    ref: KnowledgeRef(row.knowledge_ref),
    resourceId: resource.id,
    displayName: row.display_name,
    description: row.description,
    kind: row.kind as KnowledgeKind,
    documentCount: row.document_count,
    processingCount: row.processing_count,
    embeddingModelId: row.embedding_model_id,
    adminEnabled,
    remotePresent,
    // The governed resource is the authority on whether anything is admitted,
    // so an interrupted write that left it disabled reads as disabled here too.
    effectiveEnabled: adminEnabled && remotePresent && resource.enabled,
    lastDiscoveredAt: row.last_discovered_at,
    upstreamUpdatedAt: row.upstream_updated_at ?? undefined,
  }
}
