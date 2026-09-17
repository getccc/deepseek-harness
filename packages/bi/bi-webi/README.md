---
description: "The webi BI-source provider: the four fixed routes a Control Plane calls, per-operation API-key resolution, row and cell bounds, the asynchronous run, and closed failure mapping."
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-webi

English | [中文](README.zh.md)

## Summary

`dsh-bi-webi` provides `ctx.biSource` over a webi deployment, a Lightdash-derived BI server. It is the one place in a Control Plane that holds a BI credential and speaks a BI product's protocol: it calls four fixed routes, resolves the personal access token per operation, runs a saved chart as it was saved, bounds what comes back, and maps every failure onto a closed reason. It knows nothing about who is asking; the governed gateway in front of it has already decided that. Mount it in the Control Plane only.

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

Mount it in a `team-control-plane` composition beside the governed BI gateway that consumes it.

### When to choose it

Choose it when a deployment's BI system is webi. A deployment with another BI product writes another provider against the same seam; nothing above this package changes.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-bi-webi'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8100
    credentialRef: WEBI_API_KEY
```

| Field | Default | Meaning |
|---|---|---|
| `sourceCode` | — | This deployment's code for the source, the second `BiProjectRef` segment |
| `baseUrl` | — | Origin the webi API is served from |
| `credentialRef` | — | Credential reference resolving to a webi personal access token |
| `requestTimeoutMs` | `30000` | How long one upstream HTTP call may take |
| `maxRows` | `500` | The most rows one run may return |
| `maxCellChars` | `200` | The most characters one text cell may carry |
| `maxCharts` | `500` | The most charts one project listing may read |
| `pollIntervalMs` | `500` | How long to wait between two reads of a run that is not ready yet |
| `queryTimeoutMs` | `60000` | How long one run may take before it is abandoned and stopped upstream |

`sourceCode`, `credentialRef`, and `baseUrl` are validated at plugin load. A source code is bounded at 19 characters over the audit token alphabet, because it is the part of a `BiProjectRef` a deployment chooses and the reference as a whole must fit what the audit store will record.

### Use an administrator's token, made for this deployment

webi authenticates with `Authorization: ApiKey <token>`, a personal access token whose reach is its owner's. A project grant in DSH covers every space in the project, private ones included, and webi shows a private space to its direct members and to organization administrators — so the token belongs to a webi organization administrator created for this deployment, not to a person, and the provider applies no space filter. A token that reaches less than the whole project would make a grant silently narrower than the administrator made it.

### Bounds and cost

A run reads one page of `maxRows` rows and reports how many rows the source produced, so a reader knows when the page is a cut. Text cells are cut at `maxCellChars` and the result says so. A chart listing reads one page of `maxCharts` charts and says when the source holds more; the keyword a member narrows by is the gateway's, applied over that listing.

Runs are asynchronous upstream: the provider starts one, then reads its state every `pollIntervalMs` until it is ready, up to `queryTimeoutMs`. A run that does not finish in time, and one whose caller stops waiting, is stopped upstream on a best-effort basis so the warehouse does not keep working for nobody.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Nothing upstream is forwarded that a decision did not put there. The provider reads a project's id, name, type, and warehouse; a chart's id, name, space, description, kind, and timestamps; and a run's fields, filters, and raw cells. Every other field webi returns is dropped. A field reaching a model or an audit row because it happened to be in a response is the failure mode this shape exists to prevent.

### Source map

| File | Holds |
|---|---|
| [`src/wire.ts`](src/wire.ts) | The routes, the envelopes, and the envelope readers |
| [`src/index.ts`](src/index.ts) | The provider: config validation, the operations, the run loop, bounds, and failure mapping |

### The routes

`GET /api/v1/org/projects` lists the projects the token's organization holds. `GET /api/v2/content?projectUuids=&contentTypes=chart&page=1&pageSize=` lists one project's saved charts, newest first, with a ready-made `chartKind` and a pagination block whose `totalResults` says whether the bound cut the listing. `GET /api/v1/saved/{uuid}` is one chart's own record, and the only place the project holding it comes from; its `chartConfig` decides the kind through `chartKindOf`, which reads a cartesian chart's series and layout the way the listing does.

`POST /api/v2/projects/{project}/query/chart` starts a run. Its body names the chart and nothing else — no filter, parameter, sort, or limit of this process's own reaches the warehouse — and answers the run's id, the saved query, and the field map. `GET /api/v2/projects/{project}/query/{query}?page=1&pageSize=` then answers `pending`, `ready` with rows, `error`, or `cancelled`; `POST …/cancel` stops a run nobody waits for.

Columns follow the saved query: dimensions, then metrics, then table calculations, then whatever else the field map holds; a run whose query and field map both say nothing takes the first row's own keys. A cell is the value's `raw`, bounded when it is text; a value webi formatted but did not type is rendered by its `formatted` string. The saved filters are rendered as one line, `field operator values`, groups joined by the word that names them and a rule the author switched off left out.

### Failures

Both envelopes are decoded: `{ status: 'ok', results }` on success, and `{ status: 'error', error: { statusCode, name, message } }` on failure. Only `statusCode` is read. `name` and `message` are upstream prose that can name an internal address, and they never leave this package.

A `401`, `403`, `429`, or `5xx` is `upstream-unavailable`: a misconfigured token, a revoked token, and a rate limit are all "this source is not answering us right now" to the member waiting on it. A `404` is `chart-unavailable` on the chart routes and `upstream-invalid` elsewhere. A run the warehouse failed or the source cancelled is `query-failed`. A caller's own abort is `cancelled`, told apart from the source failing.

<a id="further-exploration"></a>
## Further Exploration

- [BI subsystem](../../../docs/subsystems/bi.md) — the governed vocabulary this provider feeds.
- [Team BI analysis Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — why the credential and the upstream address stay here.

<a id="model-experience"></a>
## Model Experience

None, as the provider runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here. Rows become model-visible only after a gateway authorizes them and a Runner-side tool renders them, which is where their prefix cost lands.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is incomplete on its own. They are current package constraints.

- **Fixtures are a recording, not a contract the source promises** — the unit fixtures carry the envelopes and rows the deployment answered when they were recorded, and the real e2e (`tests/webi.e2e.ts`, gated on `WEBI_BASE_URL` and `WEBI_API_KEY`) replays the four routes against it. A webi upgrade needs a named owner who runs that e2e and re-reads the routes.
- **A run reads one page** — rows past `maxRows` are reported as a count, never read; nothing here carries an offset.
- **The saved chart's own limit still runs** — the warehouse executes the chart as saved, however many rows that is, and this provider reads a bounded page of the result. A chart saved without a limit costs the warehouse what it costs.
- **No dashboards, parameters, or ad-hoc queries** — the run route accepts a chart id alone; dashboard-scoped runs, parameter values, and metric queries of the caller's own are separate authorization decisions this delivery does not make.
- **No incremental listing** — projects and charts are read whole, up to the bound, with no change cursor.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### The listing spells one kind `watefall`

webi's `ChartKind` enum spells the waterfall kind `watefall`. The provider reads that word as `waterfall`, so a reader of this build's vocabulary does not inherit the misspelling; a webi release that corrects it changes nothing here.

</details>

**Runtime invariant:** No companion is published: the provider holds no mutable state between calls and publishes no event stream; that every returned row came from the one chart the request named is enforced inside `runChart` and asserted by the package's contract tests.
