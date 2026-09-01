---
description: "Password authentication over the account store: scrypt derivation with self-describing parameters, rehash on verify, and the lockout policy."
kind: "package-reference"
---

# @deepseek-ai/dsh-account-auth-password

English | [中文](README.zh.md)

## Summary

`dsh-account-auth-password` answers [`dsh-account-auth`](../account-auth/README.md) by deriving a secret with Node's built-in scrypt and comparing it against what [`dsh-account-store`](../account-store/README.md) holds — no dependency to install and no native build. It owns the policy the store's counters feed: how many consecutive failures lock an account and for how long. Every stored hash records the parameters that produced it, so raising the deployment's cost — or arriving with a different algorithm later — upgrades each account the next time its holder signs in, without asking them to do anything.

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
- id: account-auth
  name: '@deepseek-ai/dsh-account-auth-password'
  config:
    minSecretLength: 8
    requiredClasses: [uppercase, lowercase, digit]
    maxFailedAttempts: 5
    lockDurationMs: 900000
```

Every field has a default, so an empty config is a working deployment. The derivation cost is configurable too (`cost`, `blockSize`, `parallelization`) and defaults to a deliberately slow setting; lowering it is a decision to make explicitly, not an optimization to reach for. `requiredClasses` names the character classes a secret must contain one of each: `uppercase`, `lowercase`, and `digit`, in any combination including none. `secretPolicy` answers both fields, so a caller can state the requirement without repeating it.

### Raising the cost later

Change `cost` and restart. Nothing migrates in bulk: each account is re-derived at the new cost the next time its holder signs in successfully, because the hash carries its own parameters and the provider compares them to the current ones.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The encoded hash is self-describing

A stored hash is `$scrypt$N=..,r=..,p=..$salt$derived`. Verification uses the parameters the hash records, never the ones in force now, which is what keeps every previously stored hash valid after a configuration change. The leading algorithm segment is why a future provider can add another algorithm without invalidating anything: verification dispatches on what it finds, and a hash it does not recognize is treated as needing replacement rather than as a match.

### Why an absent account still costs work

`authenticate` derives against a per-process decoy hash when the login name does not exist, is suspended, is locked, or never claimed a secret. Without it, an absent account would answer sooner than a wrong secret, and timing would reveal exactly what the seam's reasonless failure withholds.

### Where the lockout lives

The store counts; this provider decides. A wrong secret increments the store's counter, and reaching `maxFailedAttempts` locks the account for `lockDurationMs`. Locking resets the counter, so an expired lock does not sit one failure away from the next one. A suspended or locked account is refused before any counting, so an attacker cannot keep an account locked by attacking it.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The provider, its config, and the lockout policy |
| [`src/hash.ts`](src/hash.ts) | Derivation, the encoded form, verification, and the rehash test |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`account-auth`](../account-auth/README.md) — the contract this implements.
- [`account-store`](../account-store/README.md) — where the hash and the counters live.
- [Accounts subsystem](../../../docs/subsystems/account.md) — the two seams together.

<a id="model-experience"></a>
## Model Experience

None, as password verification is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of this provider, not a task backlog.

- **scrypt, not Argon2id** — the design names Argon2id, which needs a dependency this repository does not carry; scrypt is built into Node and memory-hard. The encoded hash records its algorithm and verification dispatches on it, so an Argon2id provider is additive and every existing hash keeps working until its holder next signs in.
- **Timing is comparable, not constant** — the decoy derivation removes the large difference an absent account would otherwise show. A JavaScript runtime cannot promise constant time, and this does not claim to.
- **One process at a time for the counters** — two Control Plane instances against one store could interleave failure counts and overshoot the threshold. The deployment this targets runs one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The decoy hash is derived once per process and reused. Deriving it per attempt would double the cost of every real sign-in for no extra property.

</details>
