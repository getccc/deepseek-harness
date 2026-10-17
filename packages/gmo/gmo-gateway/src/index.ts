/**
 * The governed GMO gateway: the Control Plane service that stands between a
 * member's Runner and the GMO source, and the only party that decides which
 * categories a principal may reach.
 *
 * Two audiences, one owner. An administrator reads and curates the durable
 * category catalog; a Runner reads an authorized directory, lists one
 * category's results, describes one, and asks one a question. Both go through
 * here because the catalog and the authorization decision have to agree: a
 * directory that showed a category an operation would refuse, or the reverse,
 * would be worse than either alone.
 *
 * Authorization is asked on every operation rather than cached with a token,
 * so revoking a grant, disabling a category, suspending a member, or revoking
 * a device takes effect on the next call.
 * @module @deepseek-ai/dsh-gmo-gateway
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ResourceId } from '@deepseek-ai/dsh-access-control'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type {
  GmoAnswer,
  GmoCategoryEntry,
  GmoCategoryRef,
  GmoDescription,
  GmoQuery,
  GmoResultPage,
  GmoResultRef,
} from '@deepseek-ai/dsh-gmo'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gmoGateway: GmoGateway
  }
}

/**
 * The governed resource standing for the category catalog itself.
 *
 * The catalog is one thing an organization owns rather than one row per
 * category, so a grant to administer it is a grant over the catalog. It shares
 * the `gmo_category` resource type with the categories, which is why every
 * member-facing path enumerates the durable catalog and joins it to managed
 * resources rather than enumerating resources of that type: an `all`-mode
 * type grant on `gmo.query` would otherwise admit this.
 */
export const GMO_CATALOG_RESOURCE = 'urn:dsh:admin:gmo-catalog'

/** The resource type both the catalog and each category are governed as. */
export const GMO_RESOURCE_TYPE = 'gmo_category'

/** The permission every member-facing operation is evaluated against. */
export const GMO_QUERY_ACTION = 'gmo.query'

/** Whether a source answered, and when it last did. */
export type GmoSourceHealth = 'never-synced' | 'healthy' | 'failing'

/** How the configured source is doing, for an administrator reading the page. */
export interface GmoSourceStatus {
  /** The deployment's code for the source. */
  readonly sourceCode: string
  /** Which upstream product it is. */
  readonly providerKind: string
  readonly health: GmoSourceHealth
  /** Epoch milliseconds of the last attempt, or undefined before the first. */
  readonly lastAttemptAt: number | undefined
  /** Epoch milliseconds of the last success, or undefined before the first. */
  readonly lastSuccessAt: number | undefined
  /**
   * Why the last attempt failed, from the closed GMO failure set.
   *
   * A category rather than the upstream's own words: an operator diagnoses
   * the detail in the excel-tools deployment, not in a page members' work is
   * audited on.
   */
  readonly lastFailure: string | undefined
}

/** One catalog row as an administrator reads it. */
export interface GmoCatalogEntry {
  readonly ref: GmoCategoryRef
  /** The managed resource a role grant names, so a role editor can offer it. */
  readonly resourceId: ResourceId
  readonly displayName: string
  /** How many results the source reported when it last listed the category, or undefined when it did not say. */
  readonly resultCount: number | undefined
  /** Whether an administrator has switched this entry on. A newly discovered category starts off. */
  readonly adminEnabled: boolean
  /** Whether it can be analyzed at all: administrator-enabled and its governed resource enabled. */
  readonly effectiveEnabled: boolean
  /** Epoch milliseconds when a successful listing last named it. */
  readonly lastDiscoveredAt: number
}

/** What the administration page reads in one call. */
export interface GmoCatalogView {
  readonly source: GmoSourceStatus
  readonly entries: readonly GmoCatalogEntry[]
}

/**
 * Who is asking, recovered from a verified access token.
 *
 * Never from a request body: a caller that could name its own principal would
 * be authorizing itself.
 */
export interface GmoPrincipal {
  readonly orgId: OrgId
  readonly principalId: UserId
  /** The device the request arrived from, when one is bound to it. */
  readonly deviceId?: string
  /** Opaque correlation for the Session; never a local session id. */
  readonly correlationId?: string
}

