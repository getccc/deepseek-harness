---
description: "The upstream BI-source seam (ctx.biSource): listing a source's projects and one project's saved charts, placing a chart in its project, and running one already-authorized chart, in upstream terms."
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-source

English | [中文](README.zh.md)

## Summary

`dsh-bi-source` (`ctx.biSource`) is the seam a governed BI gateway speaks to an upstream BI product through. Its operations — list a source's projects, list one project's saved charts, place a chart in its project, run a chart as it was saved — are in upstream ids rather than `BiProjectRef`s, because mapping between the two is the catalog's job. It mounts in the Control Plane alone. No operation takes a URL, a header, a filter, a parameter, or a caller's own query, so the gateway in front of it cannot reach an operation the permission catalog does not govern.

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

A Control Plane composition mounts one provider, which registers this service; the governed gateway then calls `ctx.biSource.listProjects()`, `ctx.biSource.listCharts()`, `ctx.biSource.describeChart()`, and `ctx.biSource.runChart()`.

### When to choose it

Import it to write a provider for a BI product, or to consume one. A Runner never mounts it: the whole point of the split is that the process holding a member's session holds no BI credential.

### Minimal configuration

The seam has no configuration. A provider row supplies whatever a deployment varies:

```yaml
- name: '@deepseek-ai/dsh-bi-webi'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8100
    credentialRef: WEBI_API_KEY
```

### What a provider owes its gateway

`providerKind` and `sourceCode` are the first two segments of every `BiProjectRef` the catalog mints from this source. The kind is a constant of the provider, because it names the code that speaks the protocol; the source code is configuration, because one company's `prod` is another's `bi`.

`listProjects` answers ids the governed reference grammar accepts, and `listCharts` answers chart ids the chart reference accepts — within `BI_CHART_ID_MAX_LENGTH`, over the reference alphabet — refusing a row with anything else as `upstream-invalid`. That is what lets the gateway mint references from them without a second guard. A chart listing is whole rather than paged, because the keyword a member narrows by is applied by the gateway over names the source does not index; the provider says when its own bound cut the listing short.

`describeChart` answers the project the source says holds a chart, which is what the gateway authorizes before it runs anything. `runChart` receives a project the gateway already authorized and the source already agreed on, and runs the chart as it was saved: it takes a row bound and nothing else.

Failures are raised as `BiError` with `upstream-unavailable`, `upstream-invalid`, `chart-unavailable`, or `query-failed`. A provider never raises an authorization reason — it does not know who is asking, which is the point.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Two seams rather than one. The Runner-facing `ctx.bi` names what a member wants; this one names what a source can do. Keeping them apart is what lets the gateway between them be the only party that maps a governed reference to an upstream id, and the only party that decides whether it may.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `BiSource` service definition and its upstream vocabulary |

### Data model

`UpstreamProject` carries the source's own words for the project's kind and its warehouse, which the catalog records for an administrator. `UpstreamChart` carries the kind of picture the chart draws, in the closed `BiChartKind` vocabulary, so a listing and a run agree on it. `UpstreamRun` is already in the terms the gateway forwards unchanged — fields in row order, the saved filters as text, raw cells, and the two truncation bits — because nothing about a run is the gateway's to reinterpret.

<a id="further-exploration"></a>
## Further Exploration

- [BI subsystem](../../../docs/subsystems/bi.md) — the governed vocabulary this seam feeds.
- [Team BI analysis Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — why the credential stays on the Control Plane.

<a id="model-experience"></a>
## Model Experience

None, as the seam runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is incomplete on its own. They are current package constraints.

- **Two record reads per run** — `describeChart` answers where a chart sits so the gateway can authorize it, and `runChart` starts the run against that project. Each is correct on its own and neither trusts the other's copy; a deployment that minded the second call would have to pass the chart's record across the seam instead.
- **No provider registry** — one provider mounts the service. Several sources in one Control Plane would need a registry and a selection policy; the `BiProjectRef` source-code segment leaves room for it, but nothing consumes that room yet.
- **Saved charts only** — nothing here runs a query of the caller's own, reads a dashboard, or overrides a chart's filters, parameters, or sorts.
- **No incremental listing** — `listProjects()` returns every project a source holds and `listCharts()` every chart of one project up to the provider's bound, with no paging or change cursor.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the seam owns no registry and publishes no event stream; a provider's own bounds are enforced on each call, and authorization of a run project belongs to the gateway, which is the party that authorized it.
