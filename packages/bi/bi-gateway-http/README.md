---
description: "The Runner-facing BI endpoints: device-token verification, protocol-version negotiation before any other field, strict request parsing, and closed refusal mapping."
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-gateway-http

English | [中文](README.zh.md)

## Summary

`dsh-bi-gateway-http` serves the routes a Team Runner calls for BI analysis: read the authorized project directory, list one project's saved charts, and run one of them. Everything it does is arranged around one fact — a request must not be able to say who is asking or where the answer comes from. The principal is recovered from a verified device access token and never read from a body; the source is resolved from the catalog and has no place in a request at all. Mount it in the Control Plane beside the governed gateway it fronts.

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

Mount it in a `team-control-plane` composition after the web server, the governed gateway, and device authorization.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-bi-gateway-http'
  config:
    maxRequestBodyBytes: 16384
```

| Field | Default | Meaning |
|---|---|---|
| `maxRequestBodyBytes` | `16384` | Largest request body accepted; a reference and a keyword need little |

### The routes

`POST /team/bi/catalog` takes `protocolVersion` alone and answers the principal's authorized project directory. `POST /team/bi/charts` adds `ref` and an optional `query`, `page`, and `pageSize`. `POST /team/bi/query` adds `chartRef` and an optional `limit`. No body has a field for an organization, a principal, a device, a source, an address, a credential, an upstream id, a filter, a parameter, or a query of the caller's own — a Runner names what it wants, and the Control Plane resolves and authorizes the rest. A saved chart runs as it was saved.

The keyword is the one free-text field a body carries, and it is bounded to one line of at most 200 characters, so it stays a keyword; an empty one narrows nothing and reads as none.

### The version is decided first

`protocolVersion` is checked before any other field is decoded and before the token is verified. Both orderings are deliberate. Decoding a body under a grammar its sender did not mean is how a version check stops being one; and telling an out-of-date Runner to sign in again, when signing in through a protocol this build refuses cannot help, sends a member around a loop. An unsupported version answers `426` carrying the supported range, because the Runner cannot ask for that range through a protocol the other side has just said it does not speak.

BI owns its own version rather than sharing the device-binding one or the knowledge one: the protocols evolve independently, and raising the BI minimum must not lock an old Runner out of binding, which is the one operation it would need in order to recover.

### Refusals

Every refusal carries a closed BI reason, so a Runner distinguishes "sign in again" from "ask an administrator" from "try later" without parsing a message.

| Reason | Status |
|---|---|
| `unauthenticated` | 401 |
| `not-allowed` | 403 |
| `scope-unavailable`, `chart-unavailable` | 409 |
| `query-failed`, `upstream-unavailable`, `upstream-invalid` | 502 |
| `control-plane-unreachable` | 503 |
| `update-required` | 426 |
| `cancelled` | 499 |

A failed run answers as an upstream failure: the warehouse is upstream of this Control Plane exactly as the BI service is, and a member can act on neither beyond trying again or asking an administrator. A failure that is not a BI failure is this deployment's own defect rather than anything the Runner did, so it answers `500` with no reason word: inventing one would tell a member to take an action that cannot help.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The routes decide nothing about BI. They establish who is asking, prove the request is well formed, and hand both to the gateway; every authorization outcome and every upstream fact belongs to it. That is why a malformed reference is a `400` here while an unauthorized one is a `403` from the gateway: the first is a protocol error and the second is a decision.

### Source map

| File | Holds |
|---|---|
| [`src/protocol.ts`](src/protocol.ts) | The paths, the version constants, and the bodies both sides import |
| [`src/index.ts`](src/index.ts) | The routes, the shared opening sequence, and the refusal mapping |

<a id="further-exploration"></a>
## Further Exploration

- [BI subsystem](../../../docs/subsystems/bi.md) — the governed vocabulary these routes carry.
- [Team BI analysis Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — why a Runner request has no place for an address or a principal.

<a id="model-experience"></a>
## Model Experience

None, as the routes run in the Control Plane, which mounts no agent and no tool registry, so a model never reaches them.

#### KV Cache effect

No request prefix changes here. Rows become model-visible only after a Runner-side tool renders them, which is where their prefix cost lands.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the adapter is incomplete on its own. They are current package constraints.

- **No cancellation forwarding** — a client that disconnects mid-run does not abort the upstream run; the gateway's and the provider's own bounds are what end it. Threading the request's abort signal through needs a route contract that carries one.
- **No rate limiting** — a bound on how often one device may run a chart belongs here, and nothing imposes one yet; the reverse proxy in front is the current answer.
- **`cancelled` maps to a non-standard 499** — no registered status describes a client-abandoned request, and the reason word is what a Runner reads; the status is for logs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the adapter holds no state between requests and publishes no event stream; that a request cannot name its own principal is structural, since the body has no field for one and the identity comes from the verified token.
