/**
 * The governed BI gateway: the Control Plane service that stands between a
 * member's Runner and a BI source, and the only party that decides which
 * projects a principal may reach.
 *
 * Two audiences, one owner. An administrator reads and curates the durable
 * project catalog; a Runner reads an authorized directory, lists one
 * project's saved charts, and runs one of them. Both go through here because
 * the catalog and the authorization decision have to agree: a directory that
 * showed a project a run would refuse, or the reverse, would be worse than
 * either alone.
 *
 * Authorization is asked on every operation rather than cached with a token,
 * so revoking a grant, disabling a project, suspending a member, or revoking
 * a device takes effect on the next call.
 * @module @deepseek-ai/dsh-bi-gateway
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ResourceId } from '@deepseek-ai/dsh-access-control'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { BiChartPage, BiChartRef, BiProjectEntry, BiProjectRef, BiQueryResult } from '@deepseek-ai/dsh-bi'

declare module '@deepseek-ai/cordis' {
  interface Context {
    biGateway: BiGateway
  }
}

/**
 * The governed resource standing for the project catalog itself.
 *
 * The catalog is one thing an organization owns rather than one row per
 * project, so a grant to administer it is a grant over the catalog. It shares
 * the `bi_project` resource type with the projects, which is why every
 * member-facing path enumerates the durable catalog and joins it to managed
 * resources rather than enumerating resources of that type: an `all`-mode
 * type grant on `bi.query` would otherwise admit this.
 */
export const BI_CATALOG_RESOURCE = 'urn:dsh:admin:bi-catalog'

/** The resource type both the catalog and each project are governed as. */
export const BI_RESOURCE_TYPE = 'bi_project'

/** The permission every member-facing operation is evaluated against. */
export const BI_QUERY_ACTION = 'bi.query'

/** Whether a source answered, and when it last did. */
export type BiSourceHealth = 'never-synced' | 'healthy' | 'failing'

/** How the configured source is doing, for an administrator reading the page. */
export interface BiSourceStatus {
  /** The deployment's code for the source. */
  readonly sourceCode: string
  /** Which upstream product it is. */
  readonly providerKind: string
  readonly health: BiSourceHealth
  /** Epoch milliseconds of the last attempt, or undefined before the first. */
  readonly lastAttemptAt: number | undefined
  /** Epoch milliseconds of the last success, or undefined before the first. */
  readonly lastSuccessAt: number | undefined
  /**
   * Why the last attempt failed, from the closed BI failure set.
   *
   * A category rather than the upstream's own words: an operator diagnoses
   * the detail in the BI deployment's logs, not in a page members' work is
   * audited on.
   */
  readonly lastFailure: string | undefined
}

/** One catalog row as an administrator reads it. */
export interface BiCatalogEntry {
  readonly ref: BiProjectRef
  /** The managed resource a role grant names, so a role editor can offer it. */
  readonly resourceId: ResourceId
  readonly displayName: string
  /** The administrator's description of the project, empty when the source supplies none. */
  readonly description: string
  /** The source's own word for what kind of project it is, empty when it supplies none. */
  readonly projectType: string
  /** The source's own word for the warehouse behind it, empty when it supplies none. */
  readonly warehouseType: string
  /** Whether an administrator has switched this entry on. */
  readonly adminEnabled: boolean
  /** Whether it can be analyzed at all: administrator-enabled and its governed resource enabled. */
  readonly effectiveEnabled: boolean
  /** Epoch milliseconds when a successful listing last named it. */
  readonly lastDiscoveredAt: number
}

/** What the administration page reads in one call. */
export interface BiCatalogView {
  readonly source: BiSourceStatus
  readonly entries: readonly BiCatalogEntry[]
}

/**
 * Who is asking, recovered from a verified access token.
 *
 * Never from a request body: a caller that could name its own principal would
 * be authorizing itself.
 */
