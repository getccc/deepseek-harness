---
description: "SQLite-backed quota ledger: reservations, idempotent settlements, and the reconciler that closes the ones nobody settled."
kind: "package-reference"
---

# @deepseek-ai/dsh-quota-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-quota-sqlite` keeps the [quota ledger](../quota/README.md) in one SQLite database: budgets, the reservations that hold a claim, the settlements that answer them, and the reconciler that settles the ones nobody did. One settlement per reservation is a primary key rather than a rule in code, so nothing — service or not — can charge one request twice.

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

```yaml
plugins:
  '@deepseek-ai/dsh-quota-sqlite':
    path: ./quota.sqlite
    reservationTtlMs: 900000
```

`reservationTtlMs` bounds how long a crashed request can hold budget. It belongs above the slowest completion a deployment expects and nowhere near it: too low and a slow-but-live request is charged its ceiling while still running, too high and a crashed one holds budget for that long.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Idempotence is the schema

`settlement.reservation_id` is the primary key. A second settlement for one reservation cannot be inserted, so a caller retrying after a crash and a reconciler running beside it cannot both charge the same request. `settle` reads the existing record and returns it rather than writing.

### Balances are derived, never stored

Settled tokens sum the settlements; reserved tokens sum the reservations nothing has answered. A stored running total would be a second place for the truth to live, and the two would eventually disagree in a way only an audit could catch.

### The reconciler charges, and marks that it did

An expired reservation is settled at its full amount with `kind: 'estimated'` and `reconciled: true`. Releasing would let a crash loop spend without recording; the mark is what lets a later reader tell a charge nobody reported from one somebody did, and lets an invoice reconciliation credit the difference.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Reserve, settle, reconcile, and the derived standing |
| [`src/schema.ts`](src/schema.ts) | Tables, constraints, and the pragma guards |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`quota`](../quota/README.md) — the Service Definition and the settlement vocabulary.
- [Quota subsystem](../../../docs/subsystems/quota.md) — the settlement rules in full.
- [`audit-sqlite`](../audit-sqlite/README.md) — the sibling store, with the same schema-version and application-id handling.

<a id="model-experience"></a>
## Model Experience

None, as the ledger is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **Nothing prunes settled reservations** — the rows are the evidence that budget was held and what answered it, so a retention pass needs its own design rather than a `DELETE`.
- **`reconcile` scans by expiry, and a caller decides when to run it** — there is no schedule here, and none of this runs on its own.
- **A reconciled settlement charges the full reservation** — for a request that really did fail early, that overcharges; the `estimated` mark is what makes it findable, and this ledger deliberately does not try to correct it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests open a second connection and write raw SQL for the same reason the audit store's do: the claim is not that the service declines to settle twice, but that the database does.

</details>
