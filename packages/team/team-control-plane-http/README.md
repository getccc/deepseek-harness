---
description: "The Control Plane's Runner-facing binding endpoints: open a transaction, redeem an authorization code, exchange a refresh token."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-control-plane-http

English | [中文](README.zh.md)

## Summary

`dsh-team-control-plane-http` serves the three endpoints a Runner calls: open a binding transaction, redeem an authorization code, and exchange a refresh token. None of them takes a browser session, because none of them is authorized by one — opening a transaction proves nothing and learns nothing, and the other two are authorized by a PKCE verifier, a device signature, and a one-time code. The endpoints a member's browser uses belong to the Team Shell.

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
  '@deepseek-ai/dsh-team-control-plane-http':
    pathPrefix: /team/device
    maxRequestBodyBytes: 16384
```

The three paths are `POST {pathPrefix}/start`, `/redeem`, and `/refresh`. A refusal answers 403 carrying the seam's own word, so a Runner tells "try again" from "bind this computer again" without parsing a message; a body this endpoint could not read answers 400.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Every body is parsed before the seam sees it

The seam's types are a promise its callers keep, and a caller that arrived over HTTP has made no such promise. Each endpoint builds the seam's own request field by field, so a missing `publicKey` or a platform the device word list does not govern is a 400 here rather than a constraint violation deeper in.

### A failure that is not a refusal says nothing about itself

A refusal carries the seam's word. Anything else answers 500 with `{"error":"internal"}`: a Runner learns that this deployment has a problem, and nothing else.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The three routes, the body parsing, and the refusal mapping |
| [`src/protocol.ts`](src/protocol.ts) | The paths and the protocol version both sides import |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Team-handoff subsystem](../../../docs/subsystems/team-handoff.md) — the whole flow, both sides.
- [`device-authorization`](../../account/device-authorization/README.md) — the seam these endpoints expose.
- [`team-account-client`](../team-account-client/README.md) — the Runner that calls them.

<a id="model-experience"></a>
## Model Experience

None, as these endpoints are server-side and register registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **No browser-facing endpoints** — reading a pending transaction and confirming it need a Control Plane session, and arrive with the Team Shell.
- **No rate limiting** — the seam refuses a bad code or signature, but nothing here slows a caller down between attempts.
- **The protocol version is sent, not negotiated** — a Runner states which version it speaks and the seam refuses a mismatch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The endpoints are exercised against a real device-authorization composition rather than a stub, because what is worth testing is that a body arriving over HTTP reaches the seam in the shape the seam requires.

</details>
