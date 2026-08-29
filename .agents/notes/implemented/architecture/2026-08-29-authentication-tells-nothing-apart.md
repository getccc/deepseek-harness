# Agent Note: A sign-in failure carries no reason, by type

Status: implemented

English | [中文](2026-08-29-authentication-tells-nothing-apart.zh.md)

## Problem

A sign-in can fail four ways: the login name does not exist, the secret is wrong, the account is locked, the account is suspended. Reporting which one is the natural thing to build and the wrong thing to ship — an attacker who can tell "no such account" from "wrong password" can enumerate every login name in the organization before attacking any of them.

Documenting "show one message for all of these" does not hold. It puts the property in prose, where the next form, the next error page, and the next log line each get their own chance to break it.

Two other decisions had to be made with it. Where does the lockout policy live, given the account store already counts failures? And what derives the secret, when the design names Argon2id and this repository carries no dependency that provides it?

## Decision

The outcome union has no reason field:

```ts
type AuthenticationOutcome =
  | { ok: true; userId: UserId; mustChangePassword: boolean }
  | { ok: false }
```

There is nothing for a caller to branch on, so the property survives a careless surface. The type is the enforcement, not the documentation.

Timing is part of the same property and therefore part of the interface, not one provider's note: `authenticate` is specified to take the same observable time whether or not the login name exists. The password provider derives against a per-process decoy hash whenever there is nothing real to verify — an absent name, a suspended or locked account, an account that never claimed a secret — because an attempt that returns early tells the attacker exactly what the missing reason field withheld.

**The store counts; the provider decides.** `recordFailedLogin` returns a number and `lockUser` takes a moment; what number is too many and how long a lock lasts are configuration on the provider. Locking resets the counter, so an expired lock does not sit one failure from the next.

**Derivation is scrypt, and the hash says so.** A stored hash is `$scrypt$N=..,r=..,p=..$salt$derived`: verification dispatches on what the hash records, never on current configuration, and a successful sign-in against weaker parameters re-derives at the current ones. Raising the cost therefore migrates each account the next time its holder signs in, and an Argon2id provider added later is additive rather than a flag day — an unrecognized algorithm reads as "needs replacement", not as a match.

This departs from the design's Argon2id, deliberately: Argon2id needs a dependency this repository does not carry, while scrypt is built into Node and memory-hard. The self-describing format is what makes the departure cheap to undo.

## Alternatives considered

**A reason field, with a rule that the UI collapses it.** Rejected: it moves a security property into prose that every future caller can violate independently. The repository's own rule is to enforce a decision in the operation that makes it.

**Returning the reason only to audit.** Rejected for now: audit does not exist yet, and adding a second channel with no consumer would be speculative. Audit reads the store's own counters when it lands.

**Lockout policy inside the store.** Rejected: the store would then decide, and a second authentication method would inherit a password method's thresholds. Counting is storage; judging is authentication.

**Adding an Argon2id dependency.** Rejected for this change: a native module complicates the packaged CLI, and a WASM one is still a new dependency for a security primitive. Neither is needed while the format keeps the door open.

## Consequences

Nothing can distinguish sign-in failures without a new mechanism, including a legitimate one that wants to. A future "your account is locked" message needs a separate, deliberately-designed channel rather than a field added here.

Throttling is account-scoped only. The seam sees a login name and a secret, not a source address or a browser session, so an attacker spreading attempts across many accounts is not slowed. That belongs to the HTTP entry point, which does not exist yet.

The provider's derivation cost defaults slow, and lowering it is a configuration decision a deployment makes explicitly. Tests run at a deliberately low cost, which is why they assert policy rather than hardening.
