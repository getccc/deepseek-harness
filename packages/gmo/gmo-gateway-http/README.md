---
description: "The Runner-facing GMO HTTP endpoints of the Control Plane: token-verified, protocol-version-checked directory, result listing, description, and question routes."
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-gateway-http

English | [中文](README.zh.md)

## Summary

`dsh-gmo-gateway-http` registers the four routes a Runner calls — `/team/gmo/catalog`, `/results`, `/describe`, and `/ask` — on the Control Plane's web server. A request must not be able to say who is asking or where the answer comes from: the principal is recovered from a verified device token and never read from a body, and the source is resolved from the catalog and has no place in a request. The protocol version is checked before any other field is decoded, so a Runner this build cannot speak to is told to update.

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

Mount it in the Control Plane after the web server, the GMO gateway, and device authorization.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-gmo-gateway-http'
  config:
    maxRequestBodyBytes: 65536
```

| Field | Default | Meaning |
|---|---|---|
| `maxRequestBodyBytes` | `65536` | Largest request body accepted; a question may list many filter values |

### The routes

| Route | Body | Answers |
|---|---|---|
| `POST /team/gmo/catalog` | `protocolVersion` | The authorized directory: reference and display name |
| `POST /team/gmo/results` | `protocolVersion`, `ref`, optional `page`, `pageSize` | One page of a category's results |
| `POST /team/gmo/describe` | `protocolVersion`, `resultRef` | One result's description |
| `POST /team/gmo/ask` | `protocolVersion`, `resultRef`, `query` | The source's bounded answer |

Every route takes `POST`, reads a bounded JSON object, checks `protocolVersion`, verifies the bearer token, and only then decodes the operation's fields. An unsupported version answers `426` with the supported range and performs nothing.

### Questions are parsed, not trusted

`query` is read by the domain package's `readGmoQuery`: three kinds, each with the keys it defines and no others, column names that look like column names, and bounded lists. A request with an extra key is refused as malformed, because a Runner that believes a filter applied and a Control Plane that dropped it would produce a confident wrong number.

### Refusals

| Reason | HTTP status |
|---|---|
| `unauthenticated` | `401` |
| `not-allowed` | `403` |
| `scope-unavailable`, `result-unavailable`, `unsupported` | `409` |
| `invalid-query` | `422` |
| `too-large` | `413` |
| `upstream-unavailable`, `upstream-invalid` | `502` |
| `update-required` | `426` |
| `cancelled` | `499` |

The body is `{ "error": "gmo", "reason": <word> }` and never carries upstream text. A failure that is not a `GmoError` is this deployment's own defect and answers `500` with no reason.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Everything a route does before it diverges — method, body, version, identity — happens once, in that order. The version comes before identity so an out-of-date Runner is told to update rather than to sign in; identity comes before any operation so a refused request costs the source nothing.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin, the four routes, and the refusal mapping |
| [`src/protocol.ts`](src/protocol.ts) | The paths, the protocol version range, and the request body types the Runner provider imports |

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the vocabulary the routes answer in.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — the protocol-first refusal and why a question is a closed vocabulary.

<a id="model-experience"></a>
## Model Experience

None, as the routes run in the Control Plane, which mounts no agent and no tool registry, so a model never reaches them.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **One protocol version** — `GMO_PROTOCOL_VERSION` and its minimum are both `1`; the range exists so the first incompatible change has somewhere to go.
- **Bodies are bounded, answers are not paged** — a question returns one bounded answer; there is no streaming and no continuation token.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the plugin registers four routes whose refusals the package's tests drive over a real HTTP server, a real device credential, and the real gateway.
