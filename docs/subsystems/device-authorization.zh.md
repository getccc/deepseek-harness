# 设备授权

[English](device-authorization.md) | 中文

设备授权把成员的浏览器会话变成一台电脑上的长期凭据，且仅限那一台。本子系统是一个接缝——[`dsh-device-authorization`](../../packages/account/device-authorization)（`ctx.deviceAuthorization`）配合 [`dsh-device-authorization-sqlite`](../../packages/account/device-authorization-sqlite) 后端——且只存在于服务端：由 Control Plane 组合，任何 Runner 都不挂载它，模型也永远看不到它。设计记录：[设备绑定 Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-device-binding-proves-possession.zh.md)。

## 这套流程确立了什么

Runner 在首次启动时生成 Ed25519 密钥对，私钥留在那台电脑上。绑定分别证明三件事，三者缺一即拒绝：

1. **有成员批准了它。** 确认发生在 Control Plane 上、在一个已认证的会话中，组织和账户正是从那里来的。
2. **成员批准的是*这一台*电脑。** 他们在本地页面和 Control Plane 页面之间比对配对码与公钥摘要。
3. **这台电脑握有他们比对过的那把钥匙。** 兑换需要那份摘要背后的私钥签名。

在第 1 步之前，一个 Transaction 不属于任何账户，因此打开一个 Transaction 不会让未认证的调用方学到任何东西。

## 配对码是给人看的

`XXXX-XXXX`，字母表不含元音，也不含 `0`、`O`、`1`、`I`、`L`。不含元音意味着一个码拼不出让眼睛自动补全而不是逐字阅读的单词；被排除的那几对，正是在浏览器随手挑的字体里长得像的那几对。

它不需要独自抵抗猜测。确认本身已经要求一个已认证的 Control Plane 会话，而 Transaction 在数分钟内过期。

## Authorization Code 绑定它能绑定的一切

Code 只以哈希存放，且除非 PKCE Verifier 哈希后等于开启该 Transaction 的 Challenge、设备签名能用已存公钥验过、Callback 地址与协议版本与绑定时一致，否则兑换被拒。它的有效期由构建封顶在 60 秒：Code 只走一次重定向，更长的窗口买到的是攻击者的时间，而不是成员的任何东西。

被签名的字节同时指名 Transaction 和 Code，因此从一次兑换中截获的签名对另一次毫无用处。Code 本身不在被签串里——否则一份泄露的签名会顺带携带造出它的那个 Code。

## Refresh Token Family

兑换开启一个 Family 并铸出它的第一对 Refresh 与 Access Token。刷新消费一个 Refresh Token 并铸出下一个。

**出示一个已被消费的 Refresh Token 会吊销整个 Family。** 要么 Token 泄露了，要么 Runner 弄丢了它的记录，而这两者无法区分，因此都用同一种方式回答：让该 Family 中的每一份凭据失效——窃取者和正当持有者同样无法继续，而这个结果让成员别无选择，只能重新绑定。

## 撤销触及每一个 Family

撤销一台设备会吊销它曾经开启的每一个 Family，包括同一把钥匙更早那次绑定留下的。读取方只检查 Family，正是这一点让被撤销的设备拿不到 Token；两半是一次操作，原因就在这里。

用同一把钥匙重新绑定会保留同一行设备记录，而不是堆积出多个身份，因此管理员撤销一台电脑，撤销的就是那台电脑。

## Access Token 不携带授权

Token 说明的是哪个组织、哪个账户、哪台设备。它不携带角色、授权或 Scope。公司资源入口按请求发生时当前的[策略修订号](access-control.zh.md)对每次请求重新授权，因此角色变更立即生效，不必等某个 Token 过期。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdeviceauthorization--deviceauthorization-abstract-seam"></a>

### `ctx.deviceAuthorization` — `DeviceAuthorization` (abstract seam)

Device binding, the credentials it produces, and the device registry it fills. A provider mounts this service; consumers inject `deviceAuthorization`.

Nothing here authorizes anything: a credential proves which device and which account a request comes from, and access control decides what that principal may do, against the policy revision current at the time of the request.

```ts cordis-catalog
/**
 * Open a binding transaction. The request carries no account: a transaction
 * belongs to nobody until a member confirms it from an authenticated session,
 * so an unauthenticated caller learns nothing by opening one.
 * @param request - the device's public key, platform, PKCE challenge, and fixed callback.
 * @returns the transaction id, the pairing code to display locally, and when it lapses.
 */
abstract start(request: StartRequest): Promise<StartedTransaction>

/**
 * Read what a confirmation page must show before a person confirms.
 * @param id - the transaction the member's browser was sent to.
 * @returns the device facts and the pairing code to compare against the local page.
 * @throws {TransactionRefusedError} when it is unknown, lapsed, or already confirmed.
 */
abstract describe(id: TransactionId): Promise<PendingTransaction>

/**
 * Confirm a transaction, minting the one-time code the browser carries back.
 * @param id - the transaction being confirmed.
 * @param approval - who is confirming, from an authenticated Control Plane session.
 * @returns the plaintext code, its lifetime, and the bound callback address.
 * @throws {TransactionRefusedError} when it is unknown, lapsed, or already confirmed.
 */
abstract confirm(id: TransactionId, approval: Approval): Promise<IssuedCode>

/**
 * Turn an authorization code into a device and its first credential. The
 * device row is created here, because until this point no one has proved
 * possession of the private key behind the digest the member compared.
 * @param request - the code, the PKCE verifier, the device signature, and the bound callback and version.
 * @returns the device, its credential family, and the first refresh and access tokens.
 * @throws {CredentialRefusedError} when any bound fact fails to match.
 */
abstract redeem(request: RedeemRequest): Promise<IssuedCredential>

/**
 * Exchange a refresh token for the next one and a fresh access token.
 *
 * Presenting a refresh token that was already spent revokes the whole family:
 * either the token leaked or the Runner lost track of it, and both are
 * answered by making every credential in that family useless.
 * @param request - the family, the refresh token, and a device signature over both.
 * @returns the next credential pair.
 * @throws {CredentialRefusedError} when the token is unknown, lapsed, reused, or the device is revoked.
 */
abstract refresh(request: RefreshRequest): Promise<IssuedCredential>

/**
 * Resolve an access token to what it stands for.
 * @param token - the plaintext access token a Runner presented.
 * @returns the claims, or undefined when the token is unknown, lapsed, or its device is revoked.
 */
abstract verifyAccessToken(token: string): Promise<AccessTokenClaims | undefined>

/**
 * List an organization's devices in binding order.
 * @param orgId - the organization to list.
 * @returns every device the organization holds, revoked ones included.
 */
abstract listDevices(orgId: OrgId): Promise<Device[]>

/**
 * Revoke a device and every credential family it holds. Revoking one that is
 * already revoked is not an error: the caller's intent is that it be gone.
 * @param id - the device to revoke.
 */
abstract revokeDevice(id: DeviceId): Promise<void>

/**
 * Revoke one credential family, leaving the device able to bind again.
 * @param id - the family to revoke.
 */
abstract revokeFamily(id: FamilyId): Promise<void>
```

Types: [OrgId](account.zh.md)

Source: [`packages/account/device-authorization/src/index.ts`](../../packages/account/device-authorization/src/index.ts)
<!-- END GENERATED cordis-surface -->
