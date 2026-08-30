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

## 浏览器会话

一个 Control Plane 会话，是成员浏览器中的一个随机不透明 Token，加上这里保存的该 Token 的哈希。关于他们是谁的任何信息都不在 Cookie 中传递，因此被窃取的 Cookie 读不出内容，而一个结束了的会话立刻停止工作，不必等某个签名值恰好过期。

`resolveBrowserSession` 对被停用的账户不作任何回答。正是这一点让"停用一个成员"成为完整的一次行动：没有任何调用方需要记着同时结束他们的会话，而一个忘记了的调用方会留下一个仍然登录着的被停用成员。

## 顺序与身份

`listUsers` 按后端自身的行标识给出的插入顺序返回账户，而非依据 `createdAt`：同一毫秒签发的两个账户共享同一个时间戳，而时钟回拨会让它们的顺序出错。

`OrgId` 与 `UserId` 是品牌化字符串，因此组织 id 无法被传到需要账户 id 的位置。

## 认证：`ctx.accountAuth`

第二个接缝把登录名与密钥变成一个账户。[`dsh-account-auth`](../../packages/account/account-auth) 声明它；[`dsh-account-auth-password`](../../packages/account/account-auth-password) 对着已存哈希校验，并拥有由存储的计数器驱动的锁定策略。

它的失败不携带原因。登录名不存在、密钥错误、账户被锁、账户被停用，在这里是同一个结果，因此没有任何调用方能构造出「哪些登录名存在」的探针。该提供方还会在账户不存在时消耗与真实账户相当的算力——能测出这一差异的调用方，得到的正是那个原因字段本会告诉他的东西。

已存哈希是自描述的：它记录了产生自己的算法与全部参数，校验依据哈希自身的记载而非当前配置，而一次针对较弱参数的成功登录会按当前参数重新派生。这正是让一个账户在其持有者什么都不做的情况下，迁移到更强成本——或迁移到另一种算法——的机制。

## 消费方

访问控制把主体解析到组织并读取 `policyRevision`——每一次影响授权的变更都在变更自身所在的事务中递增它。它目前还不存在；这些接缝先落地，是因为它需要一个安放身份的地方。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccountauth--accountauth-abstract-seam"></a>

### `ctx.accountAuth` — `AccountAuth` (abstract seam)

Verifies who a member is. A provider mounts this service; consumers inject `accountAuth`.

```ts cordis-catalog
/**
 * Attempt a sign-in and record its effect on the account's sign-in state.
 *
 * Implementations take the same observable time whether or not the login
 * name exists: a caller that could time the difference could enumerate
 * accounts, which is the same leak the reasonless failure closes.
 * @param orgId - the organization the login name belongs to.
 * @param loginName - the name as typed.
 * @param secret - the secret as typed.
 * @returns the account on success, or a reasonless failure.
 */
abstract authenticate(orgId: OrgId, loginName: string, secret: string): Promise<AuthenticationOutcome>

/**
 * Set an account's secret, satisfying whatever the account still owed.
 * @param userId - the account whose secret is set.
 * @param secret - the new secret, in the clear; the provider stores only a derived form.
 * @throws {WeakSecretError} when the secret does not satisfy the deployment's policy.
 */
abstract setSecret(userId: UserId, secret: string): Promise<void>
```

Source: [`packages/account/account-auth/src/index.ts`](../../packages/account/account-auth/src/index.ts)

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
 * Change the organization's human-readable name.
 * @param id - the organization to change.
 * @param name - the new non-empty display name.
 * @throws {UnknownOrganizationError} when the store holds no such organization.
 */
abstract setOrganizationName(id: OrgId, name: string): Promise<void>

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

/**
 * Open a Control Plane browser session for one account.
 *
 * The caller hashes the token and keeps the plaintext; the store holds only
 * the hash, so reading the database yields nothing a browser could present.
 * @param userId - the account signing in.
 * @param tokenHash - the hash of the token the browser will carry.
 * @param expiresAt - when the session stops being honoured, in epoch milliseconds.
 */
abstract createBrowserSession(userId: UserId, tokenHash: string, expiresAt: number): Promise<void>

/**
 * Resolve a session token hash to the account it stands for.
 *
 * A suspended account holds no session. That is what makes suspending a
 * member the whole act: nothing has to remember to end their sessions too.
 * @param tokenHash - the hash of the token a browser presented.
 * @returns the session, or undefined when it is unknown, lapsed, or its account is suspended.
 */
abstract resolveBrowserSession(tokenHash: string): Promise<BrowserSessionRecord | undefined>

/**
 * End one session. Ending an absent session is not an error.
 * @param tokenHash - the hash of the token to forget.
 */
abstract revokeBrowserSession(tokenHash: string): Promise<void>
```

Source: [`packages/account/account-store/src/index.ts`](../../packages/account/account-store/src/index.ts)
<!-- END GENERATED cordis-surface -->
