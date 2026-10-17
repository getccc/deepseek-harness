---
description: "The excel-tools GMO-source provider: holds the gateway token in the Control Plane and speaks excel-tools' fixed read-only routes, bounding items, time, and bytes."
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-excel-tools

English | [中文](README.zh.md)

## Summary

`dsh-gmo-excel-tools` is the one place in a Control Plane that holds an excel-tools gateway token and speaks its protocol. It registers on `ctx.gmoSource` and calls a fixed set of read-only routes of excel-tools' `/api/gateway`: the category list, a category's results, a result's placement and description, an aggregation, the ready-made dashboards, detail rows, and the supply-demand views. Nothing here knows who is asking; the gateway in front of it has already decided that.

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

Mount it in the Control Plane beside `dsh-gmo-gateway-sqlite`. The token is created on excel-tools' 管理 → 对话网关 page and stored under a credential reference; it reads statistics only and serves no export, download, deletion, upload, or tool run.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-gmo-excel-tools'
  config:
    sourceCode: gmo
    baseUrl: http://10.1.120.90:8700
    credentialRef: EXCEL_TOOLS_GATEWAY_TOKEN
```

| Field | Default | Meaning |
|---|---|---|
| `sourceCode` | none, required | This deployment's code for the source, the second segment of every category reference; at most 19 characters |
| `baseUrl` | none, required | Origin excel-tools is served from, `http` or `https` |
| `credentialRef` | none, required | Credential reference resolving to a gateway token |
| `requestTimeoutMs` | `60000` | How long one upstream call may take |
| `maxItems` | `200` | The most rows, groups, results, or ranked entries one request asks for |
| `maxResponseBytes` | `700000` | The most bytes of one answer this process reads |

A bad `sourceCode`, `credentialRef`, or `baseUrl` fails at load rather than at the first operation, because each makes every later call fail in a way that reads as an outage.

### What leaves the process

Every request carries `Authorization: Bearer <token>` and a request id, and nothing that names a person. The token is resolved per operation, so a rotation takes effect on the next call.

### Result ids and statuses

excel-tools names one step of a multi-step result `<id>~<stage>`. `~` is outside the reference alphabet, so this provider's own id spells it `.` and translates only when it builds a path, and it refuses an id that does not match `[0-9a-f]{32}(.[a-z0-9-]+)?` before any request leaves.

| excel-tools answers | Read as |
|---|---|
| `400`, `422` | `invalid-query` |
| `404` | `result-unavailable` on a result route, `upstream-invalid` on a listing |
| `409` | `unsupported` — the result exists and has no such view |
| `413`, or a body over `maxResponseBytes` | `too-large` |
| `401`, `403`, `429`, `5xx`, no answer | `upstream-unavailable` |
| anything else, or a body that is not JSON | `upstream-invalid` |

No upstream response text reaches a failure.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The provider calls a closed set of routes and translates; it does not interpret. A question reaches excel-tools as the gateway's own parameter names, with its limits clamped to `maxItems`, and the answer is returned as excel-tools produced it with only its `category` field taken out, so a figure is never recomputed or reformatted on the way.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The provider, its config, the request and failure mapping, and the readers of excel-tools' JSON |

### Data model

The readers validate the fields the gateway's vocabulary names and ignore the rest of excel-tools' JSON, with one exception: the aggregation, dashboard, and row answers pass through as the source's bounded JSON, because their fields depend on the question and the tool that asks describes them to the model.

<a id="further-exploration"></a>
## Further Exploration

- [excel-tools gateway](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md#excel-tools-gateway) — the routes this provider calls and why they are fixed.
- [GMO subsystem](../../../docs/subsystems/gmo.md) — the vocabulary the answers are read into.

<a id="model-experience"></a>
## Model Experience

None, as the provider runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it; figures become model-visible only after a gateway authorizes them and a Runner-side tool renders them.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **One token reaches every category** — excel-tools has no per-category token, so the Control Plane's per-category authorization is the only separation between categories.
- **Statements are not forwarded** — a question is one of three kinds and the source validates its columns against the result; nothing here composes a query.
- **Answers are cut by refusal, not truncation** — an answer over `maxResponseBytes` is refused as `too-large` and the member narrows the question.
- **No live contract test in CI** — the routes are pinned by scripted fixtures; a run against a real deployment is `tests/excel-tools.e2e.ts`, which needs `EXCEL_TOOLS_BASE_URL` and `EXCEL_TOOLS_TOKEN` and skips without them.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the provider owns no registry and emits no events; the bounds and the status mapping are asserted by the package's tests.
