---
description: "The device-authorization Service Definition: pairing-code binding, PKCE and device-signature redemption, and refresh-token families with reuse detection."
kind: "package-reference"
---

# @deepseek-ai/dsh-device-authorization

English | [中文](README.zh.md)

## Summary

`dsh-device-authorization` turns a member's browser session into a long-lived credential on one computer, and nowhere else. Binding proves three separate things — a member approved it, they approved *this* computer, and this computer holds the key they compared — and refuses unless all three hold. The package owns the flow's vocabulary and the values both sides must derive identically: the PKCE challenge, the public-key digest a person compares, the bytes a device signs, and the hash a secret is stored under. Pair it with a backend such as [`device-authorization-sqlite`](../device-authorization-sqlite/README.md).

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
import { redeemSigningInput } from '@deepseek-ai/dsh-device-authorization'

declare const ctx: Context
declare const orgId: OrgId
declare const userId: UserId
declare const publicKey: string
declare const pkceChallenge: string
declare const sign: (input: string) => string

// On the Runner, before anyone has approved anything.
const started = await ctx.deviceAuthorization.start({
  publicKey, platform: 'darwin', runnerVersion: '2.4.1',
  pkceChallenge, callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
})

// On the Control Plane, after the member compared started.pairingCode.
const issued = await ctx.deviceAuthorization.confirm(started.transactionId, {
  orgId, userId, browserSessionId: 'browser-session',
})

// Back on the Runner, proving it holds the key behind the digest.
const signature = sign(redeemSigningInput(started.transactionId, issued.code))
```

`start` carries no account on purpose: a transaction belongs to nobody until a member confirms it from an authenticated session, so an unauthenticated caller who opens one learns only what it already supplied.

### Deriving the shared values

A Runner and the Control Plane never share code at runtime, so both import [`crypto.ts`](src/crypto.ts) for every value either derives: `pkceChallenge`, `digestPublicKey`, `redeemSigningInput`, `refreshSigningInput`, and `hashSecret`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Why the signed bytes name the transaction and the code

`redeemSigningInput(transactionId, code)` binds a signature to one redemption, so a signature captured from another proves nothing. The code itself is not in the signed string — only its hash — because a leaked signature would otherwise carry the code that made it.

### Why the pairing code excludes vowels

A code with no vowels cannot spell a word the eye completes instead of reading, and dropping `0`, `O`, `1`, `I`, and `L` removes the pairs that look alike in whatever font a browser picks. The code does not have to resist guessing on its own: confirming already requires an authenticated Control Plane session.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service, its refusals, and `ctx.deviceAuthorization` |
| [`src/crypto.ts`](src/crypto.ts) | Every value both sides of the flow must derive identically |
| [`src/vocabulary.ts`](src/vocabulary.ts) | The platform and refusal word lists |
| [`src/brand.ts`](src/brand.ts) | Device, transaction, and family identities |
| [`src/types.ts`](src/types.ts) | Request, response, and entity shapes, types only |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`device-authorization-sqlite`](../device-authorization-sqlite/README.md) — the shipped backend.
- [Device-authorization subsystem](../../../docs/subsystems/device-authorization.md) — the flow and its refusals in full.
- [`account-store`](../account-store/README.md) — the organizations and accounts a confirmation names.

<a id="model-experience"></a>
## Model Experience

None, as device binding is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **An access token carries no authorization** — it names an organization, an account, and a device. Roles and grants are read per request, so a token cannot be treated as a capability.
- **Ed25519 only** — the flow names one signature algorithm rather than negotiating one, because both sides ship together and a negotiated algorithm is an attack surface with no current second option.
- **Nothing here defends the Runner's own process** — a plugin sharing the Runner's Cordis process can read the device key. Short lifetimes and revocation reduce the window; they do not isolate it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Reuse detection deliberately punishes the rightful holder along with a thief: a replayed refresh token means either the token leaked or the Runner lost track of it, and nothing in the exchange can tell those apart. Softening it to "ignore the replay" would make a stolen token usable for as long as the family lives.

</details>
