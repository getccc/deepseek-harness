/**
 * Access-control vocabulary shared by every provider and consumer.
 * @module @deepseek-ai/dsh-access-control/types
 */

import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { GrantId, GroupId, ResourceId, RoleId } from './brand.ts'

/** Whether a role ships with the product or an administrator created it. */
export type RoleKind = 'system' | 'custom'

/** One role: a named bundle of grants an administrator binds to people. */
export interface Role {
  readonly id: RoleId
  readonly orgId: OrgId
  /** Unique within the organization. */
  readonly name: string
  /**
   * A stable identifier an administrator chooses, unique within the
   * organization. It is what a deployment's own configuration names a role by,
   * so renaming the role for a reader does not break what refers to it.
   */
  readonly code: string
  readonly description: string
  /** A system role ships with the product and cannot be deleted. */
  readonly kind: RoleKind
  /**
   * Whether this role holds every permission this build governs.
   *
   * The grants are real rows, not a wildcard: the role is brought up to the
   * catalog as the Control Plane starts, so a build that adds a permission adds
   * it here too and a decision can still be explained by naming the grant that
   * produced it. A role without this never gains a permission it was not given.
   */
  readonly coversCatalog: boolean
  /**
   * When the role was created, in epoch milliseconds, or undefined for a role
   * a build before this one stored without recording the moment.
   */
  readonly createdAt: number | undefined
}

/** One user group: a way to bind roles in bulk, with no effect on evaluation. */
export interface UserGroup {
  readonly id: GroupId
  readonly orgId: OrgId
  readonly name: string
}

/**
 * One governed resource. The catalog holds a row per model, MCP server, tool,
 * knowledge scope, plugin, and skill an organization governs, so a grant can
 * name one by id rather than carrying its URL or credentials.
 */
export interface ManagedResource {
  readonly id: ResourceId
  readonly orgId: OrgId
  /** A resource type the permission catalog governs. */
  readonly type: string
  /** The owning subsystem's own stable identifier, such as a model ref. */
  readonly externalRef: string
  readonly displayName: string
  /** A disabled resource is refused for every action, whatever any grant says. */
  readonly enabled: boolean
}

/** One permission a role holds across a resource type or on one resource. */
export type RoleGrant =
  | {
    readonly id: GrantId
    readonly roleId: RoleId
    readonly kind: 'type'
    readonly resourceType: string
    readonly action: string
  }
  | {
    readonly id: GrantId
    readonly roleId: RoleId
    readonly kind: 'resource'
    readonly resourceId: ResourceId
    readonly resourceType: string
    readonly resourceDisplayName: string
    readonly action: string
  }

/** What a caller asks the access-control service. */
export interface AccessRequest {
  readonly orgId: OrgId
  /** The account the request acts as, recovered from an authenticated token. */
  readonly principalId: UserId
  /** The device the request arrived from, when one is bound to it. */
  readonly deviceId?: string
  /** A fully-qualified action from the permission catalog. */
  readonly action: string
  /** The resource type that action governs. */
  readonly resourceType: string
  /** The owning subsystem's identifier for the resource, as {@link ManagedResource.externalRef}. */
  readonly resourceId: string
  readonly context?: {
    /** Opaque correlation for the session the request belongs to; never a local session id. */
    readonly sessionCorrelationId?: string
  }
}

/**
 * Why a request was admitted or refused.
 *
 * `no-grant` covers both "no grant admits this" and "no such resource", so a
 * refusal never confirms that a resource exists to a principal who holds
 * nothing on it. `resource-disabled` is the deliberate exception: it answers a
 * principal who does hold a grant, and telling them the resource is switched
 * off is the difference between a useful message and a confusing one.
 */
export type AccessReason =
  | 'allowed'
  | 'default-deny'
  | 'resource-disabled'
  | 'no-grant'

/** What the access-control service answers. */
export interface AccessDecision {
  readonly allowed: boolean
  /** The organization's policy revision this decision was computed against. */
  readonly policyRevision: bigint
  /** Every grant that admitted the request, empty when it was refused. */
  readonly matchedGrantIds: readonly GrantId[]
  /**
   * Knowledge scopes the principal holds for this resource, for a gateway to
   * pass to a backend that filters by them. Empty for every other resource type.
   */
  readonly scopes: readonly string[]
  readonly reason: AccessReason
}
