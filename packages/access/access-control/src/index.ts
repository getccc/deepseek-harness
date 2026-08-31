/**
 * The access-control seam: one service every company-resource entry and every
 * administrative operation asks before it acts.
 *
 * Evaluation is deliberately small. Default deny; a role's grants admit; several
 * roles union; a disabled resource is refused whatever any grant says. There is
 * no explicit deny, no role inheritance, and no expression language, so a
 * decision can be explained by naming the grants that produced it.
 * @module @deepseek-ai/dsh-access-control
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { GrantId, GroupId, ResourceId, RoleId } from './brand.ts'
import type {
  AccessDecision,
  AccessRequest,
  ManagedResource,
  Role,
  RoleGrant,
  RoleKind,
  UserGroup,
} from './types.ts'

export { GrantId, GroupId, ResourceId, RoleId } from './brand.ts'
export {
  GOVERNED_RESOURCE_TYPES,
  PERMISSION_CATALOG,
  isRegisteredPermission,
  type Permission,
} from './permissions.ts'
export type {
  AccessDecision,
  AccessReason,
  AccessRequest,
  ManagedResource,
  Role,
  RoleGrant,
  RoleKind,
  UserGroup,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    accessControl: AccessControl
  }
}

/** Raised when a grant names a pair the permission catalog does not govern. */
export class UnknownPermissionError extends Error {
  constructor(readonly resourceType: string, readonly action: string) {
    super(`no permission ${JSON.stringify(action)} on resource type ${JSON.stringify(resourceType)}`)
    this.name = 'UnknownPermissionError'
  }
}

/** Raised when an operation names a role the store does not hold. */
export class UnknownRoleError extends Error {
  constructor(readonly roleId: RoleId) {
    super(`unknown role ${roleId}`)
    this.name = 'UnknownRoleError'
  }
}

/** Raised when a role name is already taken inside its organization. */
export class DuplicateRoleNameError extends Error {
  constructor(readonly orgId: OrgId, readonly roleName: string) {
    super(`role ${JSON.stringify(roleName)} already exists in organization ${orgId}`)
    this.name = 'DuplicateRoleNameError'
  }
}

/** Raised when a role code is already taken inside its organization. */
export class DuplicateRoleCodeError extends Error {
  constructor(readonly orgId: OrgId, readonly code: string) {
    super(`role code ${JSON.stringify(code)} already exists in organization ${orgId}`)
    this.name = 'DuplicateRoleCodeError'
  }
}

/**
 * Raised when an operation would delete a role the product ships.
 *
 * A system role is what the deployment's own composition binds to; deleting it
 * would leave that composition naming nothing, and no administrator action can
 * put it back.
 */
export class SystemRoleError extends Error {
  constructor(readonly roleId: RoleId) {
    super(`role ${roleId} ships with the product and cannot be deleted`)
    this.name = 'SystemRoleError'
  }
}

/** The fields an administrator supplies when creating a role. */
export interface CreateRole {
  readonly orgId: OrgId
  readonly name: string
  /** Unique within the organization; defaults to the role's generated id. */
  readonly code?: string
  readonly description?: string
  /** Defaults to `custom`; only the product seeds `system` roles. */
  readonly kind?: RoleKind
}

/**
 * The role fields an administrator may change.
 *
 * The kind is not among them: whether a role ships with the product is a fact
 * about the build, not a setting. An absent field is left as stored.
 */
export interface UpdateRole {
  readonly name?: string
  readonly code?: string
  readonly description?: string
}

/** The fields the owning subsystem supplies when it governs a resource. */
export interface RegisterResource {
  readonly orgId: OrgId
  readonly type: string
  readonly externalRef: string
  readonly displayName: string
}

/**
 * Authorization and the records it reads. A provider mounts this service;
 * consumers inject `accessControl`.
 *
 * Every mutation that can change an outcome advances the organization's policy
 * revision, which is the value authorization caches key on, so a stale cache is
 * detectable rather than merely old.
 */
export abstract class AccessControl extends Service {
  constructor(ctx: Context) {
    super(ctx, 'accessControl')
  }

  /**
   * Decide one request.
   * @param request - who is asking, for what action, on which resource.
   * @returns the outcome, the revision it was computed against, and the grants that admitted it.
   */
  abstract authorize(request: AccessRequest): Promise<AccessDecision>

  /**
   * Create a role.
   * @param input - the role's organization, name, and optional description and kind.
   * @returns the stored role.
   * @throws {DuplicateRoleNameError} when the name is taken in that organization.
   */
  abstract createRole(input: CreateRole): Promise<Role>

  /**
   * Change a role's readable fields, leaving every field the caller did not
   * name as stored.
   * @param roleId - the role to change.
   * @param changes - the fields to write.
   * @throws {UnknownRoleError} when the store holds no such role.
   * @throws {DuplicateRoleNameError} when the new name is taken in that organization.
   * @throws {DuplicateRoleCodeError} when the new code is taken in that organization.
   */
  abstract updateRole(roleId: RoleId, changes: UpdateRole): Promise<void>

