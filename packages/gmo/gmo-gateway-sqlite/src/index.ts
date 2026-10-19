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
 *
 * The catalog mechanics belong to `dsh-governed-catalog-sqlite`, shared with
 * the knowledge and BI gateways. This module supplies the category tables'
 * description and the three member operations.
 * @module @deepseek-ai/dsh-gmo-gateway-sqlite
 */

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
  type GovernedAskRequest,
  type GovernedDescribeRequest,
  type GovernedResultsRequest,
} from '@deepseek-ai/dsh-gmo-gateway'
import type { UpstreamCategory, UpstreamResult, UpstreamStage } from '@deepseek-ai/dsh-gmo-source'
import type {} from '@deepseek-ai/dsh-audit'
import { GovernedCatalog } from '@deepseek-ai/dsh-governed-catalog-sqlite'
import { applySchema, type CategoryRow } from './schema.ts'

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

  private readonly resolved: ResolvedConfig
  private readonly catalog: GovernedCatalog<'category_ref', CategoryRow, GmoCatalogEntry, UpstreamCategory>

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    // schemastery (Config) has already filled every defaulted field.
    this.resolved = config as ResolvedConfig
    this.catalog = new GovernedCatalog(ctx, this.resolved, {
      name,
      table: 'gmo_category',
      sourceTable: 'gmo_source',
      refColumn: 'category_ref',
      resourceType: GMO_RESOURCE_TYPE,
      catalogResource: GMO_CATALOG_RESOURCE,
      syncAction: 'gmo.catalog.sync',
      failureKey: 'gmoFailure',
      // A category seen for the first time starts switched off; a known one
      // keeps whatever an administrator chose.
      startsEnabled: false,
      listedColumns: ['result_count'],
      applySchema,
      source: () => {
        const source = ctx.gmoSource
        return { sourceCode: source.sourceCode, providerKind: source.providerKind, list: () => source.listCategories() }
      },
      describe: (category, source) => ({
        ref: formatGmoCategoryRef({
          providerKind: source.providerKind, sourceCode: source.sourceCode, upstreamId: category.upstreamId,
        }),
        upstreamId: category.upstreamId,
        displayName: category.name,
        values: [category.resultCount ?? null],
      }),
      failureReason: error => error instanceof GmoError ? error.reason : 'upstream-invalid',
      unknownEntry: () => new GmoError('not-allowed', 'no such category'),
      entry: toEntry,
    })
  }

  sync(orgId: OrgId): Promise<GmoCatalogView> {
    return this.catalog.sync(orgId)
  }

  catalogView(orgId: OrgId): Promise<GmoCatalogView> {
    return this.catalog.view(orgId)
  }

  setEnabled(orgId: OrgId, ref: GmoCategoryRef, enabled: boolean): Promise<void> {
    return this.catalog.setEnabled(orgId, ref, enabled)
  }

  async directory(principal: GmoPrincipal): Promise<readonly GmoCategoryEntry[]> {
    const entries = await this.catalog.authorizedEntries(principal, GMO_QUERY_ACTION)
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
    const row = await this.catalog.admit(principal, ref, GMO_QUERY_ACTION)
    if (row === undefined) {
      await this.record(principal, ref, action, 'denied', undefined, undefined, undefined, 'no-grant')
      throw new GmoError('not-allowed', 'that category is not available')
    }
    return row
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
    await this.catalog.record(principal, {
      action,
      outcome,
      resourceId: ref,
      reason,
      metadata: { queryKind, itemCount, gmoFailure: failure },
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
