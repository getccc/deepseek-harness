# Quota

English | [中文](quota.zh.md)

Quota is the budget ledger for company model calls. The subsystem is one seam — [`dsh-quota`](../../packages/access/quota) (`ctx.quota`) with the [`dsh-quota-sqlite`](../../packages/access/quota-sqlite) backend — and it is server-side only: the Control Plane composes it, no Runner mounts it, and models never see it. Design record: [reservation and settlement Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-a-reservation-is-the-ceiling.md).

## The problem it is shaped around

Spending happens at an upstream provider this Control Plane does not control. Between deciding to call and knowing what the call cost, the provider may answer with usage, the member may cancel, the provider may refuse, or nobody may ever find out — the process crashes, the connection dies, the response arrives with no usage field.

A ledger with only "charge" and "do not charge" has to guess in most of those cases. Guessing low lets a crash loop spend an organization's budget without recording it. Guessing high charges members for work no provider performed.

## A reservation is the ceiling

A caller reserves the input tokens plus the most output the request may produce, before the upstream call. Every settlement is then bounded by it: a provider reporting more than the request was allowed to produce, or an estimate that overshoots, is charged what was actually held.

That bound is what makes an estimate defensible. Without it an estimate is an invention; with it, an estimate is at worst the amount the organization had already agreed to risk.

## A settlement happens once

The settlement table's primary key is the reservation, so a second settlement cannot be inserted. Settling an already-settled reservation returns the record that stands and changes no balance — which is what makes a caller safe to retry after a crash, and the reconciler safe to run beside it.

## Three kinds, because they answer different questions

| Kind | What it means | When |
|---|---|---|
| `reported` | The provider said this is what it used | An invoice can be reconciled against it |
| `estimated` | Charged without evidence, and marked | Cancelled, no usage field, or the transport failed |
| `released` | Never charged | The upstream said it did not accept the request |

`released` needs evidence that the upstream refused — a response the provider produced saying so. A transport failure with no response at all is not that evidence: the provider may have processed the prompt and generated tokens nobody saw. That case is `estimated`.

## An expired reservation is settled, not released

A request that ran past its window is far more likely to have spent the budget than to have spent nothing, and a reconciler that released would let a crash loop spend an unbounded amount while recording nothing. The reconciler charges the reservation and marks the record `reconciled`, so a later reader can tell a charge nobody reported from one somebody did.

`reservationTtlMs` bounds how long a crashed request can hold budget. It belongs above the slowest completion a deployment expects and nowhere near it.

## No limit means no ceiling

An organization an administrator has not limited is not silently limited to zero. `limitTokens` and `availableTokens` are absent rather than zero, so a caller cannot mistake "unlimited" for "exhausted".

## What the ledger does not decide

It does not decide who may use a model — that is [access control](access-control.md), asked separately on every request. It does not know what a month is: a deployment names its periods and the caller asks about the one a request belongs to.

It counts tokens, not money. Weighting by price needs the price metadata the model catalog owns, and a ledger that guessed at a conversion would be wrong in a currency.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [OrgId](account.md)

Source: [`packages/access/quota/src/index.ts`](../../packages/access/quota/src/index.ts)
<!-- END GENERATED cordis-surface -->
