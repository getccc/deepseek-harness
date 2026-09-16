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
  formatKnowledgeDocRef,
  formatKnowledgeRef,
  parseKnowledgeDocRef,
  upstreamDocIdOf,
  type KnowledgeBaseEntry,
  type KnowledgeDocumentContent,
  type KnowledgeDocumentPage,
  type KnowledgeKind,
  type KnowledgePassage,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import {
  KNOWLEDGE_CATALOG_RESOURCE,
  KNOWLEDGE_RESOURCE_TYPE,
  KnowledgeGateway,
  type GovernedDocumentRequest,
  type GovernedDocumentsRequest,
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

/** Plugin config: where the catalog lives, and what one operation may return. */
export interface Config {
  /** Path to the catalog database. */
  path: string
  /** The most passages one search returns when a caller names no bound. */
  defaultMaxResults?: number
  /** How many documents one listing page holds when a caller names no size. */
  defaultDocumentPageSize?: number
  /** The largest original file one read may carry when a caller names no bound. */
  defaultMaxDocumentBytes?: number
  /** The most characters of parsed text one read may carry. */
  defaultMaxDocumentTextChars?: number
}

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** The most passages one search returns when a caller names no bound. */
const DEFAULT_MAX_RESULTS = 10

/** How many documents one listing page holds when a caller names no size. */
const DEFAULT_DOCUMENT_PAGE_SIZE = 20

/** The largest original file one read carries when a caller names no bound. */
const DEFAULT_MAX_DOCUMENT_BYTES = 16 * 1024 * 1024

/** The most characters of parsed text one read carries. */
const DEFAULT_MAX_DOCUMENT_TEXT_CHARS = 200_000

/** The permission a search is evaluated against. */
const SEARCH_ACTION = 'knowledge.search'

/**
 * The permission a document listing is evaluated against.
 *
 * The same permission as a search, by product decision: a member who may
 * retrieve passages from a knowledge base may also see which documents are in
 * it. It is a constant of its own so that tightening the decision to
 * `knowledge.read` is this line plus a role-editor mode, rather than a second
 * authorization path grown beside the first.
 */
const DOCUMENT_LIST_ACTION = 'knowledge.search'

/**
 * The permission a document read is evaluated against.
 *
 * The same permission again, by the same decision: a member who may retrieve
 * passages from a knowledge base may open the documents those passages are in.
 * Its own constant so tightening this one operation to `knowledge.read` does
 * not disturb the other two.
 */
const DOCUMENT_READ_ACTION = 'knowledge.search'

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
    defaultDocumentPageSize: z.natural().min(1).default(DEFAULT_DOCUMENT_PAGE_SIZE),
    defaultMaxDocumentBytes: z.natural().min(1).default(DEFAULT_MAX_DOCUMENT_BYTES),
    defaultMaxDocumentTextChars: z.natural().min(1).default(DEFAULT_MAX_DOCUMENT_TEXT_CHARS),
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
    if (resource !== undefined) await this.ctx.accessControl.setResourceEnabled(resource.id, enabled)
  }

  async directory(principal: KnowledgePrincipal): Promise<readonly KnowledgeBaseEntry[]> {
    const entries = await this.authorizedEntries(principal)
    return entries.map(entry => ({
      ref: entry.ref,
      displayName: entry.displayName,
      description: entry.description,
      kind: entry.kind,
      // What the last reconcile recorded, not a live count: the directory is
      // an authorization answer and does not reach the source.
      documentCount: entry.documentCount,
      ...(entry.upstreamCreatedAt === undefined ? {} : { createdAt: entry.upstreamCreatedAt }),
    }))
  }

  async documents(request: GovernedDocumentsRequest): Promise<KnowledgeDocumentPage> {
    const row = this.row(request.orgId, request.ref)
    const usable = row !== undefined && row.admin_enabled === 1
    const allowed = usable && await this.may(request, request.ref, DOCUMENT_LIST_ACTION)
    if (!allowed) {
      // An unknown, disabled, and unauthorized knowledge base are one refusal,
      // so a member holding nothing cannot learn that one exists.
      await this.record(
        { ...request, resourceRef: request.ref }, 'denied', undefined, 'no-grant',
        undefined, 'knowledge.document.list',
      )
      throw new KnowledgeError('not-allowed', 'that knowledge base is not available')
    }
    const page = request.page ?? 1
    let upstream
    try {
      upstream = await this.ctx.knowledgeSource.listDocuments({
        upstreamId: row.upstream_id,
        page,
        pageSize: request.pageSize ?? this.resolved.defaultDocumentPageSize,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      await this.record(
        { ...request, resourceRef: request.ref }, 'error', undefined, undefined,
        upstreamLabel(error), 'knowledge.document.list',
      )
      throw error
    }
    await this.record(
      { ...request, resourceRef: request.ref }, 'allowed', upstream.documents.length,
      undefined, undefined, 'knowledge.document.list',
    )
    return {
      ref: request.ref,
      // The provider answers only ids a governed reference can carry, so
      // minting one here cannot fail; a source that broke that promise was
      // refused as unreadable before this line.
      documents: upstream.documents.map(document => ({
        docRef: formatKnowledgeDocRef({ ref: request.ref, upstreamDocId: document.upstreamDocId }),
        ref: request.ref,
        title: document.title,
        description: document.description,
        fileName: document.fileName,
        fileType: document.fileType,
        byteSize: document.byteSize,
        state: document.state,
        updatedAt: document.updatedAt,
      })),
      page,
      pageSize: upstream.pageSize,
      total: upstream.total,
    }
  }

  async documentContent(request: GovernedDocumentRequest): Promise<KnowledgeDocumentContent> {
    const parts = parseKnowledgeDocRef(request.docRef)
    const row = parts === undefined ? undefined : this.row(request.orgId, parts.ref)
    const usable = parts !== undefined && row !== undefined && row.admin_enabled === 1
    const allowed = usable && await this.may(request, parts.ref, DOCUMENT_READ_ACTION)
    if (!allowed) {
      await this.record(
        { ...request, resourceRef: parts?.ref ?? request.docRef }, 'denied', undefined, 'no-grant',
        undefined, 'knowledge.document.read',
      )
      throw new KnowledgeError('not-allowed', 'that document is not available')
    }
    try {
      // The source is asked where the document sits before it is asked for
      // anything in it: a reference whose knowledge base disagrees with the
      // source's is refused with nothing read.
      const placement = await this.ctx.knowledgeSource.describeDocument(
        parts.upstreamDocId,
        request.signal,
      )
      if (placement.upstreamId !== row.upstream_id) {
        await this.record(
          { ...request, resourceRef: parts.ref }, 'denied', undefined, 'no-grant',
          undefined, 'knowledge.document.read',
        )
        throw new KnowledgeError('not-allowed', 'that document is not available')
      }
      const content = await this.ctx.knowledgeSource.fetchDocument({
        upstreamDocId: parts.upstreamDocId,
        maxBytes: request.maxBytes ?? this.resolved.defaultMaxDocumentBytes,
        maxTextChars: this.resolved.defaultMaxDocumentTextChars,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      await this.record(
        { ...request, resourceRef: parts.ref }, 'allowed', undefined,
        undefined, undefined, 'knowledge.document.read',
      )
      return content.kind === 'bytes'
        ? { kind: 'bytes', docRef: request.docRef, fileName: content.fileName, contentType: content.contentType, bytes: content.bytes }
        : { kind: 'text', docRef: request.docRef, fileName: content.fileName, text: content.text, truncated: content.truncated }
    } catch (error) {
      // A refusal this method raised itself is already recorded; only an
      // upstream failure is recorded here.
      const label = upstreamLabel(error)
      if (label !== undefined) {
        await this.record(
          { ...request, resourceRef: parts.ref }, 'error', undefined, undefined,
          label, 'knowledge.document.read',
        )
      }
      throw error
    }
  }

  async search(request: GovernedSearchRequest): Promise<KnowledgeSearchResult> {
    const scoped = await this.resolveScope(request)
    const upstreamDocIds = this.documentsOf(request)
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
        ...(upstreamDocIds === undefined ? {} : { upstreamDocIds }),
        query: request.query,
        maxResults,
        ...(request.maxDocuments === undefined ? {} : { maxDocuments: request.maxDocuments }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      passages = upstream.flatMap((passage) => {
        const row = byUpstream.get(passage.upstreamId)
        // The source can answer with a base the request did not name; a hit
        // whose upstream id maps to no authorized knowledge row is dropped
        // rather than shown without its knowledge ref.
        if (row === undefined) return []
        const ref = KnowledgeRef(row.knowledge_ref)
        return [{
          ref,
          ...(passage.upstreamDocId === undefined
            ? {}
            : { docRef: formatKnowledgeDocRef({ ref, upstreamDocId: passage.upstreamDocId }) }),
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
      // A document-ranked answer is full when it names as many documents as
      // were asked for; a passage-ranked one when it carries as many passages.
      truncated: request.maxDocuments === undefined
        ? passages.length >= maxResults
        : new Set(passages.map(passage => passage.docRef ?? `${passage.ref}\u0000${passage.title}`)).size >= request.maxDocuments,
    }
  }

  /**
   * The upstream document ids a document-scoped request narrows to.
   *
   * The scope's own validation already proved every document sits inside the
   * knowledge base it names, and that knowledge base is authorized like any
   * other; what is left here is translating references the Control Plane owns
   * into the ids only the source understands.
   */
  private documentsOf(request: GovernedSearchRequest): readonly string[] | undefined {
    if (request.scope.mode !== 'documents') return undefined
    return request.scope.docRefs.map(docRef => upstreamDocIdOf(docRef))
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
    if (request.scope.mode === 'documents') {
      // One knowledge base, authorized exactly as a selection of one would be:
      // narrowing to documents inside it is a filter, never an admission.
      return this.resolveSelected(request, [request.scope.ref])
    }
    if (request.scope.mode === 'all') {
      // Every authorized entry came from a catalog row, so the lookup cannot
      // miss: `authorizedEntries` enumerates the same table.
      const authorized = new Set<string>((await this.authorizedEntries(request)).map(entry => entry.ref))
      return this.rows(request.orgId).filter(row => authorized.has(row.knowledge_ref))
    }
    return this.resolveSelected(request, request.scope.refs)
  }

  /**
   * Authorize each named knowledge base, refusing the whole request on the
   * first failure. An unknown reference and an unauthorized one produce the
   * same refusal, so a member holding nothing cannot learn that a knowledge
   * base exists.
   */
  private async resolveSelected(
    request: GovernedSearchRequest,
    refs: readonly KnowledgeRef[],
  ): Promise<readonly KnowledgeBaseRow[]> {
    const rows: KnowledgeBaseRow[] = []
    for (const ref of refs) {
      const row = this.row(request.orgId, ref)
      const usable = row !== undefined && row.admin_enabled === 1
      const allowed = usable && await this.may(request, ref, SEARCH_ACTION)
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
      if (row.admin_enabled !== 1) continue
      const resource = resources.get(row.knowledge_ref)
      if (resource === undefined) continue
      if (!await this.may(principal, KnowledgeRef(row.knowledge_ref), SEARCH_ACTION)) continue
      entries.push(toEntry(row, resource))
    }
    return entries
  }

  /** One access decision, asked fresh so a revoked grant lands on this call. */
  private async may(principal: KnowledgePrincipal, ref: KnowledgeRef, action: string): Promise<boolean> {
    const decision = await this.ctx.accessControl.authorize({
      orgId: principal.orgId,
      principalId: principal.principalId,
      ...(principal.deviceId === undefined ? {} : { deviceId: principal.deviceId }),
      action,
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
    // Every reference is minted before anything is written or retired: a
    // listing this build cannot express changes nothing at all.
    const named = listed.map(base => ({
      ref: formatKnowledgeRef({
        providerKind: source.providerKind, sourceCode: source.sourceCode, upstreamId: base.upstreamId,
      }) as string,
      base,
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
    named: readonly { readonly ref: string; readonly base: UpstreamKnowledgeBase }[],
    now: number,
  ): void {
    this.db.exec('BEGIN')
    try {
      for (const { ref, base } of named) {
        this.db.prepare(
          `INSERT INTO knowledge_base (
             org_id, knowledge_ref, source_code, upstream_id, display_name, description, kind,
             document_count, processing_count, embedding_model_id,
             admin_enabled, last_discovered_at, upstream_updated_at, upstream_created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
           ON CONFLICT (org_id, knowledge_ref) DO UPDATE SET
             display_name = excluded.display_name,
             description = excluded.description,
             kind = excluded.kind,
             document_count = excluded.document_count,
             processing_count = excluded.processing_count,
             embedding_model_id = excluded.embedding_model_id,
             last_discovered_at = excluded.last_discovered_at,
             upstream_updated_at = excluded.upstream_updated_at,
             upstream_created_at = excluded.upstream_created_at`,
        ).run(
          orgId, ref, sourceCode, base.upstreamId, base.name, base.description, base.kind,
          base.documentCount, base.processingCount, base.embeddingModelId,
          now, base.updatedAt ?? null, base.createdAt ?? null,
        )
      }
      for (const ref of this.absent(orgId, sourceCode, new Set(named.map(item => item.ref)))) {
        this.db.prepare('DELETE FROM knowledge_base WHERE org_id = ? AND knowledge_ref = ?').run(orgId, ref)
      }
      this.db.prepare('UPDATE knowledge_source SET last_success_at = ?, last_failure = NULL WHERE org_id = ? AND source_code = ?')
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
   * Scoped to one source: another source's knowledge bases are not missing
   * from a listing that never covered them.
   * @param orgId - the organization being synchronized.
   * @param sourceCode - the source whose listing this is.
   * @param seen - the references the listing named.
   * @returns the references to retire.
   */
  private absent(orgId: OrgId, sourceCode: string, seen: ReadonlySet<string>): readonly string[] {
    return this.rows(orgId)
      .filter(row => row.source_code === sourceCode && !seen.has(row.knowledge_ref))
      .map(row => row.knowledge_ref)
  }

  /**
   * Stop governing what the source has stopped listing.
   *
   * The governed resources go before the catalog rows, and their grants with
   * them: a member cannot be granted a knowledge base that no longer exists,
   * and an interrupted retirement leaves a row whose resource the next
   * synchronization registers afresh — with no grants, which is the outcome
   * either way.
   * @param orgId - the organization being synchronized.
   * @param sourceCode - the source whose listing this is.
   * @param seen - the references the listing named.
   */
  private async retire(
    orgId: OrgId,
    sourceCode: string,
    seen: ReadonlySet<string>,
  ): Promise<void> {
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
        type: KNOWLEDGE_RESOURCE_TYPE,
        externalRef: row.knowledge_ref,
        displayName: row.display_name,
      })
      const shouldEnable = row.admin_enabled === 1
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

  /** Record one member-facing outcome against one governed knowledge resource. */
  private async record(
    principal: KnowledgePrincipal & { resourceRef?: string },
    outcome: 'allowed' | 'denied' | 'error',
    itemCount: number | undefined,
    reason?: 'no-grant',
    failure?: string,
    action: 'knowledge.search' | 'knowledge.document.list' | 'knowledge.document.read' = 'knowledge.search',
  ): Promise<void> {
    await this.ctx.audit.record({
      orgId: principal.orgId,
      action,
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
    const label = upstreamLabel(error)
    for (const row of scoped) {
      await this.record({ ...request, resourceRef: row.knowledge_ref }, 'error', undefined, undefined, label)
    }
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
  const reason = error instanceof KnowledgeError ? error.reason : 'upstream-invalid'
  return reason === 'upstream-unavailable' || reason === 'upstream-invalid' ? reason : undefined
}

/** Project one catalog row for a reader, with its governed resource state. */
function toEntry(row: KnowledgeBaseRow, resource: ManagedResource): KnowledgeCatalogEntry {
  const adminEnabled = row.admin_enabled === 1
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
    // The governed resource is the authority on whether anything is admitted,
    // so an interrupted write that left it disabled reads as disabled here too.
    effectiveEnabled: adminEnabled && resource.enabled,
    lastDiscoveredAt: row.last_discovered_at,
    upstreamUpdatedAt: row.upstream_updated_at ?? undefined,
    upstreamCreatedAt: row.upstream_created_at ?? undefined,
  }
}
