---
description: "The WeKnora knowledge-source provider: the two fixed endpoints a Control Plane calls, per-operation credential resolution, result bounds, and closed failure mapping."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-weknora

English | [中文](README.zh.md)

## Summary

`dsh-knowledge-weknora` provides `ctx.knowledgeSource` over a WeKnora deployment. It is the one place in a Control Plane that holds a knowledge credential and speaks a knowledge product's protocol: it calls two fixed endpoints, resolves the API key per operation, bounds what comes back, and maps every failure onto a closed reason. It knows nothing about who is asking; the governed gateway in front of it has already decided that. Mount it in the Control Plane only. Its contract is pinned against a live deployment's own OpenAPI document and responses, not the upstream Markdown, which describes an endpoint deployments do not serve.

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

Mount it in a `team-control-plane` composition beside the governed knowledge gateway that consumes it.

### When to choose it

Choose it when a deployment's private knowledge lives in WeKnora. A deployment with another knowledge product writes another provider against the same seam; nothing above this package changes.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-knowledge-weknora'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8080
    credentialRef: WEKNORA_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `sourceCode` | — | This deployment's code for the source, the second `KnowledgeRef` segment |
| `baseUrl` | — | Origin the WeKnora API is served from |
| `credentialRef` | — | Credential reference resolving to a WeKnora **space** key |
| `requestTimeoutMs` | `30000` | How long one upstream call may take |
| `maxSearchResults` | `20` | The most passages one search may return |
| `maxPassageChars` | `4000` | The most characters one passage may carry |

`sourceCode`, `credentialRef`, and `baseUrl` are validated at plugin load. A source code is bounded at 19 characters over the audit token alphabet, because it is the part of a `KnowledgeRef` a deployment chooses and the reference as a whole must fit what the audit store will record.

### Use a space key, not a platform key

WeKnora authenticates with `X-API-Key`. A **space** key is fixed to the space it belongs to; a **platform** key reaches any space and takes an `X-Tenant-ID` header to say which. A Control Plane holding a platform key could read knowledge outside the space it governs, so a deployment configures a space key — which is also why this provider has no tenant field: with a space key there is nothing to name.

### Bounds and cost

`maxSearchResults` is applied twice: as the upstream `match_count`, and again over the decoded results. The second application is not belt-and-braces. While WeKnora's context enrichment is on — and this provider keeps it on, because surrounding context is what partly stands in for a document read this delivery does not have — `match_count` is not a hard cap: the endpoint returns the top matches plus their parent, nearby, and relation chunks, so a request for ten answers with eleven.

`match_count` is also a global budget across the searched knowledge bases rather than a per-base one, so one base can fill the whole result set and crowd the others out.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Nothing upstream is forwarded that a decision did not put there. The provider reads `content`, `score`, `knowledge_title`, and `knowledge_base_id`, and drops every other field WeKnora returns. A field reaching a model or an audit row because it happened to be in a response is the failure mode this shape exists to prevent.

### Source map

| File | Holds |
|---|---|
| [`src/wire.ts`](src/wire.ts) | The endpoints, envelopes, error codes, and the two envelope readers |
| [`src/index.ts`](src/index.ts) | The provider: config validation, the two operations, bounds, and failure mapping |

### The two endpoints

`GET /api/v1/knowledge-bases` lists the space's knowledge bases. `POST /api/v1/knowledge-bases/{id}/hybrid-search` retrieves passages; its body's `knowledge_base_ids` overrides the scope, but the path still requires an id and that id must be a member of the list — a path id outside it is refused with `ErrNotFound`. The provider therefore puts an authorized id in the path and the full authorized set in the body, so the path can never widen scope.

### No loadable URL can come back

`hybrid-search` takes no `resource_urls` parameter. That switch exists only on WeKnora's chat and session endpoints, where `public` rewrites `resource://` references into loadable links, and none of those endpoints is on this path. Invariant 10 therefore rests on the retrieval endpoint having no way to produce a loadable upstream URL rather than on this provider asking it not to. A contract test asserts that no forwarded field carries an `http` or `https` URL, because a later WeKnora version could add the parameter or change its default.

Passages do carry `resource://` references, which nothing in this delivery can redeem, so the provider replaces them with a neutral placeholder rather than showing a model a scheme it cannot use, and drops chunks whose `chunk_type` is not `text`.

### Failures

Both envelopes are decoded: `{ data, success: true }` on success, and `{ error: { code, message, details }, success: false }` on failure — the second nests `AppError` rather than returning it flat, as the OpenAPI document declares. Only `code` is read. `message` and `details` are upstream prose that can name an internal address, and they never leave this package.

Availability and readability are the only two distinctions a caller can act on: a misconfigured key, a revoked key, and a rate limit are all "this source is not answering us right now" to the member waiting on it.

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge subsystem](../../../docs/subsystems/knowledge.md) — the governed vocabulary this provider feeds.
- [Team private knowledge Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — why the credential and the upstream address stay here.

<a id="model-experience"></a>
## Model Experience

None, as the provider runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here. Retrieved passages become model-visible only after a gateway authorizes them and a Runner-side tool renders them, which is where their prefix cost lands.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is incomplete on its own. They are current package constraints.

- **Multi-base retrieval needs one embedding model** — WeKnora's `knowledge_base_ids` spans several knowledge bases only when they share an embedding model, and the API declares no error for a set that does not. The provider reports `embeddingModelId` so the gateway can refuse a mixed set before calling; it does not fan out per model and merge, because scores from separate calls are normalized within their own rerank and are not comparable.
- **An unknown knowledge base id is silently ignored upstream** — a list mixing a real id with an unknown one answers `success` with results from the real base alone. The provider drops hits from bases the request did not name, but existence and authorization must be settled before the call, not after it.
- **No document read** — `list` and `search` are the whole surface. WeKnora's chunk endpoints are not called.
- **No chunk count** — the listing's `chunk_count` reads zero on knowledge bases whose chunks a search plainly returns, so this provider does not read it and nothing downstream carries one. `knowledge_count` and `processing_count` are taken as the listing gives them.
- **No incremental listing** — `list()` fetches everything; WeKnora offers no paging or change cursor on this endpoint.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### The published API documentation and a deployment disagree

WeKnora's repository Markdown describes a top-level `POST /knowledge-search` taking `knowledge_base_ids`, which a deployment does not serve; its search result omits fields deployments return; and it presents `AppError` flat rather than nested under `error`. The fixtures here are pinned against a deployment's own OpenAPI document and responses. An upgrade owner re-reads that document rather than the prose.

</details>

**Runtime invariant:** No companion is published: the provider holds no mutable state between calls and publishes no event stream; that every returned passage came from a knowledge base the request named is enforced inside `search` and asserted by the package's contract tests.
