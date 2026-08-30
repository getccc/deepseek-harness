# 配额

[English](quota.md) | 中文

配额是公司模型调用的预算账本。本子系统是一个接缝——[`dsh-quota`](../../packages/access/quota)（`ctx.quota`）配合 [`dsh-quota-sqlite`](../../packages/access/quota-sqlite) 后端——且只存在于服务端：由 Control Plane 组合，任何 Runner 都不挂载它，模型也永远看不到它。设计记录：[预留与结算 Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-a-reservation-is-the-ceiling.zh.md)。

## 它是围绕什么问题成形的

支出发生在这个 Control Plane 控制不了的上游 Provider 处。从"决定发起调用"到"知道这次调用花了多少"之间，Provider 可能带着 Usage 回答、成员可能取消、Provider 可能拒绝，也可能根本没人知道结果——进程崩了、连接断了、响应到了却没有 Usage 字段。

一个只有"计费"和"不计费"的账本，在其中大多数情况下只能猜。往低猜，会让崩溃循环花掉组织的预算却不留记录。往高猜，则是为没有任何 Provider 执行过的工作向成员收费。

## 预留就是上限

调用方在上游调用之前预留输入 Token 加上该请求可能产生的最多输出。此后每一次结算都被它封顶：Provider 报告的数量超过该请求被允许产生的量，或者估算值超出，都按实际持有的数额计费。

正是这个封顶让估算站得住脚。没有它，估算就是凭空发明；有了它，估算最差也不过是组织早已同意去承担的那个数额。

## 结算只发生一次

结算表的主键就是 Reservation，因此第二条结算插不进去。对一个已结算的 Reservation 再次结算，返回的是既有记录且不改变任何余额——正是这一点让调用方在崩溃后重试是安全的，也让 Reconciler 与它并行运行是安全的。

## 三种类型，因为它们回答不同的问题

| 类型 | 它的含义 | 何时使用 |
|---|---|---|
| `reported` | Provider 说它用了这么多 | 账单可以据此对账 |
| `estimated` | 在没有证据的情况下计费，并被标记 | 被取消、没有 Usage 字段，或传输失败 |
| `released` | 从未被收费 | 上游表示它没有接受该请求 |

`released` 需要上游拒绝了该请求的证据——也就是 Provider 自己产出的、说明这一点的响应。一次完全没有响应的传输失败不是那种证据：Provider 可能已经处理了 Prompt 并生成了没人看到的 Token。那种情况属于 `estimated`。

## 过期的 Reservation 被结算，而不是被释放

一个跑过了自己窗口的请求，花掉了预算的可能性远大于什么都没花，而一个会释放的 Reconciler 会让崩溃循环无上限地花费却什么也不记录。Reconciler 按预留额计费并把记录标记为 `reconciled`，于是日后的读者能区分"没人报告过的一笔计费"和"有人报告过的一笔"。

`reservationTtlMs` 限定一个崩溃的请求最长能占住多久预算。它应当高于部署所预期的最慢一次完成，且不能贴着它。

## 没有限额就没有上限

一个管理员没有设限的组织不会被悄悄限制为零。`limitTokens` 和 `availableTokens` 是缺席而不是零，因此调用方不会把"无限"误当成"已耗尽"。

## 这个账本不决定什么

它不决定谁可以使用某个模型——那是[访问控制](access-control.zh.md)，在每一次请求上被单独询问。它也不知道"一个月"是什么：由部署为自己的周期命名，调用方询问某个请求所属的那一个。

它计的是 Token，不是钱。按价格加权需要模型目录所拥有的价格元数据，而一个凭空猜出换算关系的账本，会以货币为单位地出错。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxquota--quota-abstract-seam"></a>

### `ctx.quota` — `Quota` (abstract seam)

The budget ledger. A provider mounts this service; consumers inject `quota`.

Nothing here decides who may use a model — access control does. This decides only whether there is budget left, and records what a request spent.

```ts cordis-catalog
/**
 * Set what an organization may spend in one period. Setting it again
 * replaces the limit and changes nothing already settled or reserved.
 * @param orgId - the organization to limit.
 * @param period - the period the limit applies to.
 * @param limitTokens - the ceiling, or undefined to remove the limit.
 */
abstract setLimit(orgId: OrgId, period: PeriodKey, limitTokens: number | undefined): Promise<void>

/**
 * Hold a claim on the budget before calling an upstream provider.
 *
 * The claim is the input tokens plus the most output the request may
 * produce, so a reservation is the ceiling on what this request can ever
 * cost. That is what lets a later estimate be bounded rather than invented.
 * @param request - who is asking, for which model, and for how much.
 * @returns the held reservation.
 * @throws {ReservationRefusedError} when the budget cannot cover it, or the request is malformed.
 */
abstract reserve(request: ReservationRequest): Promise<Reservation>

/**
 * Settle a reservation once, for what actually happened.
 *
 * Settling the same reservation again returns the settlement already
 * recorded and changes no balance. That is what makes a caller safe to retry
 * after a crash, and what makes the reconciler safe to run beside it.
 * @param id - the reservation being settled.
 * @param settlement - what the provider reported, what is estimated, or a release.
 * @returns the settlement of record, which may predate this call.
 * @throws {UnknownReservationError} when the ledger holds no such reservation.
 */
abstract settle(id: ReservationId, settlement: Settlement): Promise<SettlementRecord>

/**
 * Settle every reservation whose lifetime has run out.
 *
 * They are settled, not released: a request that ran past its window is far
 * more likely to have spent the budget than to have spent nothing, and a
 * ledger that released them would let a crash loop spend without recording.
 * @param now - the moment to reconcile against, in epoch milliseconds.
 * @returns the settlements written, in reservation order.
 */
abstract reconcile(now: number): Promise<SettlementRecord[]>

/**
 * What an organization has spent and holds in one period.
 * @param orgId - the organization to report on.
 * @param period - the period to report on.
 * @returns the limit, what is settled, what is reserved, and what remains.
 */
abstract usage(orgId: OrgId, period: PeriodKey): Promise<QuotaUsage>
```

Types: [OrgId](account.zh.md)

Source: [`packages/access/quota/src/index.ts`](../../packages/access/quota/src/index.ts)
<!-- END GENERATED cordis-surface -->
