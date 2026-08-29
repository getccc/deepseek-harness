# Agent Note: binding proves three things, and refuses unless all three hold

Status: implemented

English | [中文](2026-08-29-device-binding-proves-possession.zh.md)

## Problem

A member logs into the company site in a browser, and a background Runner on their own computer has to end up holding a credential. The browser and the Runner are different programs with different trust: the browser has an authenticated session but no way to prove which computer it is sitting at, and the Runner is on the right computer but has no way to prove which member owns it.

The naive bridge is to have the site hand the Runner a token. That establishes only that something on this machine could reach the loopback port, which any local program can. It answers neither "which member" nor "which computer" — it answers "which port".

## Decision

**Binding proves three separate things, and refuses unless all three hold.** A member approved it, from an authenticated Control Plane session, which is where the organization and the account come from. They approved *this* computer, by comparing a pairing code and a public-key digest between the local page and the Control Plane page. And this computer holds the key they compared, by signing with the private half at redemption.

Each one covers what the others cannot. Without the third, the member approves a digest that any program could have shown them; without the second, they approve a computer they never identified; without the first, nothing ties the result to an account.

**A transaction carries no account until it is confirmed.** `start` takes a public key and a PKCE challenge and returns a transaction id and a pairing code, so a caller that opens transactions without a session learns only what it already supplied. The schema states this: a `CHECK` ties the pending state to a null `org_id`, so the two halves cannot drift.

**The signed bytes name the transaction and the code.** A signature captured from one redemption proves nothing about another. The code itself is not in the signed string — only its hash — because a leaked signature would otherwise carry the code that made it.

**A replayed refresh token revokes its whole family.** Either the token leaked or the Runner lost track of it, and the exchange cannot tell those apart, so both are answered by making every credential in the family useless. This deliberately punishes the rightful holder along with a thief: the alternative, ignoring the replay, leaves a stolen token usable for as long as the family lives.

**Revoking a device revokes every family it ever opened, in the same operation.** Readers check only the family, so a device left revoked with a live family would still obtain tokens.

**Access tokens carry no authorization.** A token names an organization, an account, and a device. Roles and grants are read per request against the current policy revision, so a role change takes effect without waiting for a token to expire.

## Alternatives considered

**A JWT access token with claims.** Deferred: every party that would verify one can reach the database, so a signed token buys nothing today and costs a signing key, a rotation story, and a second place where authorization facts could go stale. It becomes worth it when a verifier exists that cannot reach the store.

**Trusting the loopback port.** Rejected as described: reaching a loopback port proves only locality, and every local program has it.

**A pairing code long enough to resist guessing on its own.** Rejected: a person compares it across two screens, and length is paid for in misreadings. It does not carry the security — the authenticated confirmation session does — so it is optimized for the eye instead: no vowels, so it cannot spell a word the eye completes, and none of `0`, `O`, `1`, `I`, `L`.

**Keeping a device-status check in the readers.** Removed: revoking a device revokes its families in the same call, so a family that is alive belongs to a device that is alive. The check could never fire, and unreachable defence is a claim nothing tests. The relation is asserted directly instead, including across an earlier binding of the same key.

## Consequences

`codeTtlMs` is configurable downward and capped at 60 seconds by the build. It is a deployment knob for shortening and a security invariant for lengthening, because the code travels exactly one redirect.

Lapsed transactions and spent tokens are never pruned. Both are kept so a replay is detectable; a consumed row deleted would make a replay indistinguishable from a token that never existed. A retention pass needs its own design.

Nothing here defends the Runner's own process. A plugin sharing the Runner's Cordis process can read the device private key, and short lifetimes and revocation reduce the window rather than isolating it. The threat model accepts this for the first version, and the compensating controls — private-plugin review, artifact signing, unknown public plugins off by default — live elsewhere.

Under the SQLite deviation this store is its own database. Nothing here writes an audit record, because the operations that will call it — a Control Plane HTTP surface, an admin API — know the device, the correlation, and the browser session that this store only records.
