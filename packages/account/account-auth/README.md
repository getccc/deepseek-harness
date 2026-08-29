---
description: "The authentication seam: turn a login name and a secret into an account, independently of how the secret is verified, for deployments composing Team Edition."
kind: "package-reference"
---

# @deepseek-ai/dsh-account-auth

English | [中文](README.zh.md)

## Summary

`dsh-account-auth` is the one question a sign-in asks: does this login name and this secret name an account? It says nothing about how the secret is checked — a stored password hash today, an external identity provider later — which is why replacing that method never touches the accounts, roles, or devices [`dsh-account-store`](../account-store/README.md) holds. Mount this package for the contract; pair it with a provider such as [`dsh-account-auth-password`](../account-auth-password/README.md), which does the verifying.

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
const outcome = await ctx.accountAuth.authenticate(orgId, loginName, secret)
if (outcome.ok) {
  // outcome.userId is the account; outcome.mustChangePassword says whether it
  // still owes its holder a secret of their own.
}
```

### The failure has no reason, deliberately

An unknown login name, a wrong secret, a locked account, and a suspended account all return `{ ok: false }`. There is no field to branch on, so a caller cannot accidentally build a probe that tells an attacker which login names exist. Distinguishing them is an audit concern, and audit reads it from the store rather than from a sign-in response.

That also means the surface above must not add the distinction back: one message for every failure.

### Setting a secret

`setSecret` stores whatever the provider derives and satisfies what an issued account owed its holder. It rejects a secret the deployment's policy refuses with `WeakSecretError`, whose `requirement` names what was wanted so a form can say it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Why timing is part of the contract

`authenticate` is specified to take the same observable time whether or not the login name exists. A caller who could time the difference would learn exactly what the reasonless failure withholds, so the property belongs in the interface rather than in one provider's notes.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service, the outcome union, and `WeakSecretError` |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`account-auth-password`](../account-auth-password/README.md) — the shipped provider.
- [`account-store`](../account-store/README.md) — where identity and sign-in state live.
- [Accounts subsystem](../../../docs/subsystems/account.md) — the two seams together.

<a id="model-experience"></a>
## Model Experience

None, as authentication is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **Account-scoped throttling only** — the seam sees a login name and a secret, not a source address or a browser session, so it can lock an account but cannot slow an attacker spreading attempts across many accounts. That belongs to the HTTP entry point, which does not exist yet.
- **No enrollment flow** — `setSecret` changes a secret for a known account; issuing a short-lived link that lets a member choose their first one is a separate seam.
- **No session issuance** — a successful outcome names an account and nothing more. What a caller mints from it is the caller's.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The outcome union is the enforcement point, not documentation: there is no reason field for a caller to leak, so the enumeration property survives a careless UI.

</details>
