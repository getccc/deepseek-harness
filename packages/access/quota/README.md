---
description: "The quota Service Definition: hold a claim on an organization's budget before an upstream call, and settle it once for what actually happened."
kind: "package-reference"
---

# @deepseek-ai/dsh-quota

English | [中文](README.zh.md)

## Summary

`dsh-quota` is the budget ledger for company model calls. A caller reserves before it calls an upstream provider and settles once afterwards, and the whole design turns on one fact: a request can fail in a way that leaves nobody knowing whether the provider generated tokens. So a reservation is the ceiling on what a request can ever cost, a settlement is bounded by it, and the three settlement kinds keep "the provider reported this", "this was estimated", and "this was never charged" apart. Pair it with a backend such as [`quota-sqlite`](../quota-sqlite/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import '@deepseek-ai/dsh-quota'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId

const held = await ctx.quota.reserve({
  orgId, period: '2026-08', principalId,
  modelRef: 'deepseek-v4', inputTokens: 1_200, maxOutputTokens: 4_000,
})

// …call the upstream provider, then settle exactly once.
await ctx.quota.settle(held.id, { kind: 'reported', inputTokens: 1_200, outputTokens: 830 })
```

Settling the same reservation again returns the record that stands and changes no balance, so a caller that crashed after settling can retry.

### Which settlement to send

| Outcome | Settlement |
|---|---|
| The provider reported usage | `reported` with those numbers |
| The provider said it did not accept the request | `released` |
| Cancelled, or finished with no usage field, or the transport failed | `estimated` with the best numbers available |

`released` is the only outcome that returns the whole reservation, and it needs evidence the upstream refused. A transport failure with no response is not that evidence — the provider may have generated tokens nobody saw.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The reservation is the ceiling

It holds input plus the most output the request may produce, so every settlement is bounded by it. A provider reporting more than the request was allowed to produce, or an estimate that overshoots, is charged what was actually held — without that bound, an estimate is an invention.

### No limit means no ceiling

An organization an administrator has not limited is not silently limited to zero: `limitTokens` and `availableTokens` are absent rather than zero, so a caller cannot mistake "unlimited" for "exhausted".

### Periods are named by the caller

The seam does not know what a month is. A deployment names its periods and asks about the one a request belongs to, which keeps calendars, time zones, and billing cycles out of a ledger whose only job is arithmetic.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service, its failures, and `ctx.quota` |
| [`src/vocabulary.ts`](src/vocabulary.ts) | The refusal and settlement word lists |
| [`src/brand.ts`](src/brand.ts) | The reservation identity every settlement is idempotent on |
| [`src/types.ts`](src/types.ts) | Request, reservation, settlement, and usage shapes, types only |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`quota-sqlite`](../quota-sqlite/README.md) — the shipped backend and its reconciler.
- [Quota subsystem](../../../docs/subsystems/quota.md) — the settlement rules in full.
- [`access-control`](../access-control/README.md) — who may use a model, which this does not decide.

<a id="model-experience"></a>
## Model Experience

None, as the ledger is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **Tokens, not money** — weighting by price needs the price metadata the model catalog owns, and a ledger that guessed at a conversion would be wrong in a currency.
- **One limit per organization and period** — per-role and per-member ceilings are a second dimension the ledger does not carry yet.
- **Nothing here schedules the reconciler** — `reconcile` is a method a caller runs; when and how often is the gateway's decision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`released` is not an estimate of zero. It is the statement that nothing was spent, and collapsing the two would lose the distinction an invoice reconciliation needs — which is also why an expired reservation is settled rather than released.

</details>

**Runtime invariant:** No companion is published: the package declares an abstract service and two static word lists and mounts nothing; one settlement per reservation, never more than it held, belongs to the provider that keeps the ledger and its tests.
