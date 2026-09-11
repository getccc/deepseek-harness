---
description: "The account store seam: organizations, member accounts, and sign-in state behind one backend-neutral service, for deployments composing Team Edition."
kind: "package-reference"
---

# @deepseek-ai/dsh-account-store

English | [中文](README.zh.md)

## Summary

`dsh-account-store` is where Team Edition keeps who a member is: one organization and the accounts inside it, each with a login name unique to that organization, a status, and the counters a lockout policy reads. It is a repository and nothing else: it records what happened and reports conflicts, and makes no decision. Whether five failures mean a lockout, and what an encoded password hash contains, belong to the authentication provider that reads and writes through it. Mount it for the vocabulary and the service contract; pair it with a backend such as [`account-store-sqlite`](../account-store-sqlite/README.md).

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

Inject `accountStore` and call it. Every method is a repository operation returning a promise, so every failure is a rejection — no method throws synchronously.

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-account-store'

declare const ctx: Context

const org = await ctx.accountStore.createOrganization('Acme')
const user = await ctx.accountStore.createUser({
  orgId: org.id,
  loginName: 'alice',
  displayName: 'Alice',
})
```

`updateOrganization` changes the organization's own fields — its name, and the code, lead, phone, and email it is described by — without changing its stable id or authorization revision. An absent field is left as stored; a field set to `null` is cleared.

### An issued account cannot yet sign in

`createUser` stores identity only. The account carries no authentication material and `mustChangePassword` is set. A provisioning caller follows it with the authentication provider's secret write; `setPasswordHash` stores that secret's encoded form and clears the flag together.

### Sign-in state is counted here, judged elsewhere

`recordFailedLogin` returns the consecutive failure count and `lockUser` refuses sign-in until a moment you pass. The store never decides that a count is too high or how long a lock lasts; the authentication provider owns that policy and calls these to record its decision.

Browser sessions also live with the account records. `revokeBrowserSessions` removes every administration session for one account as a single account-recovery operation; ending an account that has no sessions is successful.

### Failures you can act on

`DuplicateLoginNameError` names the login and organization that collided. `UnknownAccountUserError` and `UnknownOrganizationError` name the record an operation could not find. Anything else a backend raises travels unchanged, so a caller is never told the wrong cause.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Why authentication material is opaque here

The store holds the encoded hash but never parses, compares, or derives anything from it, and exposes it through two narrow accessors instead of putting it on the account record. That is what keeps storage and authentication method orthogonal: replacing password sign-in with an external identity provider changes which provider is mounted, not the stored accounts, roles, or devices.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service, its failures, and the `ctx.accountStore` declaration |
| [`src/brand.ts`](src/brand.ts) | `OrgId` and `UserId`: the branded types and their brand functions |
| [`src/types.ts`](src/types.ts) | Entity shapes, types only |

### Invariant ownership

The package declares an abstract service and mounts nothing, so its companion installs nothing. Whichever backend implements the service owns the durable relations its rows must satisfy and enforces them where they live.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`account-store-sqlite`](../account-store-sqlite/README.md) — the shipped backend.
- [Account package map](../README.md) — how this family is split.
- [Capability seams](../../../docs/capability-seams.md) — the Definition / Provider / Consumer split this follows.

<a id="model-experience"></a>
## Model Experience

None, as the store is server-side identity that no prompt section, tool, or request context reaches.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One organization per store, in practice** — the service can hold several, but nothing yet resolves which organization a request belongs to, so a deployment uses one.
- **No account deletion** — an account is suspended, never removed, because roles, devices, and audit rows reference it. A deletion path needs those references decided first.
- **Nothing prunes lapsed sessions** — a session row stays after it stops being honoured, so a retention pass needs its own design rather than a `DELETE` on read.
- **Login names compare exactly** — two names differing only by case or Unicode normalization are distinct accounts. A deployment that wants them equal must normalize before calling.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Methods keep synchronous bodies and return `Promise.reject` rather than being `async`, because the repository lint refuses an `async` function with no `await`. The contract is what matters: a caller's `.catch` must see every failure, so no method may throw synchronously.

</details>

**Runtime invariant:** No companion is published: the package declares an abstract service and its vocabulary and mounts nothing; the provider that implements the service owns the durable relations its rows must satisfy and checks them.