/** One governed result listing: who is asking, which category, and which page. */
export interface GovernedResultsRequest extends GmoPrincipal {
  /** The category to list, authorized on this call. */
  readonly ref: GmoCategoryRef
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many results one page holds; the deployment's own size applies when absent. */
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

/** One governed description: who is asking and which result. */
export interface GovernedDescribeRequest extends GmoPrincipal {
  /** The result to describe; the category inside it is authorized on this call. */
  readonly resultRef: GmoResultRef
  readonly signal?: AbortSignal
}

/** One governed question: who is asking, which result, and what is asked. */
export interface GovernedAskRequest extends GmoPrincipal {
  /** The result to ask; the category inside it is authorized on this call. */
  readonly resultRef: GmoResultRef
  readonly query: GmoQuery
  readonly signal?: AbortSignal
}

/**
 * The governed catalog and the decision in front of it. A provider mounts this
 * service; consumers inject `gmoGateway`.
 *
 * Administration methods take an organization because an administrator has
 * already been authorized by the route that called them. Member-facing methods
 * take a principal because they authorize it themselves, per category, on
 * every call.
 */
export abstract class GmoGateway extends Service {
  constructor(ctx: Context) {
    super(ctx, 'gmoGateway')
  }

  /**
   * Reconcile the durable catalog against one successful full listing.
   *
   * Serialized: concurrent callers join the operation already in flight rather
   * than racing two reconciliations over the same rows. A source that does not
   * answer leaves the last successful snapshot in place and records the
   * failure, because one failed listing must not disable every category an
   * organization governs. A category the source newly lists starts disabled:
   * a role granted every category must not gain a business line the moment the
   * source starts serving it.
   * @param orgId - the organization whose catalog is reconciled.
   * @returns the catalog as it stands after the attempt, successful or not.
   */
  abstract sync(orgId: OrgId): Promise<GmoCatalogView>

  /**
   * Read the durable catalog without contacting the source.
   * @param orgId - the organization to read.
   * @returns every governed entry and the source's health.
   */
  abstract catalogView(orgId: OrgId): Promise<GmoCatalogView>

  /**
   * Switch one entry on or off for the whole organization.
   *
   * Synchronization never overrides this choice: an administrator who enabled
   * or disabled a category finds it still so after the next listing.
   * @param orgId - the organization the entry belongs to.
   * @param ref - the entry to change.
   * @param enabled - whether it may be analyzed at all.
   * @throws {GmoError} `not-allowed` when the catalog holds no such entry.
   */
  abstract setEnabled(orgId: OrgId, ref: GmoCategoryRef, enabled: boolean): Promise<void>

  /**
   * The categories this principal may analyze right now.
   * @param principal - who is asking, from a verified token.
   * @returns the authorized directory, empty when the principal holds nothing.
   */
  abstract directory(principal: GmoPrincipal): Promise<readonly GmoCategoryEntry[]>

  /**
   * Authorize one result listing and perform it.
   *
   * The category is evaluated on this call, as every other operation's is. A
   * member who may ask a category's results may see which results are in it:
   * the decision is the same permission, asked separately so it can be
   * tightened without a new authorization path.
   * @param request - who is asking, which category, and which page.
   * @returns the page, with results addressed by governed references.
   * @throws {GmoError} with the reason the operation was refused or failed.
   */
  abstract results(request: GovernedResultsRequest): Promise<GmoResultPage>

  /**
   * Authorize one description and perform it.
   *
   * Two things are proved before anything is read: the category the reference
   * names admits this principal now, and the source agrees that the result
   * belongs to that category. The second is what makes an unsigned reference
   * safe: a reference whose halves disagree is refused, and possession of one
   * is never authority.
   * @param request - who is asking and which result.
   * @returns the description, with references in place of upstream ids.
   * @throws {GmoError} with the reason the operation was refused or failed.
   */
  abstract describe(request: GovernedDescribeRequest): Promise<GmoDescription>

  /**
   * Authorize one question and perform it, on the same two proofs as
   * {@link describe}, and refuse an answer the source attributes to a
   * different category than the one authorized.
   * @param request - who is asking, which result, and the question.
   * @returns the source's bounded answer.
   * @throws {GmoError} with the reason the operation was refused or failed.
   */
  abstract ask(request: GovernedAskRequest): Promise<GmoAnswer>
}
