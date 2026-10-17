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
 *
 * The catalog mechanics belong to `dsh-governed-catalog-sqlite`, shared with
 * the BI and GMO gateways. This module supplies the knowledge-base tables'
 * description and the member operations.
 * @module @deepseek-ai/dsh-knowledge-gateway-sqlite
 */

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
} from '@deepseek-ai/dsh-knowledge-gateway'
import type {
  UpstreamKnowledgeBase,
  UpstreamPassage,
  UpstreamSearchRequest,
} from '@deepseek-ai/dsh-knowledge-source'
import type {} from '@deepseek-ai/dsh-audit'
import { GovernedCatalog } from '@deepseek-ai/dsh-governed-catalog-sqlite'
import { applySchema, type KnowledgeBaseRow } from './schema.ts'

export {
  KNOWLEDGE_GATEWAY_SQLITE_APPLICATION_ID,
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
    journalMode: z.union(['wal', 'delete', 'truncate', 'persist'] as const).default('wal'),
    busyTimeoutMs: z.natural().default(1_000),
    defaultMaxResults: z.natural().default(DEFAULT_MAX_RESULTS),
    defaultDocumentPageSize: z.natural().min(1).default(DEFAULT_DOCUMENT_PAGE_SIZE),
    defaultMaxDocumentBytes: z.natural().min(1).default(DEFAULT_MAX_DOCUMENT_BYTES),
    defaultMaxDocumentTextChars: z.natural().min(1).default(DEFAULT_MAX_DOCUMENT_TEXT_CHARS),
  })

  private readonly resolved: ResolvedConfig
  private readonly catalog: GovernedCatalog<'knowledge_ref', KnowledgeBaseRow, KnowledgeCatalogEntry, UpstreamKnowledgeBase>

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
    this.catalog = new GovernedCatalog(ctx, this.resolved, {
      name,
      table: 'knowledge_base',
      sourceTable: 'knowledge_source',
      refColumn: 'knowledge_ref',
      resourceType: KNOWLEDGE_RESOURCE_TYPE,
      catalogResource: KNOWLEDGE_CATALOG_RESOURCE,
      syncAction: 'knowledge.catalog.sync',
      failureKey: 'knowledgeFailure',
      startsEnabled: true,
      listedColumns: [
        'description', 'kind', 'document_count', 'processing_count', 'embedding_model_id',
        'upstream_updated_at', 'upstream_created_at',
      ],
      applySchema,
      source: () => {
        const source = ctx.knowledgeSource
        return { sourceCode: source.sourceCode, providerKind: source.providerKind, list: () => source.list() }
      },
      describe: (base, source) => ({
        ref: formatKnowledgeRef({
          providerKind: source.providerKind, sourceCode: source.sourceCode, upstreamId: base.upstreamId,
        }),
        upstreamId: base.upstreamId,
        displayName: base.name,
        values: [
          base.description, base.kind, base.documentCount, base.processingCount, base.embeddingModelId,
          base.updatedAt ?? null, base.createdAt ?? null,
        ],
      }),
      failureReason: error => error instanceof KnowledgeError ? error.reason : 'upstream-invalid',
      unknownEntry: () => new KnowledgeError('not-allowed', 'no such knowledge base'),
      entry: toEntry,
    })
  }

  sync(orgId: OrgId): Promise<KnowledgeCatalogView> {
    return this.catalog.sync(orgId)
  }

  catalogView(orgId: OrgId): Promise<KnowledgeCatalogView> {
    return this.catalog.view(orgId)
  }

  setEnabled(orgId: OrgId, ref: KnowledgeRef, enabled: boolean): Promise<void> {
    return this.catalog.setEnabled(orgId, ref, enabled)
  }

  async directory(principal: KnowledgePrincipal): Promise<readonly KnowledgeBaseEntry[]> {
    const entries = await this.catalog.authorizedEntries(principal, SEARCH_ACTION)
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
    const row = await this.catalog.admit(request, request.ref, DOCUMENT_LIST_ACTION)
    if (row === undefined) {
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
    const row = parts === undefined ? undefined : await this.catalog.admit(request, parts.ref, DOCUMENT_READ_ACTION)
    if (parts === undefined || row === undefined) {
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
    const maxResults = request.maxResults ?? this.resolved.defaultMaxResults
    const byUpstream = new Map(scoped.map(row => [row.upstream_id, row]))
    let passages: readonly KnowledgePassage[]
    try {
      const answers = await this.searchByEmbeddingModel(scoped, request.signal, {
        ...(upstreamDocIds === undefined ? {} : { upstreamDocIds }),
        query: request.query,
        maxResults,
        ...(request.maxDocuments === undefined ? {} : { maxDocuments: request.maxDocuments }),
      })
      const upstream = request.maxDocuments === undefined
        ? interleave(answers).slice(0, maxResults)
        : interleave(answers.map(answer => documentRuns(answer))).slice(0, request.maxDocuments).flat()
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
      const authorized = new Set<string>((await this.catalog.authorizedEntries(request, SEARCH_ACTION)).map(entry => entry.ref))
      return this.catalog.rows(request.orgId).filter(row => authorized.has(row.knowledge_ref))
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
      const row = await this.catalog.admit(request, ref, SEARCH_ACTION)
      if (row === undefined) {
        await this.record({ ...request, resourceRef: ref }, 'denied', undefined, 'no-grant')
        throw new KnowledgeError('not-allowed', 'a knowledge base in scope is not available')
      }
      rows.push(row)
    }
    return rows
  }

  /**
   * Search the scoped knowledge bases with one upstream call per embedding model.
   *
   * One call may span several knowledge bases only when they share an embedding
   * model; a source declares no behavior for a mixed set, and WeKnora answers
   * one from a single base. Each answer keeps its source's order. Several
   * calls run together under one controller: the first failure aborts the
   * others, and this settles only after every call has.
   * @param rows - the authorized knowledge bases, never empty.
   * @param signal - the caller's cancellation.
   * @param search - the request fields every call shares.
   * @returns one answer per embedding model, in catalog order.
   */
  private async searchByEmbeddingModel(
    rows: readonly KnowledgeBaseRow[],
    signal: AbortSignal | undefined,
    search: Omit<UpstreamSearchRequest, 'upstreamIds' | 'signal'>,
  ): Promise<readonly (readonly UpstreamPassage[])[]> {
    const groups = new Map<string, string[]>()
    for (const row of rows) {
      const group = groups.get(row.embedding_model_id)
      if (group === undefined) groups.set(row.embedding_model_id, [row.upstream_id])
      else group.push(row.upstream_id)
    }
    const searchEach = (each: AbortSignal | undefined): Promise<readonly UpstreamPassage[]>[] =>
      [...groups.values()].map(upstreamIds => this.ctx.knowledgeSource.search({
        ...search,
        upstreamIds,
        ...(each === undefined ? {} : { signal: each }),
      }))
    if (groups.size === 1) return await Promise.all(searchEach(signal))
    const controller = new AbortController()
    const calls = searchEach(signal === undefined ? controller.signal : AbortSignal.any([controller.signal, signal]))
    try {
      return await Promise.all(calls)
    } catch (error) {
      controller.abort()
      await Promise.allSettled(calls)
      throw error
    }
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
    await this.catalog.record(principal, {
      action,
      outcome,
      resourceId: principal.resourceRef,
      reason,
      metadata: { itemCount, knowledgeFailure: failure },
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

/**
 * Alternate between ranked answers, taking each answer's next entry in turn.
 *
 * Scores from separate upstream calls are not comparable, because each call
 * ranks against its own candidates, so a merged answer keeps ranks instead:
 * every answer keeps its own order, and no answer's second entry precedes
 * another's first. A single answer comes back unchanged.
 * @param answers - ranked answers, in the order they take turns.
 * @returns the merged ranking.
 */
function interleave<T extends object>(answers: readonly (readonly T[])[]): T[] {
  const merged: T[] = []
  const longest = Math.max(0, ...answers.map(answer => answer.length))
  for (let rank = 0; rank < longest; rank += 1) {
    for (const answer of answers) {
      const entry = answer[rank]
      if (entry !== undefined) merged.push(entry)
    }
  }
  return merged
}

/**
 * Split one document-ranked answer into its documents, best first.
 *
 * A passage naming no document stands for its title inside its knowledge
 * base, as the source groups it.
 * @param answer - one document-ranked answer, grouped one document after another.
 * @returns each document's passages, in the answer's order.
 */
function documentRuns(answer: readonly UpstreamPassage[]): (readonly UpstreamPassage[])[] {
  const runs = new Map<string, UpstreamPassage[]>()
  for (const passage of answer) {
    const key = passage.upstreamDocId ?? `${passage.upstreamId}\u0000${passage.title}`
    const run = runs.get(key)
    if (run === undefined) runs.set(key, [passage])
    else run.push(passage)
  }
  return [...runs.values()]
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
