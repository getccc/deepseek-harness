# Access control

English | [中文](access-control.zh.md)

Access control answers one question for every company resource and every administrative operation: may this principal perform this action on this resource? The subsystem is one seam — [`dsh-access-control`](../../packages/access/access-control) (`ctx.accessControl`) with the [`dsh-access-control-sqlite`](../../packages/access/access-control-sqlite) backend — and it is server-side only: the Control Plane composes it, no Runner mounts it, and models never see it. Design record: [access-control evaluation Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-access-control-evaluation.md).

## The evaluation is deliberately small

Default deny. The principal must exist in the organization and be active. A role's grants admit. Several roles union. A disabled resource is refused whatever any grant says.

Account status is checked on every decision, not only when a browser session is created. Suspending a member therefore refuses requests made with an access token issued earlier, even while its role bindings remain stored.

There is no explicit deny, no role inheritance, and no expression language. That is what lets a decision be explained by naming the grants that produced it, and what keeps "why was this refused?" answerable without replaying a policy engine.

An administrative role is not a master key: holding `member.create` grants nothing about models or knowledge, because every permission is granted explicitly.

## The permission catalog is closed

[`PERMISSION_CATALOG`](../../packages/access/access-control/src/permissions.ts) is seeded from code. Administrators compose roles out of its `(resourceType, action)` pairs; they cannot invent a permission string or upload policy code. A pair outside it is not a permission, so a typo fails where the grant is written rather than silently admitting or refusing when a request arrives.

The SQLite backend seeds the catalog into a table and points both grant tables at it with a foreign key, so a grant naming an ungoverned pair cannot be stored even by a caller that reached the database without passing the service.

## Resources are governed by reference

A grant names a resource id, never a URL or a credential. The catalog holds one row per model, MCP server, tool, knowledge scope, plugin, and skill an organization governs, keyed by `(organization, type, external ref)` — the identity a request names — with a surrogate id so a grant survives a display-name change. Registering is idempotent, because the owning subsystem re-registers its catalog on every start.

## Two grant shapes

A **type grant** lets a role perform one action on every enabled resource of a type, including resources governed after the grant was written. A **resource grant** names one resource. Both are `(role, action, target)` triples and nothing more; there is no condition to evaluate.

## Groups change no outcome

A group binds roles to several accounts at once. Evaluation unions direct and group-derived roles into one set, so a group is a convenience for administrators rather than a second kind of binding the algorithm has to know about. A role held both ways counts once.

## The policy revision

Every mutation that can change an outcome advances the organization's `policyRevision`, which lives with the organization in the [account store](account.md) so one counter serves every cache rather than each subsystem keeping its own. A decision quotes the revision it was computed against, which is what lets a cache tell stale from merely old. Creating a group binds no role and therefore does not advance it.

## Knowledge scopes

A knowledge request carries the scope it was allowed on, so a gateway can pass it downstream without a second lookup. Assembling a multi-scope assertion is the gateway's loop over its own authorized list, not a query here.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccesscontrol--accesscontrol-abstract-seam"></a>

### `ctx.accessControl` — `AccessControl` (abstract seam)

Authorization and the records it reads. A provider mounts this service; consumers inject `accessControl`.

Every mutation that can change an outcome advances the organization's policy revision, which is the value authorization caches key on, so a stale cache is detectable rather than merely old.

```ts cordis-catalog
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
 * Give one role every permission the catalog governs that it does not
 * already hold.
 *
 * Idempotent, and additive only: a pair the catalog no longer names stays
 * where it is, because the grant may still be the reason something works.
 * Callers run this for a role that covers the catalog as the process starts,
 * which is what keeps such a role current as this build's catalog grows.
 * @param roleId - the role to bring up to the catalog.
 * @returns the pairs this call granted, as `resourceType|action`.
 * @throws {UnknownRoleError} when the store holds no such role.
 */
abstract syncCatalogRole(roleId: RoleId): Promise<string[]>

/**
 * Every role of one organization that covers the catalog.
 * @param orgId - the organization to list.
 * @returns those roles, in creation order.
 */
abstract listCatalogRoles(orgId: OrgId): Promise<Role[]>

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
 * Stop governing a resource, taking every grant that names it with it.
 *
 * The grants go too because a resource id is not reused: leaving them would
 * keep rows pointing at nothing, and a resource later registered under the
 * same external ref takes a new id and starts with no access. Disabling a
 * resource is the reversible act; this one is for a resource its owning
 * subsystem no longer has.
 * @param id - the resource to stop governing.
 */
abstract deleteResource(id: ResourceId): Promise<void>

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
```

Types: [OrgId](account.md) · [UserId](account.md)

Source: [`packages/access/access-control/src/index.ts`](../../packages/access/access-control/src/index.ts)

<a id="ctxconsolemenu--consolemenustore-abstract-seam"></a>

### `ctx.consoleMenu` — `ConsoleMenuStore` (abstract seam)

The console's navigation, as durable records. A provider mounts this service; consumers inject `consoleMenu`.

```ts cordis-catalog
/**
 * Put the entries this build ships into an organization that does not have
 * them yet, matching on the shipped key.
 *
 * Idempotent, and never an overwrite: an entry a deployment renamed, hid, or
 * reordered keeps its edit, and one it deleted comes back at its shipped
 * settings on the next start. Entries this build retired are removed; their
 * children move to the retired entry's parent.
 * @param orgId - the organization to seed.
 * @returns how many entries this call inserted.
 */
abstract seedShipped(orgId: OrgId): Promise<number>

/**
 * List one organization's navigation, parents before the children that name
 * them, and siblings in `sortOrder` then creation order.
 * @param orgId - the organization to list.
 * @returns every entry the organization holds.
 */
abstract listMenus(orgId: OrgId): Promise<ConsoleMenu[]>

/**
 * Read one entry by id.
 * @param id - the entry to read.
 * @returns the entry, or undefined when the store holds none.
 */
abstract getMenu(id: MenuId): Promise<ConsoleMenu | undefined>

/**
 * Create one entry.
 * @param input - the entry's organization, name, kind, and optional placement fields.
 * @returns the stored entry.
 * @throws {UnknownMenuPermissionError} when it names a permission the catalog does not govern.
 */
abstract createMenu(input: CreateConsoleMenu): Promise<ConsoleMenu>

/**
 * Change an entry's fields, leaving every field the caller did not name as
 * stored. A rename drops the shipped copy key, because the words become the
 * organization's own.
 * @param id - the entry to change.
 * @param changes - the fields to write; `null` clears one, absence leaves it.
 * @throws {UnknownConsoleMenuError} when the store holds no such entry.
 * @throws {UnknownMenuPermissionError} when it names a permission the catalog does not govern.
 */
abstract updateMenu(id: MenuId, changes: UpdateConsoleMenu): Promise<void>

/**
 * Delete one entry.
 * @param id - the entry to delete.
 * @throws {UnknownConsoleMenuError} when the store holds no such entry.
 * @throws {ConsoleMenuNotEmptyError} when another entry still sits under it.
 */
abstract deleteMenu(id: MenuId): Promise<void>
```

Types: [OrgId](account.md)

Source: [`packages/team/team-console-menu/src/index.ts`](../../packages/team/team-console-menu/src/index.ts)
<!-- END GENERATED cordis-surface -->
