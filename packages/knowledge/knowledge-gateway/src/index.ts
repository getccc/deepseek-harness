/**
 * The governed knowledge gateway: the Control Plane service that stands between
 * a member's Runner and a knowledge source, and the only party that decides
 * which knowledge bases a principal may reach.
 *
 * Two audiences, one owner. An administrator reads and curates the durable
 * catalog; a Runner reads an authorized directory and searches it. Both go
 * through here because the catalog and the authorization decision have to agree
 * — a directory that showed a knowledge base a search would refuse, or the
 * reverse, would be worse than either alone.
 *
 * Authorization is asked on every operation rather than cached with a token, so
 * revoking a grant, disabling a knowledge base, suspending a member, or
 * revoking a device takes effect on the next call.
 * @module @deepseek-ai/dsh-knowledge-gateway
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { ResourceId } from '@deepseek-ai/dsh-access-control'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type {
  KnowledgeBaseEntry,
  KnowledgeKind,
  KnowledgeRef,
  KnowledgeScopeSelection,
  KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeGateway: KnowledgeGateway
  }
}

/**
 * The governed resource standing for the knowledge catalog itself.
 *
 * The catalog is one thing an organization owns rather than one row per
 * knowledge base, so a grant to administer it is a grant over the catalog. It
 * shares the `knowledge_scope` resource type with the knowledge bases, which is
 * why every member-facing path enumerates the durable catalog and joins it to
 * managed resources rather than enumerating resources of that type: an
 * `all`-mode type grant on `knowledge.search` would otherwise admit this.
 */
export const KNOWLEDGE_CATALOG_RESOURCE = 'urn:dsh:admin:knowledge-catalog'

/** The resource type both the catalog and each knowledge base are governed as. */
export const KNOWLEDGE_RESOURCE_TYPE = 'knowledge_scope'

/** Whether a source answered, and when it last did. */
export type KnowledgeSourceHealth = 'never-synced' | 'healthy' | 'failing'

/** How the configured source is doing, for an administrator reading the page. */
export interface KnowledgeSourceStatus {
  /** The deployment's code for the source. */
  readonly sourceCode: string
  /** Which upstream product it is. */
  readonly providerKind: string
  readonly health: KnowledgeSourceHealth
  /** Epoch milliseconds of the last attempt, or undefined before the first. */
  readonly lastAttemptAt: number | undefined
  /** Epoch milliseconds of the last success, or undefined before the first. */
  readonly lastSuccessAt: number | undefined
  /**
   * Why the last attempt failed, from the closed knowledge failure set.
   *
   * A localized category rather than the upstream's own words: an operator
   * diagnoses the detail in the knowledge deployment's logs, not in a page
   * members' work is audited on.
   */
  readonly lastFailure: string | undefined
}

/** One catalog row as an administrator reads it. */
export interface KnowledgeCatalogEntry {
  readonly ref: KnowledgeRef
  /** The managed resource a role grant names, so a role editor can offer it. */
  readonly resourceId: ResourceId
  readonly displayName: string
  readonly description: string
  readonly kind: KnowledgeKind
  readonly documentCount: number
  readonly chunkCount: number
  readonly processingCount: number
  /**
   * Which embedding model indexes it.
   *
   * Read by the gateway before a multi-base search and shown on the
   * administration page, because a set that does not share one is refused and
   * an administrator otherwise cannot see why.
   */
  readonly embeddingModelId: string
  /** Whether an administrator has switched this entry on. */
  readonly adminEnabled: boolean
  /** Whether the last successful listing still held it. */
  readonly remotePresent: boolean
  /** Whether it can be searched at all: administrator-enabled and still upstream. */
  readonly effectiveEnabled: boolean
  /** Epoch milliseconds when a successful listing last named it. */
  readonly lastDiscoveredAt: number
  /** Epoch milliseconds the source reported, when it reports one. */
  readonly upstreamUpdatedAt: number | undefined
}

/** What the administration page reads in one call. */
export interface KnowledgeCatalogView {
  readonly source: KnowledgeSourceStatus
  readonly entries: readonly KnowledgeCatalogEntry[]
}

/**
 * Who is asking, recovered from a verified access token.
 *
 * Never from a request body: a caller that could name its own principal would
 * be authorizing itself.
 */
export interface KnowledgePrincipal {
  readonly orgId: OrgId
  readonly principalId: UserId
  /** The device the request arrived from, when one is bound to it. */
  readonly deviceId?: string
  /** Opaque correlation for the Session; never a local session id. */
  readonly correlationId?: string
}

/** One governed search: who is asking, what they scoped it to, and the query. */
export interface GovernedSearchRequest extends KnowledgePrincipal {
  /** The scope resolved from the Session, never widened here. */
  readonly scope: KnowledgeScopeSelection
  readonly query: string
  /** At most this many passages; the source's own maximum still applies. */
  readonly maxResults?: number
  readonly signal?: AbortSignal
}

/**
 * The governed catalog and the decision in front of it. A provider mounts this
 * service; consumers inject `knowledgeGateway`.
 *
 * Administration methods take an organization because an administrator has
 * already been authorized by the route that called them. Member-facing methods
 * take a principal because they authorize it themselves, per knowledge base,
 * on every call.
 */
export abstract class KnowledgeGateway extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledgeGateway')
  }

  /**
   * Reconcile the durable catalog against one successful full listing.
   *
   * Serialized: concurrent callers join the operation already in flight rather
   * than racing two reconciliations over the same rows. A source that does not
   * answer leaves the last successful snapshot in place and records the
   * failure, because one failed listing must not disable every knowledge base
   * an organization governs.
   * @param orgId - the organization whose catalog is reconciled.
   * @returns the catalog as it stands after the attempt, successful or not.
   */
  abstract sync(orgId: OrgId): Promise<KnowledgeCatalogView>

  /**
   * Read the durable catalog without contacting the source.
   * @param orgId - the organization to read.
   * @returns every governed entry and the source's health.
   */
  abstract catalogView(orgId: OrgId): Promise<KnowledgeCatalogView>

  /**
   * Switch one entry on or off for the whole organization.
   *
   * Synchronization never overrides this choice: an administrator who disabled
   * a knowledge base finds it still disabled after the next listing.
   * @param orgId - the organization the entry belongs to.
   * @param ref - the entry to change.
   * @param enabled - whether it may be searched at all.
   * @throws {KnowledgeError} `not-allowed` when the catalog holds no such entry.
   */
  abstract setEnabled(orgId: OrgId, ref: KnowledgeRef, enabled: boolean): Promise<void>

  /**
   * The knowledge bases this principal may search right now.
   * @param principal - who is asking, from a verified token.
   * @returns the authorized directory, empty when the principal holds nothing.
   */
  abstract directory(principal: KnowledgePrincipal): Promise<readonly KnowledgeBaseEntry[]>

  /**
   * Authorize one search and perform it.
   *
   * Every knowledge base the scope resolves to is evaluated before the source
   * is called, and one refusal fails the whole request: a partial result is
   * indistinguishable from a complete one to the model that reads it.
   * @param request - who is asking, the scope, the query, and the caller's bounds.
   * @returns the passages, with the knowledge bases actually searched.
   * @throws {KnowledgeError} with the reason the operation was refused or failed.
   */
  abstract search(request: GovernedSearchRequest): Promise<KnowledgeSearchResult>
}