export interface BiPrincipal {
  readonly orgId: OrgId
  readonly principalId: UserId
  /** The device the request arrived from, when one is bound to it. */
  readonly deviceId?: string
  /** Opaque correlation for the Session; never a local session id. */
  readonly correlationId?: string
}

/** One governed chart listing: who is asking, which project, and which page. */
export interface GovernedChartsRequest extends BiPrincipal {
  /** The project to list, authorized on this call. */
  readonly ref: BiProjectRef
  /** Keep only charts whose name, space, or description holds this text, without regard to case. */
  readonly query?: string
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many charts one page holds; the deployment's own size applies when absent. */
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

/** One governed chart run: who is asking, which chart, and the row bound. */
export interface GovernedQueryRequest extends BiPrincipal {
  /** The chart to run; the project inside it is authorized on this call. */
  readonly chartRef: BiChartRef
  /** At most this many rows; the deployment's own bound applies when absent, and the source's still applies. */
  readonly limit?: number
  readonly signal?: AbortSignal
}

/**
 * The governed catalog and the decision in front of it. A provider mounts this
 * service; consumers inject `biGateway`.
 *
 * Administration methods take an organization because an administrator has
 * already been authorized by the route that called them. Member-facing methods
 * take a principal because they authorize it themselves, per project, on
 * every call.
 */
export abstract class BiGateway extends Service {
  constructor(ctx: Context) {
    super(ctx, 'biGateway')
  }

  /**
   * Reconcile the durable catalog against one successful full listing.
   *
   * Serialized: concurrent callers join the operation already in flight rather
   * than racing two reconciliations over the same rows. A source that does not
   * answer leaves the last successful snapshot in place and records the
   * failure, because one failed listing must not disable every project an
   * organization governs.
   * @param orgId - the organization whose catalog is reconciled.
   * @returns the catalog as it stands after the attempt, successful or not.
   */
  abstract sync(orgId: OrgId): Promise<BiCatalogView>

  /**
   * Read the durable catalog without contacting the source.
   * @param orgId - the organization to read.
   * @returns every governed entry and the source's health.
   */
  abstract catalogView(orgId: OrgId): Promise<BiCatalogView>

  /**
   * Switch one entry on or off for the whole organization.
   *
   * Synchronization never overrides this choice: an administrator who disabled
   * a project finds it still disabled after the next listing.
   * @param orgId - the organization the entry belongs to.
   * @param ref - the entry to change.
   * @param enabled - whether it may be analyzed at all.
   * @throws {BiError} `not-allowed` when the catalog holds no such entry.
   */
  abstract setEnabled(orgId: OrgId, ref: BiProjectRef, enabled: boolean): Promise<void>

  /**
   * The projects this principal may analyze right now.
   * @param principal - who is asking, from a verified token.
   * @returns the authorized directory, empty when the principal holds nothing.
   */
  abstract directory(principal: BiPrincipal): Promise<readonly BiProjectEntry[]>

  /**
   * Authorize one chart listing and perform it.
   *
   * The project is evaluated on this call, as a run's is. A member who may
   * run a project's charts may see which charts are in it: the decision is
   * the same permission, asked separately so it can be tightened without a
   * new authorization path.
   * @param request - who is asking, which project, a keyword, and which page.
   * @returns the page, with the charts addressed by governed references.
   * @throws {BiError} with the reason the operation was refused or failed.
   */
  abstract charts(request: GovernedChartsRequest): Promise<BiChartPage>

  /**
   * Authorize one chart run and perform it.
   *
   * Two things are proved before any row is read: the project the reference
   * names admits this principal now, and the source agrees that the chart
   * belongs to that project. The second is what makes an unsigned reference
   * safe: a reference whose halves disagree is refused, and possession of one
   * is never authority.
   * @param request - who is asking, which chart, and the caller's row bound.
   * @returns the chart's definition summary, its fields, and its bounded rows.
   * @throws {BiError} with the reason the operation was refused or failed.
   */
  abstract query(request: GovernedQueryRequest): Promise<BiQueryResult>
}
