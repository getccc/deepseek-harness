# 账户

[English](account.md) | 中文

账户就是「成员是谁」：在一个组织内唯一的登录名、显示名、状态，以及登录策略要读取的计数器。本子系统是一个接缝——[`dsh-account-store`](../../packages/account/account-store)（`ctx.accountStore`）配合 [`dsh-account-store-sqlite`](../../packages/account/account-store-sqlite) 后端——且只存在于服务端：由 Control Plane 组合，任何 Runner 都不挂载它，模型也永远看不到它（没有工具、没有提示词文本、没有会话事件）。设计记录：[账户存储接缝 Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-account-store-seam.zh.md)。

## 存储拥有什么，不拥有什么

该存储是一个仓储。它记录发生了什么、把冲突报告为具名失败，自身不做任何决定。连续五次失败是否意味着锁定、锁多久、编码后的密码哈希里装着什么，全都属于经它读写的认证提供方。

这一拆分是刻意的。认证材料只能经由 `getPasswordHash` 与 `setPasswordHash` 触及，绝不作为账户记录上的字段出现，且存储把该值当作不透明字节——不解析、不比较、不从中派生任何东西。因此把密码登录换成外部身份提供方，改变的是挂载了哪个提供方，而不是已存储的账户、角色和设备。

## 新签发的账户还不能登录

`createUser` 只存储身份：账户不携带任何认证材料，且 `mustChangePassword` 为真。管理员无法替成员创建一个可用账户，因为清除该标志的正是 `setPasswordHash`——成员自己选定密钥，是通往「已登录账户」的唯一路径。

## 登录状态

`recordFailedLogin` 返回连续失败次数；`lockUser` 拒绝登录直到调用方传入的时刻并重置计数，因此下一次锁定需要一轮全新的失败；`recordSuccessfulLogin` 清除两者并打上时间戳。这三者记录的，都是认证提供方已经做出的裁决。

## 顺序与身份

`listUsers` 按后端自身的行标识给出的插入顺序返回账户，而非依据 `createdAt`：同一毫秒签发的两个账户共享同一个时间戳，而时钟回拨会让它们的顺序出错。

`OrgId` 与 `UserId` 是品牌化字符串，因此组织 id 无法被传到需要账户 id 的位置。

## 消费方

认证提供方读写登录状态与密码材料。访问控制把主体解析到组织并读取 `policyRevision`——每一次影响授权的变更都在变更自身所在的事务中递增它。两者目前都还不存在；本接缝先落地，是因为它们都需要一个安放身份的地方。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccountstore--accountstore-abstract-seam"></a>

### `ctx.accountStore` — `AccountStore` (abstract seam)

Durable organizations and member accounts. Every method is a repository operation: it stores or returns records and reports conflicts, and it makes no policy decision of its own. A provider mounts this service; consumers inject `accountStore`.

```ts cordis-catalog
/**
 * Create the organization every other record hangs from.
 * @param name - human-readable organization name.
 * @returns the stored organization, at policy revision zero.
 */
abstract createOrganization(name: string): Promise<Organization>

/**
 * Read one organization.
 * @param id - the organization to read.
 * @returns the organization, or undefined when the store holds none.
 */
abstract getOrganization(id: OrgId): Promise<Organization | undefined>

/**
 * Advance an organization's policy revision, the value authorization caches
 * are keyed by. Callers increment it in the same transaction as the change
 * that invalidated them.
 * @param id - the organization whose revision advances.
 * @returns the revision after the increment.
 * @throws {UnknownOrganizationError} when the store holds no such organization.
 */
abstract bumpPolicyRevision(id: OrgId): Promise<bigint>

/**
 * Issue an account. The account starts active, with no password material and
 * `mustChangePassword` set, so an administrator cannot create a usable
 * account without the member choosing their own secret.
 * @param input - the identity fields an administrator supplies.
 * @returns the stored account.
 * @throws {DuplicateLoginNameError} when the login name is taken in that organization.
 */
abstract createUser(input: CreateAccountUser): Promise<AccountUser>

/**
 * Read one account by id.
 * @param id - the account to read.
 * @returns the account, or undefined when the store holds none.
 */
abstract getUser(id: UserId): Promise<AccountUser | undefined>

/**
 * Resolve a sign-in attempt's login name to an account.
 * @param orgId - the organization the login name belongs to.
 * @param loginName - the name as typed, compared exactly.
 * @returns the account, or undefined when no account carries that name.
 */
abstract findUserByLogin(orgId: OrgId, loginName: string): Promise<AccountUser | undefined>

/**
 * List an organization's accounts in creation order, oldest first.
 * @param orgId - the organization to list.
 * @returns every account the organization holds.
 */
abstract listUsers(orgId: OrgId): Promise<AccountUser[]>

/**
 * Set whether an account may authenticate.
 * @param id - the account to change.
 * @param status - the status to store.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract setUserStatus(id: UserId, status: AccountUserStatus): Promise<void>

/**
 * Read the authentication material an account carries, if any.
 *
 * Only the authentication provider calls this. The store treats the value as
 * opaque bytes: it never parses, compares, or derives anything from it, which
 * is what lets a different authentication provider replace the format without
 * touching stored identity.
 * @param id - the account whose material is read.
 * @returns the stored encoded hash, or undefined when the account has none.
 */
abstract getPasswordHash(id: UserId): Promise<string | undefined>

/**
 * Store the authentication material for an account and clear
 * `mustChangePassword`, because choosing a secret is what satisfies it.
 * @param id - the account to change.
 * @param encodedHash - the provider's own encoded hash, stored verbatim.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract setPasswordHash(id: UserId, encodedHash: string): Promise<void>

/**
 * Record one failed sign-in and return the resulting consecutive count. The
 * store counts; the authentication provider decides what a count means.
 * @param id - the account that failed to sign in.
 * @returns consecutive failures including this one.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract recordFailedLogin(id: UserId): Promise<number>

/**
 * Refuse sign-in until a moment in time, and reset the failure count so the
 * next lockout needs a fresh run of failures.
 * @param id - the account to lock.
 * @param until - epoch milliseconds after which sign-in may be attempted again.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract lockUser(id: UserId, until: number): Promise<void>

/**
 * Record a successful sign-in: clear the failure count and any lock, and
 * stamp the moment.
 * @param id - the account that signed in.
 * @param at - epoch milliseconds of the sign-in.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract recordSuccessfulLogin(id: UserId, at: number): Promise<void>
```

Source: [`packages/account/account-store/src/index.ts`](../../packages/account/account-store/src/index.ts)
<!-- END GENERATED cordis-surface -->
