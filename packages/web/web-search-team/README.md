---
description: "The Team Runner's web search provider: one outbound Control Plane request carrying the current device token and the query, with no search credential or address of its own."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-team

English | [中文](README.zh.md)

## Summary

`dsh-web-search-team` registers the `team` search provider on `ctx.web` of a Team Runner. What it sends is the query and the source bound the tool asked for, with the current device access token; what it does not send, because the protocol has no place for it, is a search credential, a provider name, or an address. The Control Plane decides whether this member may search, runs the search with the company's credential, and answers with the web service's result. Mount it in the `team` profile beside the account client whose token it reads, and select it with `searchProvider: team`.

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

Mount it after `dsh-team-account-client`, which owns the device credential this provider reads, and pin it on the web service.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: team
    fetchProvider: http
- name: '@deepseek-ai/dsh-web-search-team'
  config:
    controlPlaneUrl: https://dsh.company.com
    controlPlaneCa: /opt/company/control-plane-ca.crt
```

| Field | Default | Meaning |
|---|---|---|
| `controlPlaneUrl` | — | Origin of the company Control Plane |
| `controlPlaneCa` | — | PEM file holding the only certificates accepted for it |

`controlPlaneCa` names a PEM file, and is how a Runner reaches a Control Plane whose certificate no public authority signed. Its certificates replace the public authorities for Control Plane connections only. Absent, the Control Plane is verified like any other host. `controlPlaneUrl` has no default and the row fails to load without it; the desktop installer's generated profile patch writes it here from one deployment fact.

### The token is read per call

The account client refreshes the device access token, so a cached one would be the stale copy. That is also why no search credential comes here at all: the only thing this process holds is a short-lived proof of who is signed in. The provider always reports itself usable; whether this member may search is the Control Plane's decision, made on every call. Its `permitted()` asks `POST /team/web/access` for that decision, which `dsh-tool-web` reads once per session to offer the web switch only to a member who may use it; anything short of an explicit yes, including an unbound computer or an unreachable Control Plane, is no.

### Failures

Every failure is a `WebError` the `web_search` tool turns into a structured error the model can read. A refusal the Control Plane names maps to the code that tells a member what to do: an unbound or signed-out computer and `unauthenticated` are `WEB_PROVIDER_CREDENTIAL_MISSING`, `not-allowed` is a `WEB_PROVIDER_ERROR` saying an administrator has not allowed web search, `upstream-unavailable` is `WEB_PROVIDER_UNAVAILABLE`, `upstream-invalid` and `update-required` are `WEB_PROVIDER_ERROR`, and `cancelled` is `WEB_ABORTED`. A Control Plane that cannot be reached, a reverse-proxy error page, an answer that is not an object, and a refusal word this build does not know are all `WEB_PROVIDER_UNAVAILABLE`, because from a member's seat those are one fact. A success answer missing a field is `WEB_PROVIDER_ERROR`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Every field of an answer is validated at the wire before it becomes a search result: a source without a string URL fails the call, while a mistyped optional title, snippet, or date is dropped. The Control Plane is trusted to decide, not to be well formed. The path, the header, the protocol version, and the refusal set are imported from `dsh-web-search-gateway-http`, so the two sides share one vocabulary.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The provider: the call, the wire validation, and the failure mapping |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-web-search-gateway-http](../web-search-gateway-http/README.md) — the route this provider calls, and the decision it makes.
- [Web subsystem](../../../docs/subsystems/web.md) — the vocabulary this provider speaks.
- [dsh-knowledge-team](../../knowledge/knowledge-team/README.md) — the same shape for private knowledge.
- [Team web search Agent Note](../../../.agents/notes/implemented/feature/2026-09-15-team-web-search-through-the-control-plane.md) — why the credential never reaches a Runner.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which owns the `web_search` schema, its guidance, and the rendering of sources. This provider contributes no prompt and registers no schema.

#### KV Cache effect

None of its own; the named consumer owns the request-prefix effect of the tool.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is incomplete on its own. They are current package constraints.

- **No offline search** — a Runner that cannot reach the Control Plane has no web search, deliberately: the credential lives there.
- **No retry** — one attempt per call; whether a transient failure is worth retrying belongs to the caller that knows what the member is waiting for.
- **No fetch** — page fetching stays on the Runner through `dsh-web-fetch-http`; only search goes through the Control Plane.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the provider holds nothing between calls and publishes no event stream; that no search credential or address exists in this process to leak is an absence, which the package's tests assert by inspecting the requests it actually sends.
