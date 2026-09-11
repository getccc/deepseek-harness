---
description: "The Control Plane's Runner-facing account authentication and device-credential endpoints."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-control-plane-http

English | [中文](README.zh.md)

## Summary

`dsh-team-control-plane-http` serves the four endpoints a Team Runner calls: open a device transaction, authenticate an organization account and approve that transaction, redeem its one-time code, and refresh the device credential. The member's browser remains on the Runner origin; no Control Plane browser session participates.

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
    organizationId: 019400a1-0000-7000-8000-000000000000
    pathPrefix: /team/device
    maxRequestBodyBytes: 16384
```

The four paths are `POST {pathPrefix}/start`, `/login`, `/redeem`, and `/refresh`. `organizationId` has no default because this single-organization endpoint must not guess which account namespace it authenticates. A successful `/login` answer carries the one-time code plus the authenticated account's `loginName` and `displayName`; it never carries a password or device credential. Invalid account credentials answer the same reasonless 401; device-seam refusals answer 403 carrying the seam's word; malformed bodies answer 400.

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
| [`src/index.ts`](src/index.ts) | The four routes, account authentication, body parsing, and refusal mapping |
| [`src/protocol.ts`](src/protocol.ts) | The paths and the protocol version both sides import |

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

- **No browser-facing member endpoint** — the Runner owns the account form and calls these routes over the configured Control Plane origin.
- **No rate limiting** — the seam refuses a bad code or signature, but nothing here slows a caller down between attempts.
- **The protocol version is sent, not negotiated** — a Runner states which version it speaks and the seam refuses a mismatch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The endpoints are exercised against a real device-authorization composition rather than a stub, because what is worth testing is that a body arriving over HTTP reaches the seam in the shape the seam requires.

</details>

**Runtime invariant:** No companion is published: the package registers three HTTP routes that parse a body and hand it to the device-authorization seam; every relation worth checking (a code spent once, a signature that verifies, a family revoked on replay) belongs to that seam and its store.
