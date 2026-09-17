---
description: "The BI-analysis service (ctx.bi): the stable project and chart references, the authorized project directory, saved-chart listing and run vocabulary, the Session BI scope, and the closed failure taxonomy."
kind: "package-reference"
---

# @deepseek-ai/dsh-bi

English | [中文](README.zh.md)

## Summary

`dsh-bi` (`ctx.bi`) is the seam a Team Runner asks for the BI projects its signed-in member may analyze. It defines three operations — read the authorized project directory, list one project's saved charts, run one saved chart — plus the two governed references, the `bi/scope` Session event, and the closed failure set. It makes no network call: a mounted provider does, and in Team Edition that provider forwards to a Control Plane that authorizes every operation. No operation names a source, passes an upstream id, or carries a query of the caller's own, so this service alone reaches nothing.

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

A composition that needs BI analysis mounts a provider, which registers this service; plugin and tool authors then call `ctx.bi.catalog()`, `ctx.bi.charts()`, and `ctx.bi.query()`. No call takes a source, an address, or a credential, because none is the caller's to choose.

### When to choose it

Import it to build a BI provider, a model-facing BI tool, or anything that must read the Session's BI scope. A deployment that only wants the shipped behavior gets it through the Team profile instead. The service registers no model-facing tool and contributes no prompt of its own: without a mounted provider, every operation is absent rather than empty.

### Minimal configuration

The service has no configuration — it is an abstract seam. A provider row supplies whatever a deployment varies:

```yaml
- name: '@deepseek-ai/dsh-bi-team'
  config:
    controlPlaneUrl: https://dsh.example.com
```

### Naming a project

`BiProjectRef` is `<providerKind>:<sourceCode>:<upstreamId>` and is the only project identifier that leaves the Control Plane. Build one with `formatBiProjectRef` and read one back with `parseBiProjectRef`; the second returns `undefined` rather than throwing, because its callers are deciding whether to accept a value rather than diagnosing one.

The reference is bounded at 64 characters over the audit token alphabet, which is why `formatBiProjectRef` refuses a source code longer than 19 characters. That is not a stylistic cap: the audit store's `resource_id` carries the same rule, so a longer reference would be one no operation could ever record. The source-code bound is the one private knowledge derived, kept equal so one deployment source code serves both catalogs.

### Naming a chart

`BiChartRef` is `<BiProjectRef>/<upstreamChartId>`, built with `formatBiChartRef` and read back with `parseBiChartRef`; `projectRefOf` and `upstreamChartIdOf` take a proved reference apart without a second parse. It is a brand of its own rather than a longer `BiProjectRef` because the two are bounded by different things: a project reference has to fit the audit token, and a chart is never an audit resource — what an operation on a chart records is the project it belongs to, which is also what a grant names.

The chart id is bounded at 64 characters over the same alphabet, so a reference no operation could resolve is refused where it is built rather than after a call.

### Reading the Session scope

`foldBiScope(events)` recovers the current scope from a Session log, and its `end` argument folds a prefix so rewind and fork read what the log said at that point. A log with no `bi/scope` event folds to `off`, which is where every Session starts. `projectOf` answers the recorded project, or `undefined` for `off` so a caller does not build a request nobody asked for.

The scope names one project or none. There is no arm meaning "every project": charts in different projects answer unrelated questions, and one conversation analyzes one project.

### Failures

Every failure is a `BiError` carrying one `BiFailureReason`. Product surfaces switch on `reason` and supply their own localized text; no upstream response body reaches either. `not-allowed` deliberately covers an unknown project as well as an unauthorized one, so a refusal never confirms that a project exists to a principal holding nothing on it.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The seam names product operations, never upstream ones. A transparent passthrough would let a caller choose operations the permission catalog and audit vocabulary do not govern, so the operation set is fixed and small, and each operation is one a Control Plane can authorize against current state. A saved chart runs as it was saved: the run takes a row bound and nothing else, so no filter, parameter, sort, or SQL of the caller's own reaches a warehouse.

Scope lives in the Session log and nowhere else. It reaches the model twice — as prompt text naming the chosen project, and as whether the BI tools exist at all — so recording it anywhere else would make the log insufficient to reconstruct what the model saw.

### Source map

| File | Holds |
|---|---|
| [`src/brand.ts`](src/brand.ts) | `BiProjectRef`, `BiChartRef`, their grammar, and the audit-token bound that shapes them |
| [`src/types.ts`](src/types.ts) | Directory, chart listing, chart run, scope, and failure vocabulary |
| [`src/error.ts`](src/error.ts) | `BiError`, the one failure a BI operation raises |
| [`src/scope.ts`](src/scope.ts) | The `bi/scope` Session event, its fold, and its validator |
| [`src/index.ts`](src/index.ts) | The `Bi` service definition |

### Data model

A `BiProjectEntry` is what a principal may analyze, named for a reader. A `BiChartSummary` is one saved chart in one of them, carrying its governed reference, the space it sits in, its description, and its `BiChartKind` — the source's own word for the picture, closed so a tool schema can enumerate it, with `other` for a kind this build does not know. A `BiQueryResult` is what one run answers: the chart's fields in row order, its saved filters as one line of text, the rows as raw cells, the row count the source reported, and whether rows or cells were cut. Cells are raw values rather than the source's formatted text, because a model charts and compares numbers and a formatted string would have to be parsed back. A `BiScope` is a versioned discriminated union; its `selected` arm records a display name beside the project reference, snapshotted at the moment of choice, because a model-visible name has to be reconstructable from the log.

<a id="further-exploration"></a>
## Further Exploration

- [BI subsystem](../../../docs/subsystems/bi.md) — the directory, chart listing, chart run, scope, and failure contracts in full.
- [Team BI analysis Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — why BI stays behind the Control Plane, and what the first delivery leaves out.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the BI tool package, which renders chart listings and rows to the model and contributes the scope prompt section. This service contributes no prompt and registers no schema.

#### KV Cache effect

No direct invalidation. The named consumer owns the request-prefix change a scope choice causes, which is real: changing scope changes both a prompt section and the tool list, so the following request re-reads its prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is incomplete on its own. They are current package constraints.

- **No provider yet** — the seam has no Service Provider, model-facing tool, browser Remote, or Control Plane gateway in this build; those arrive in the deliveries the [Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) orders. Until then, mounting nothing leaves every operation absent.
- **Saved charts only** — nothing here runs a query of the caller's own, reads a dashboard, or overrides a chart's filters, parameters, or sorts. Each of those is a separate authorization decision the permission catalog does not yet carry.
- **One project per scope** — the scope names one project or none, and a conversation that needs another project changes its scope rather than widening it.
- **No provider registry** — one provider mounts the service, and there is no selection policy, availability query, or provider-change event. A second provider kind would need one, and the `BiProjectRef` grammar leaves room for it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the seam owns no registry and observes no stream of its own; scope is a fold over the Session log, which `dsh-session` already holds to, and every authorization relationship this capability depends on lives in the Control Plane rather than in this process.
