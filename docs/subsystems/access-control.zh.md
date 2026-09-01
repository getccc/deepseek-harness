# 访问控制

[English](access-control.md) | 中文

访问控制为每一项公司资源和每一次管理操作回答同一个问题：这个主体可以对这个资源执行这个动作吗？本子系统是一个接缝——[`dsh-access-control`](../../packages/access/access-control)（`ctx.accessControl`）配合 [`dsh-access-control-sqlite`](../../packages/access/access-control-sqlite) 后端——且只存在于服务端：由 Control Plane 组合，任何 Runner 都不挂载它，模型也永远看不到它。设计记录：[访问控制求值 Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-access-control-evaluation.zh.md)。

## 求值刻意做得很小

默认拒绝。Principal 必须存在于该组织且处于活跃状态。角色的授权准入。多个角色取并集。被停用的资源无论任何授权怎么说都被拒绝。

账户状态在每次决定中检查，而不只在创建浏览器 Session 时检查。因此即使角色绑定仍存放着，停用成员也会拒绝其使用较早签发 Access Token 发起的请求。

没有显式 Deny、没有角色继承、没有表达式语言。正因如此，一个决定可以通过点名产生它的那些授权来解释，也正因如此，「这为什么被拒了？」无需重放一个策略引擎就能回答。

管理角色不是万能钥匙：持有 `member.create` 不会带来关于模型或知识库的任何权限，因为每一项权限都必须被显式授予。

## 权限目录是封闭的

[`PERMISSION_CATALOG`](../../packages/access/access-control/src/permissions.ts) 由代码播种。管理员用其中的 `(resourceType, action)` 组合出角色；他们无法凭空造出一个权限字符串，也无法上传策略代码。不在其中的组合不是权限，因此拼写错误会在写入授权处失败，而不是在请求到来时悄悄准入或拒绝。

SQLite 后端把该目录播种进一张表，并让两张授权表用外键指向它，因此即使某个调用方绕过服务直达数据库，指名未受治理组合的授权也存不进去。

## 资源按引用受治理

一条授权指名的是资源 id，绝不是 URL 或凭据。目录为组织所治理的每一个模型、MCP Server、Tool、知识库 Scope、插件和 Skill 各保存一行，按 `(组织, 类型, 外部引用)`——也就是请求所指名的身份——作键，并配一个代理 id，使授权在显示名变更后依然有效。注册是幂等的，因为拥有方子系统在每次启动时都会重新注册自己的目录。

## 两种授权形态

**类型授权**让一个角色对某类型下每一个启用的资源执行某个动作，包括在该授权写下之后才受治理的资源。**资源授权**只指名一个资源。两者都只是 `(角色, 动作, 目标)` 三元组，别无其他；没有任何条件需要求值。

## 用户组不改变任何结果

用户组把角色一次性绑定到多个账户。求值把直接角色与经组派生的角色并成一个集合，因此用户组是给管理员的便利，而不是算法必须知晓的第二种绑定。两种途径都持有的角色只计一次。

## 策略修订号

每一次可能改变结果的变更都会递增组织的 `policyRevision`，它随组织一同存放在[账户存储](account.zh.md)中，因此一个计数器服务于所有缓存，而不是每个子系统各留一个。一个决定会引用它据以计算的那个修订号，这正是让缓存能区分「陈旧」与「仅仅是旧」的依据。创建用户组不绑定任何角色，因此不会递增它。

## 知识库 Scope

知识库请求会携带它被准许的那个 scope，于是网关无需二次查询即可把它传给下游。组装多 scope 断言是网关对自己那份已授权清单的循环，不是此处的一次查询。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [OrgId](account.zh.md) · [UserId](account.zh.md)

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

Types: [OrgId](account.zh.md)

Source: [`packages/team/team-console-menu/src/index.ts`](../../packages/team/team-console-menu/src/index.ts)
<!-- END GENERATED cordis-surface -->
