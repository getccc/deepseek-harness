---
description: "The Runner-facing knowledge endpoints: device-token verification, protocol-version negotiation before any other field, strict request parsing, and closed refusal mapping."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-gateway-http

English | [中文](README.zh.md)

## Summary

`dsh-knowledge-gateway-http` serves the two routes a Team Runner calls for private knowledge: read the authorized directory, and search it. Everything it does is arranged around one fact — a request must not be able to say who is asking or where the answer comes from. The principal is recovered from a verified device access token and never read from a body; the source is resolved from the catalog and has no place in a request at all. Mount it in the Control Plane beside the governed gateway it fronts.

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
- name: '@deepseek-ai/dsh-knowledge-gateway-http'
  config:
    maxRequestBodyBytes: 65536
```

| Field | Default | Meaning |
|---|---|---|
| `maxRequestBodyBytes` | `65536` | Largest request body accepted; a query and a scope need little |

### The two routes

`POST /team/knowledge/catalog` takes `protocolVersion` alone and answers the principal's authorized directory. `POST /team/knowledge/search` adds `query`, `scope`, and an optional `maxResults`. Neither body has a field for an organization, a principal, a device, a source, an address, a tenant, a credential, or an upstream id — a Runner names what it wants, and the Control Plane resolves and authorizes the rest.

### The version is decided first

`protocolVersion` is checked before any other field is decoded and before the token is verified. Both orderings are deliberate. Decoding a body under a grammar its sender did not mean is how a version check stops being one; and telling an out-of-date Runner to sign in again, when signing in through a protocol this build refuses cannot help, sends a member around a loop. An unsupported version answers `426` carrying the supported range, because the Runner cannot ask for that range through a protocol the other side has just said it does not speak.

Knowledge owns its own version rather than sharing the device-binding one: the two evolve independently, and raising the knowledge minimum must not lock an old Runner out of binding, which is the one operation it would need in order to recover.

### Refusals

Every refusal carries a closed knowledge reason, so a Runner distinguishes "sign in again" from "ask an administrator" from "try later" without parsing a message.

| Reason | Status |
|---|---|
| `unauthenticated` | 401 |
| `not-allowed` | 403 |
| `scope-unavailable`, `scope-incompatible` | 409 |
| `upstream-unavailable`, `upstream-invalid` | 502 |
| `control-plane-unreachable` | 503 |
| `update-required` | 426 |
| `cancelled` | 499 |

A failure that is not a knowledge failure is this deployment's own defect rather than anything the Runner did, so it answers `500` with no reason word: inventing one would tell a member to take an action that cannot help.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The routes decide nothing about knowledge. They establish who is asking, prove the request is well formed, and hand both to the gateway; every authorization outcome and every upstream fact belongs to it. That is why a malformed reference is a `400` here while an unauthorized one is a `403` from the gateway: the first is a protocol error and the second is a decision.

### Source map

| File | Holds |
|---|---|
| [`src/protocol.ts`](src/protocol.ts) | The paths, the version constants, and the bodies both sides import |
| [`src/index.ts`](src/index.ts) | The two routes, the shared opening sequence, and the refusal mapping |

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge subsystem](../../../docs/subsystems/knowledge.md) — the governed vocabulary these routes carry.
- [Team private knowledge Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — why a Runner request has no place for an address or a principal.

<a id="model-experience"></a>
## Model Experience

None, as the routes run in the Control Plane, which mounts no agent and no tool registry, so a model never reaches them.

#### KV Cache effect

No request prefix changes here. Passages become model-visible only after a Runner-side tool renders them, which is where their prefix cost lands.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the adapter is incomplete on its own. They are current package constraints.

- **No cancellation forwarding** — a client that disconnects mid-search does not abort the upstream call; the gateway's own bounds are what end it. Threading the request's abort signal through needs a route contract that carries one.
- **No document read route** — the two routes are the whole Runner-facing surface until full-document reading ships.
- **No rate limiting** — a bound on how often one device may search belongs here, and nothing imposes one yet; the reverse proxy in front is the current answer.
- **`cancelled` maps to a non-standard 499** — no registered status describes a client-abandoned request, and the reason word is what a Runner reads; the status is for logs.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
