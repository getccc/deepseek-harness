---
description: "SQLite-backed device authorization: the binding state machine, the device registry, and refresh-token families that revoke on reuse."
kind: "package-reference"
---

# @deepseek-ai/dsh-device-authorization-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-device-authorization-sqlite` runs the [binding flow](../device-authorization/README.md) over one SQLite database: transactions with their one authorization code, the device registry a redemption fills, and the refresh-token families a replay destroys. Every secret is stored as a hash and every one-time value carries the column recording that it was spent, so replay is a lookup rather than a judgement.

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
  '@deepseek-ai/dsh-device-authorization-sqlite':
    path: ./devices.sqlite
    transactionTtlMs: 300000
    codeTtlMs: 60000
    accessTokenTtlMs: 900000
    refreshTokenTtlMs: 2592000000
```

`codeTtlMs` is capped at 60 seconds by the build. A deployment may shorten it; it may not lengthen it, because the code travels one redirect and a longer window buys an attacker time rather than buying a member anything.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The code lives on its transaction

A transaction has at most one authorization code, so the code's hash, lifetime, and consumption live in the transaction row rather than in a table of their own. That makes "one code per transaction" structural instead of a rule someone has to enforce.

Redemption looks the code up by its own hash and then checks that the row is the transaction the caller named, so a code paired with the wrong transaction is not found at all rather than found and then rejected.

### Spent rows are kept

A consumed refresh token stays in the table. Reuse detection is a lookup that finds a consumed row; deleting it would make a replay indistinguishable from a token that never existed.

### Revocation is one operation

Readers check only the credential family, so `revokeDevice` revokes the device *and* every family it ever opened in the same call. A device left revoked with a live family would still obtain tokens.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The state machine: start, confirm, redeem, refresh, verify, revoke |
| [`src/schema.ts`](src/schema.ts) | Tables, constraints, and the pragma guards |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`device-authorization`](../device-authorization/README.md) — the Service Definition and the shared derivations.
- [Device-authorization subsystem](../../../docs/subsystems/device-authorization.md) — the flow and its refusals in full.
- [`account-store-sqlite`](../account-store-sqlite/README.md) — the sibling store, with the same schema-version and application-id handling.

<a id="model-experience"></a>
## Model Experience

None, as device binding is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **Nothing prunes lapsed transactions or spent tokens** — both are kept so a replay is detectable, and a retention pass needs its own design rather than a `DELETE` that would erase the evidence.
- **The authentication reference is recorded, not verified** — the store keeps which successful authentication approved a transaction; deciding that event was valid belongs to the caller that holds it.
- **Rebinding replaces prior credential families** — a successful new authentication for the same device key revokes its older families before reactivating the device.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests drive a real Ed25519 key pair rather than a stub signer. The property under test is that only the holder of the private key behind the digest a member compared can finish the flow, and a stub signer would prove nothing about it.

</details>