  /**
   * Delete one role, with the grants that compose it and the bindings that
   * carry it. Members holding it lose what it admitted at once.
   * @param roleId - the role to delete.
   * @throws {UnknownRoleError} when the store holds no such role.
   * @throws {SystemRoleError} when the role ships with the product.
   */
  abstract deleteRole(roleId: RoleId): Promise<void>

  /**
   * List an organization's roles in creation order.
   * @param orgId - the organization to list.
   * @returns every role the organization holds.
   */
  abstract listRoles(orgId: OrgId): Promise<Role[]>

  /**
   * List the permissions one role holds, with type grants before resource grants.
   * @param roleId - the role whose grants are read.
   * @returns every grant held by the role.
   * @throws {UnknownRoleError} when the store holds no such role.
   */
  abstract listRoleGrants(roleId: RoleId): Promise<RoleGrant[]>

  /**
   * Put a resource under governance, or update the display name of one already
   * governed. Idempotent on `(orgId, type, externalRef)`, because the owning
   * subsystem re-registers its catalog on every start.
   * @param input - the resource's organization, type, external ref, and display name.
   * @returns the stored resource.
   * @throws {UnknownPermissionError} when no permission governs that resource type.
   */
  abstract registerResource(input: RegisterResource): Promise<ManagedResource>

  /**
   * Enable or disable a governed resource. A disabled resource is refused for
   * every action, whatever any grant says.
   * @param id - the resource to change.
   * @param enabled - whether the resource may be used at all.
   */
  abstract setResourceEnabled(id: ResourceId, enabled: boolean): Promise<void>

  /**
   * List an organization's governed resources of one type, in creation order.
   * @param orgId - the organization to list.
   * @param type - the resource type to list.
   * @returns the governed resources of that type.
   */
  abstract listResources(orgId: OrgId, type: string): Promise<ManagedResource[]>

  /**
   * Let a role perform one action on every enabled resource of a type.
   * @param roleId - the role that gains the grant.
   * @param resourceType - the governed resource type.
   * @param action - the fully-qualified action.
   * @returns the grant's id, so a decision can name it.
   * @throws {UnknownPermissionError} when the catalog does not govern that pair.
   * @throws {UnknownRoleError} when the store holds no such role.
   */
  abstract grantType(roleId: RoleId, resourceType: string, action: string): Promise<GrantId>

  /**
   * Let a role perform one action on one named resource.
   * @param roleId - the role that gains the grant.
   * @param resourceId - the governed resource.
   * @param action - the fully-qualified action.
   * @returns the grant's id, so a decision can name it.
   * @throws {UnknownPermissionError} when the catalog does not govern the resource's type with that action.
   * @throws {UnknownRoleError} when the store holds no such role.
   */
  abstract grantResource(roleId: RoleId, resourceId: ResourceId, action: string): Promise<GrantId>

  /**
   * Withdraw a grant. Withdrawing one that is already absent is not an error:
   * the caller's intent is that it not be there.
   * @param grantId - the grant to withdraw.
   */
  abstract revokeGrant(grantId: GrantId): Promise<void>

  /**
   * Bind a role to one account. Binding an existing pair again changes nothing.
   * @param userId - the account that gains the role.
   * @param roleId - the role to bind.
   * @throws {UnknownRoleError} when the store holds no such role.
   */
  abstract bindUserRole(userId: UserId, roleId: RoleId): Promise<void>

  /**
   * Unbind a role from one account. Unbinding an absent pair is not an error.
   * @param userId - the account that loses the role.
   * @param roleId - the role to unbind.
   */
  abstract unbindUserRole(userId: UserId, roleId: RoleId): Promise<void>

  /**
   * Create a group, which binds roles to several accounts at once and changes
   * no part of how a request is evaluated.
   * @param orgId - the organization the group belongs to.
   * @param name - the group's name.
   * @returns the stored group.
   */
  abstract createGroup(orgId: OrgId, name: string): Promise<UserGroup>

  /**
   * Put an account in a group. Adding an existing member again changes nothing.
   * @param groupId - the group to add to.
   * @param userId - the account to add.
   */
  abstract addGroupMember(groupId: GroupId, userId: UserId): Promise<void>

  /**
   * Bind a role to every member of a group, present and future.
   * @param groupId - the group that gains the role.
   * @param roleId - the role to bind.
   * @throws {UnknownRoleError} when the store holds no such role.
   */
  abstract bindGroupRole(groupId: GroupId, roleId: RoleId): Promise<void>

  /**
   * Every role an account holds, directly or through a group, without repeats.
   * @param userId - the account to resolve.
   * @returns the role ids, in a stable order.
   */
  abstract rolesOf(userId: UserId): Promise<RoleId[]>
}
