---
description: "The Control Plane's Runner-facing web search route: device-token verification, protocol-version negotiation, a per-member web.search decision, the search through the Control Plane's own web service, and an audit record."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-gateway-http

English | [中文](README.zh.md)

## Summary

`dsh-web-search-gateway-http` serves the two routes a Team Runner calls for company web search: `POST /team/web/search` runs one, and `POST /team/web/access` answers whether this member may search at all. The principal is recovered from a verified device access token and never read from a body; the search runs through the Control Plane's own `ctx.web`, where the provider and its credential are composed, so a request cannot name a provider, an address, or a key. Every search is decided by `web.search` on the organization's `web_search` resource and recorded in the audit log.

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

Mount it in a `team-control-plane` composition after the web server, the web service with its search provider, device authorization, access control, and audit.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official
- name: '@deepseek-ai/dsh-web-search-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
- name: '@deepseek-ai/dsh-web-search-gateway-http'
  config:
    maxRequestBodyBytes: 16384
```

| Field | Default | Meaning |
|---|---|---|
| `maxRequestBodyBytes` | `16384` | Largest request body accepted; a query and a bound need little |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-gateway-http) is the exhaustive source for the accepted field.

### The routes

`POST /team/web/access` takes `protocolVersion` alone and answers `{ allowed }`, the member's `web.search` decision, so a Runner offers the switch only to a member who may use it; the decision itself is not recorded, the search a member then runs is. `POST /team/web/search` takes `protocolVersion`, `query`, and an optional `maxResults`, and answers the web service's result verbatim: an optional `content`, the `sources`, and `truncated`. The body has no field for an organization, a principal, a device, a provider, an address, or a credential; a Runner names what it wants and the Control Plane resolves and authorizes the rest.

### The version is decided first

`protocolVersion` is checked before any other field is decoded and before the token is verified, so a body is never decoded under a grammar its sender did not mean, and an out-of-date Runner is told to update rather than sent to sign in again. An unsupported version answers `426` carrying the supported range.

### Who may search

The token names the member; the route then asks access control for `web.search` on the organization's `web_search` resource, fresh on every call, so a revoked grant lands on the next search. The resource is registered by this route the first time it serves an organization, so a role granted the permission before the first search already covers it. An administrator gives a role the permission through the console's role editor, where the shipped navigation carries a "Web search" entry under resource management; a role that covers the whole catalog holds it from the start.

### Refusals

| Reason | Status | When |
|---|---|---|
| `update-required` | 426 | `protocolVersion` outside the supported range |
| `unauthenticated` | 401 | No token, an unknown one, a lapsed one, or a revoked device — one answer for all |
| `not-allowed` | 403 | No role of the member holds `web.search` |
| `upstream-unavailable` | 502 | The Control Plane's search backend has no provider or no credential |
| `upstream-invalid` | 502 | The search provider answered with an error |
| `cancelled` | 499 | The search was cancelled |

A malformed body answers `400 { "error": "malformed" }`, a method other than POST `405`, and a failure that is not a web failure `500 { "error": "internal" }`.

### What is recorded

Every decided request writes one `web.search` audit event against the organization resource: `allowed` with the number of sources returned, `denied` with reason `no-grant`, or `error` with the refusal word the member received.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Both routes open a request the same way: read the body under the configured bound, check the version, verify the token. The decision route then answers access control's word. The search route validates `query` and `maxResults`, registers the organization's `web_search` resource once per process, asks access control, calls `ctx.web.search`, and maps a thrown `WebError` to a refusal: `WEB_ABORTED` is `cancelled`, the provider-selection and credential codes are `upstream-unavailable`, and every other web code is `upstream-invalid`. The audit record carries the same word under `webFailure`. The wire vocabulary lives in [`src/protocol.ts`](src/protocol.ts) and is imported by the Runner-side provider, so neither side can drift.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The routes: version, token, validation, decision, search, record, refusal mapping |
| [`src/protocol.ts`](src/protocol.ts) | The path, the header, the version, the request fields, and the closed refusal set |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-web-search-team](../web-search-team/README.md) — the Runner-side provider that calls this route.
- [Web subsystem](../../../docs/subsystems/web.md) — the search request and result this route carries.
- [dsh-access-control](../../access/access-control/README.md) — the permission catalog `web.search` belongs to.
- [dsh-knowledge-gateway-http](../../knowledge/knowledge-gateway-http/README.md) — the same route shape for private knowledge.
- [Team web search Agent Note](../../../.agents/notes/implemented/feature/2026-09-15-team-web-search-through-the-control-plane.md) — why the credential never reaches a Runner.

<a id="model-experience"></a>
## Model Experience

None, as the route registers no prompt section, tool, or request context; the model reaches web search through `dsh-tool-web` on the Runner, whose provider calls this route.

#### KV Cache effect

None: nothing here enters a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the route is incomplete on its own. They are current package constraints.

- **No quota** — a search through the shipped DeepSeek provider is a full model request on the company key, and nothing here reserves or settles it against the member's model budget. The audit log is the only ledger until search usage joins the quota seam.
- **One organization resource** — the decision is per member on one `web_search` resource; there is no per-provider or per-domain grant.
- **No deadline of its own** — the search provider's own timeout bounds the call; a Runner that gives up sooner is not told to wait.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The route holds nothing between calls; that a request carries no provider, address, or credential is an absence its tests assert by inspecting what the Runner sends.
