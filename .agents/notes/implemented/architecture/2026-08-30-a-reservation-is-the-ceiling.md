# Agent Note: a reservation is the ceiling, and a settlement happens once

Status: implemented

English | [中文](2026-08-30-a-reservation-is-the-ceiling.zh.md)

## Problem

A company model call spends money that belongs to the organization, and the spending happens at an upstream provider this Control Plane does not control. Between deciding to call and knowing what the call cost, four things can happen: the provider answers with usage, the member cancels, the provider refuses, or nobody ever finds out — the process crashes, the connection dies, the response arrives without a usage field.

A ledger with only "charge" and "do not charge" has to guess in most of those cases, and whichever way it guesses is wrong somewhere. Guessing low lets a crash loop spend an organization's budget without recording that it did. Guessing high charges members for work no provider performed.

There is a sharper version underneath. Two things settle the same request — the caller when it finishes, and a reconciler when the request ran too long — and they can both be right about a request neither of them can see the end of. If they can both write, one request is charged twice.

## Decision

**A reservation is the ceiling on what a request can ever cost.** It holds the input tokens plus the most output the request may produce, taken before the upstream call. Every settlement is then bounded by it: a provider reporting more than the request was allowed to produce, or an estimate that overshoots, is charged what was actually held. Without that bound, an estimate is an invention; with it, an estimate is at worst the amount the organization had already agreed to risk.

**A settlement happens once, and the database is what says so.** The settlement table's primary key is the reservation, so a second settlement cannot be inserted. Settling an already-settled reservation returns the record that stands and changes no balance — which is what makes a caller safe to retry after a crash, and the reconciler safe to run beside it.

**Three settlement kinds, because they answer different questions later.** `reported` is what an invoice can be reconciled against. `estimated` is what was charged without evidence, marked so that reconciliation can find it. `released` is what the organization was never charged for, and it is the only outcome that returns the whole reservation.

**`released` requires evidence that the upstream refused the request.** A response the provider produced saying so — a status with no content generated. A transport failure with no response at all is *not* evidence of refusal: the provider may have processed the prompt and generated tokens that nobody saw. That case is `estimated`, which is the design's "indeterminate" path.

**An expired reservation is settled, not released.** A request that ran past its window is far more likely to have spent the budget than to have spent nothing, and a reconciler that released would let a crash loop spend an unbounded amount while recording nothing. The reconciler charges the reservation and marks the record `reconciled`, so a later reader can tell a charge nobody reported from one somebody did.

**No limit means no ceiling.** An organization an administrator has not limited is not silently limited to zero. `availableTokens` is absent rather than zero, so a caller cannot mistake "unlimited" for "exhausted".

**Every balance is derived, never stored.** Settled tokens sum the settlements; reserved tokens sum the reservations nothing has answered. A stored running total would be a second place for the truth to live, and the two would eventually disagree in a way only an audit could catch.

## What the ledger does not decide

It does not decide who may use a model — that is [access control](2026-08-29-access-control-evaluation.md). It does not know what a month is: a deployment names its periods and the caller asks about the one a request belongs to, which keeps calendars, time zones, and billing cycles out of a ledger whose only job is arithmetic.

It counts tokens, not money. Weighting by price needs the price metadata the model catalog owns, and a ledger that guessed at a conversion would be wrong in a currency.

## Alternatives considered

**Releasing the reservation when a request fails.** Rejected as the default: most failures cannot be distinguished from a request the provider served, and the failure mode is unbounded spending that leaves no record.

**Letting a settlement charge whatever the provider reported.** Rejected: it makes the reservation advisory. A provider that reports more than the request was allowed to produce would spend budget nothing ever claimed, and the arithmetic that decided the request was affordable would have been about a different number.

**A stored running balance.** Rejected: it is faster and it is a second source of truth. The sums are over rows already indexed by organization and period, and correctness here is worth more than the read.

**One settlement kind with a boolean "estimated" flag.** Rejected: `released` is not an estimate of zero, it is the statement that nothing was spent, and collapsing them loses the distinction an invoice reconciliation needs.

**Letting the reconciler delete expired reservations.** Rejected: the row is the evidence that budget was held and why. Reconciliation writes a settlement, which is a record; deletion is the absence of one.

## Consequences

`reservationTtlMs` bounds how long a crashed request can hold budget. It belongs above the slowest completion a deployment expects and nowhere near it: too low and a slow-but-live request is charged its ceiling while still running, too high and a crashed one holds budget for that long.

A reconciled settlement charges the full reservation. For a request that really did fail early, that overcharges, and the `estimated` mark is what makes it findable — an invoice reconciliation can credit the difference, and this ledger deliberately does not try to.

Nothing here writes an audit record. The design calls for one on reconciliation, and the caller that reconciles is the one that knows the principal and the correlation; adding it belongs with the gateway that will run the reconciler on a schedule.
