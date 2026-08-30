---
description: "The Control Plane browser session: an opaque cookie token, its stored hash, the CSRF value derived from it, and the decision that a write came from this site."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-browser-session

English | [中文](README.zh.md)

## Summary

`dsh-team-browser-session` holds the four facts every member-facing Control Plane surface needs to agree on: what the session cookie is called, how its token hashes into the account store, what CSRF value that token derives, and when a write may be treated as coming from this site. They live in one package because more than one surface answers them — the browser API and the device-confirmation page — and two copies of a session rule are two chances to disagree about who is signed in.

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
import {
  csrfMatches, csrfToken, currentSession, newSessionToken, sameOrigin, writeSessionCookie,
} from '@deepseek-ai/dsh-team-browser-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AccountStore } from '@deepseek-ai/dsh-account-store'

declare const store: AccountStore
declare const req: IncomingMessage
declare const res: ServerResponse

const signed = await currentSession(store, req)
if (signed !== undefined && sameOrigin(req) && csrfMatches(signed.token, 'the value the client echoed')) {
  // The three proofs a write needs, in the order they cost.
}

writeSessionCookie(res, newSessionToken(), 43_200, true)
```

`currentSession` resolves through the store on every request, so a suspended member's session stops working at once rather than when a signed value happens to lapse.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Nothing about the member travels in the cookie

The cookie carries random bytes; the store holds their SHA-256. A stolen cookie cannot be read, and ending a session is a store write rather than a wait for an expiry.

### The CSRF value is derived, not stored

`csrfToken` is a function of the session token, so there is no second record to keep in step with the first. It is a different value from the cookie, so carrying the cookie is not by itself enough to submit a write. `csrfMatches` compares in constant time.

### The session cookie is Lax, not Strict

A member reaches the device-confirmation page by following a link from the pairing page their own Runner served, which is a cross-site top-level navigation. Strict would withhold the session there and the page would ask them to sign in again for no reason.

### An opaque Origin needs Fetch Metadata

`sameOrigin` checks `Origin` against the authority the request itself names, so a deployment does not configure its own address twice. A context that sends `Origin: null` is accepted only when the browser-controlled `Sec-Fetch-Site` independently says `same-origin`; web content cannot set that header.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The cookie, the token, the CSRF derivation, and the same-origin decision |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`team-admin-api`](../team-admin-api/README.md) — the browser API that authenticates with these functions.
- [`team-shell`](../team-shell/README.md) — the device-confirmation page that shares the same session.

<a id="model-experience"></a>
## Model Experience

None, as this decides browser authentication and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One session per browser, with no device binding** — a session is a bearer token in a cookie; nothing ties it to the computer that obtained it, which is what the separate device-authorization credential does for a Runner.
- **No idle timeout** — the cookie's `Max-Age` is the whole lifetime, and a session is not shortened by inactivity.
- **No session inventory for a member** — the store resolves one session at a time; listing the sessions an account holds, so a member could end one, needs a query this package does not have.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`sameOrigin` is tested against `Origin: null` from both sides, because the value of the rule is entirely in what it refuses: an opaque context without same-origin Fetch Metadata must fail, or the header buys nothing.

</details>
