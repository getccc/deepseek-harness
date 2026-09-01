# 团队登录

[English](team-handoff.md) | 中文

普通成员在 3090 端口的 Team Runner 登录，管理员使用 3095 端口的 Control Plane。默认流程不会把成员浏览器导航到 Control Plane：[`dsh-team-local-login`](../../packages/team/team-local-login) 拥有本地账户表单，[`dsh-team-account-client`](../../packages/team/team-account-client) 拥有设备密钥与凭据，[`dsh-team-control-plane-http`](../../packages/team/team-control-plane-http) 负责认证账户并签发设备绑定凭据。设计记录：[Team Runner 成员登录 Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-team-runner-owns-member-sign-in.zh.md)。

## 两个浏览器表层面向不同人群

| 地址 | 用户 | 用途 |
|---|---|---|
| `http://127.0.0.1:3090/team/open` | 普通成员 | 本地登录与 Runner 应用 |
| `https://control-plane.example/team/admin/` | 管理员 | 账户、角色、授权、设备、审计与公司资源 |

独立 `dsh web` 仍在 3080 端口使用进程 Token 解锁。Team 不复用这条捷径：它的 Web Runtime 打开干净的 `/team/open` 路径，并把未解锁的浏览器重定向到 `/team/login`。

应用授权不能代替部署隔离。生产部署应只通过管理员网络或反向代理暴露 3095，并在那里终止 TLS。

## 一次本地登录生成一份设备凭据

1. Runner 开启一个设备 Transaction，并把 PKCE Verifier 留在内存中。
2. 本地表单把账户与密码交给 Runner。Runner 将它们连同 Transaction 转发给配置好的 Control Plane 源。
3. Control Plane 验证活跃账户，记录认证事件，并用该审计引用批准 Transaction。
4. Runner 使用 PKCE Verifier 和设备密钥签名兑换一次性 Code。
5. Runner 通过 Credential Provider 存储 Refresh Token 与 Access Token，随后由本地浏览器会话服务解锁应用。

密码不会存储在 Runner 上，但会经过 Runner 到 Control Plane 的连接，因此除本地开发外必须使用 TLS。公司 Provider 凭据绝不会反向到达 Runner；Runner 收到的只有自己的设备凭据。

同一设备密钥后续登录成功时，会先撤销该设备较早的凭据族，再签发替代凭据。一个 Runner 进程只持有一个活跃团队账户；再次登录会改变使用该进程的所有浏览器所对应的账户。

## 三条固定本地路由

| 路径 | 它做什么 |
|---|---|
| `/team/open` | 已通过本地认证的浏览器进入应用，否则重定向到登录 |
| `/team/login` | 提供并接受账户密码表单 |
| `/team/logout` | 忘掉团队凭据，再把本地 Cookie 清理由 `/lock` 完成 |

`/team/open` 不会根据已存团队凭据静默铸造浏览器 Session。新浏览器或已上锁的浏览器必须认证，这可以阻止共享电脑上的第二个浏览器仅通过打开端口就继承进程账户。

登录表单要求精确同源提交，接受有大小上限的 URL 编码请求体，并让密码错误、账户不存在、锁定和停用得到同一个拒绝。该页面由服务端渲染，因为本地 Session 建立前还无法加载应用资产。

## Control Plane 仅供管理员使用

管理 API 在创建浏览器 Session 前会同时验证密码与 `organization.admin.access`。之后每次请求都会重新检查该入口权限，再检查 `member.disable` 或 `model.catalog.manage` 等具体动作授权。因此即使浏览器仍带着 Session Cookie，移除入口授权也会终止控制台访问。

默认 Control Plane Bundle 不组合 `team-shell` 或任何成员确认页。部署需要把同一个 `organizationId` 提供给负责成员认证的 `team-control-plane-http` 与负责管理的 `team-admin-api`；两行都不会猜测该值，缺失时直接失败。

## 停用状态在访问决策处检查

访问控制会在评估角色与授权前，要求 Principal 存在于请求所指组织且状态为 `active`。即使较早的设备 Access Token 与角色绑定仍然存在，已停用账户也会得到 `default-deny`。因此网关会立即停止准入公司资源使用，而不是等待 Token 过期。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamaccountclient--teamaccountclient"></a>

### `ctx.teamAccountClient` — `TeamAccountClient`

The team account as this computer holds it.

The default `signIn` flow authenticates the Runner-local form through the Control Plane and binds the device without navigating there. `begin` and `complete` retain the two-step mechanism used by an optional browser handoff.

```ts cordis-catalog
/**
 * Open a binding transaction and return what the local pairing page shows.
 *
 * The PKCE verifier stays in this process: it is written nowhere, so a
 * transaction cannot be completed by anything that reads this computer's
 * disk without also being this Runner.
 * @returns the pairing code to display, the Control Plane address to send the member to, and the transaction id.
 */
async begin(): Promise<BindingHandle>

/**
 * Authenticate a member and bind this Runner without opening the Control Plane in a browser.
 * @param loginName - the organization-local account name typed on the Runner.
 * @param secret - the account password typed on the Runner.
 * @returns the state this installation is now in.
 * @throws {ControlPlaneRefusedError} when authentication or binding is refused.
 */
async signIn(loginName: string, secret: string): Promise<TeamAccountState>

/**
 * Redeem the code the browser carried back, and keep the credential.
 * @param transactionId - the transaction the code belongs to.
 * @param code - the one-time authorization code.
 * @param member - authenticated member identity returned by a local sign-in.
 * @returns the state this installation is now in.
 * @throws {NotBoundError} when no transaction is awaiting confirmation in this process.
 * @throws {ControlPlaneRefusedError} when the Control Plane refused the redemption.
 */
async complete( transactionId: TransactionId, code: string, member?: TeamMemberIdentity, ): Promise<TeamAccountState>

/**
 * What this installation currently holds.
 * @returns whether it is bound, and to which device and family.
 */
async state(): Promise<TeamAccountState>

/**
 * An access token that will still be valid when it arrives, refreshing first
 * when the stored one is close enough to lapsing to lose the race.
 * @returns the access token to present to a company-resource entry.
 * @throws {NotBoundError} when this computer holds no credential.
 * @throws {ControlPlaneRefusedError} when the refresh was refused, including after a replay revoked the family.
 */
async accessToken(): Promise<string>

/**
 * Forget the team credential, keeping the device key, the workspaces, and the
 * sessions. The computer stays the same computer; it just stops holding a
 * team account.
 */
async signOut(): Promise<void>
```

Types: [TransactionId](device-authorization.zh.md)

Source: [`packages/team/team-account-client/src/index.ts`](../../packages/team/team-account-client/src/index.ts)
<!-- END GENERATED cordis-surface -->
