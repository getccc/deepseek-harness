# 团队 Handoff

[English](team-handoff.md) | 中文

Handoff 是成员从公司站点进入自己电脑上运行的应用的方式。三个包承载它：[`dsh-team-control-plane-http`](../../packages/team/team-control-plane-http) 提供 Control Plane 面向 Runner 的绑定端点，[`dsh-team-account-client`](../../packages/team/team-account-client)（`ctx.teamAccountClient`）在成员电脑上持有设备密钥与凭据，[`dsh-team-local-handoff`](../../packages/team/team-local-handoff) 提供浏览器所导航到的三个本地地址。设计记录：[团队 Handoff Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-the-handoff-is-navigation-not-a-tunnel.zh.md)。

## 什么会穿过网络，什么不会

成员的工作空间、Session、终端输出和 Diff 从不离开他们的电脑。Control Plane 看到的是一个公钥、一个平台词、一个 Runner 版本，以及它自己签发的凭据。Runner 收到的是一份属于它自己设备的 Refresh Token——绝不是公司 Provider 凭据。

站点是习惯性入口，不是检查点。直接打开本地地址的成员得到的是同一个应用，正是这一点让产品在 Control Plane 不可达时依然可用。

## 三个本地地址

| 路径 | 它做什么 |
|---|---|
| `/team/start` | 开启一个绑定 Transaction，并显示供比对的配对码 |
| `/team/open` | 日常入口：解锁、静默重新签发，或把成员送去绑定 |
| `/team/callback` | Control Plane 带着 Authorization Code 把浏览器送回来的地方 |

它们只能通过导航到达，别无他途：除非请求是顶层文档导航，否则每一个都回答 405。它们不携带 RPC、不读请求体、也够不到任何 Host 能力，因此守卫 `/api` 的浏览器信任栅栏在这里没有什么可守。

这些路径是固定的而非可配置的，因为 Control Plane 把它的重定向目标登记在它们之上——改名的部署会弄坏每一台已绑定的电脑。

## Callback 回答 200，而不是重定向

这一处必须完全正确，而显而易见的那个版本行不通。

本地会话 Cookie 是 `SameSite=Strict`。到达 `/team/callback` 的那次导航是由公司站点发起的，那是另一个站点。浏览器会对跨站导航链中的每一个请求扣下 Strict Cookie——包括重定向会产生的那个请求。设置 Cookie 再回答 303，会让浏览器**不带**它落在应用上，而应用回答 401。

因此 Callback 回答 200，同时带上 Cookie 和一个自己导航的页面。那次导航由本地文档发起，因而是同站的，Cookie 随它一同发送。页面使用 `location.replace`，并配有 `noscript` 刷新和一个可见链接，好让禁用脚本的成员照样能到达。

## 本地 state 把 Callback 绑到配对页

`/team/start` 铸出一个随机 state，把它放在 Control Plane 链接上，并留在本进程中。`/team/callback` 除非 state 匹配否则拒绝。正是这一点阻止了别人拼装的链接把这台电脑绑到他们的账户上。

它**不是**阻止重放的那一环——Control Plane 的 Authorization Code 是一次性的，那才是拒绝第二次携带它的 Callback 的东西。state 刻意在一次失败的完成后存活：在那里消费它，会把 Control Plane 的一时故障变成成员的一次彻底重来。

只活在本进程中是刻意的。在绑定中途重启的 Runner 会拒绝 Callback，而不是接受一个它无法与自己服务过的页面对上的 Callback。

## 再次进入，以及重新上锁

已经持有会话的浏览器会被直接重定向到应用，完全不与 Control Plane 往返。丢了会话但电脑仍处于绑定状态的浏览器，会在没有配对码的情况下重新拿到会话——这台电脑已经是这位成员的了。只有未绑定的电脑才会被送回 `/team/start`。

退出会忘掉凭据，保留设备密钥、工作空间和 Session：这台电脑还是同一台电脑，只是不再持有一个团队账户。

## 面向 Runner 的端点不接受会话

`POST /team/device/start`、`/redeem` 和 `/refresh` 由 Runner 能够证明的东西授权，而不是由谁登录了授权：一个 PKCE Verifier、一份设备签名、一个一次性 Code。开启一个 Transaction 既证明不了什么也学不到什么，这正是它什么都不需要的原因。

每一个请求体在[接缝](device-authorization.zh.md)看到它之前，都会被解析成接缝自己的请求。接缝的类型是它的调用方所许下的承诺，而一个经 HTTP 到达的调用方并未许下这样的承诺。

面向浏览器的另一半——读取一个待确认 Transaction 并确认它——需要一个 Control Plane 会话，属于 Team Shell。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamaccountclient--teamaccountclient"></a>

### `ctx.teamAccountClient` — `TeamAccountClient`

The team account as this computer holds it.

Binding is two steps with a person in between: `begin` opens a transaction and returns what the local pairing page shows, and `complete` runs only after the member confirmed on the Control Plane and the browser came back with a code.

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
 * Redeem the code the browser carried back, and keep the credential.
 * @param transactionId - the transaction the code belongs to.
 * @param code - the one-time authorization code.
 * @returns the state this installation is now in.
 * @throws {NotBoundError} when no transaction is awaiting confirmation in this process.
 * @throws {ControlPlaneRefusedError} when the Control Plane refused the redemption.
 */
async complete(transactionId: TransactionId, code: string): Promise<TeamAccountState>

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
