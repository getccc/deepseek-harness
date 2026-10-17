---
description: "The upstream GMO-source seam (ctx.gmoSource): listing a source's categories and one category's results, placing and describing a result, and asking one already-authorized result a question, in upstream terms."
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-source

English | [中文](README.zh.md)

## Summary

`dsh-gmo-source` (`ctx.gmoSource`) is the seam a governed GMO gateway speaks to the upstream GMO supply-chain service through. Its operations — list a source's categories, list one category's results, place a result in its category, describe a result, ask a result a question — are in upstream ids rather than `GmoCategoryRef`s, because mapping between the two is the catalog's job. It mounts in the Control Plane alone. No operation takes a URL, a header, or a statement of the caller's own, so the gateway in front of it cannot reach an operation the permission catalog does not govern.

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

A Control Plane composition mounts one provider, which registers this service; the governed gateway then calls `ctx.gmoSource.listCategories()`, `listResults()`, `placeResult()`, `describeResult()`, and `ask()`.

### When to choose it

Import it to write a provider for a GMO source, or to consume one. A Runner never mounts it: the point of the split is that the process holding a member's session holds no source credential.

### Minimal configuration

The seam has no configuration. A provider row supplies whatever a deployment varies:

```yaml
- name: '@deepseek-ai/dsh-gmo-excel-tools'
  config:
    sourceCode: gmo
    baseUrl: http://10.1.120.90:8700
    credentialRef: EXCEL_TOOLS_GATEWAY_TOKEN
```

### What a provider owes its gateway

`providerKind` and `sourceCode` are the first two segments of every `GmoCategoryRef` the catalog mints from this source. The kind is a constant of the provider, because it names the code that speaks the protocol; the source code is configuration, because one company's `prod` is another's `gmo`.

`listCategories` answers keys the governed reference grammar accepts, and `listResults` and every description answer result ids the result reference accepts, refusing a row with anything else as `upstream-invalid`; that is what lets the gateway mint references without a second guard. `placeResult` answers the category the source says holds a result, cheaply and without reading a figure, which is what the gateway authorizes before it asks anything. `describeResult` and `ask` receive a category the gateway already authorized and the source already agreed on, and every answer names the category the source attributes it to so the gateway can check it again.

Failures are raised as `GmoError` with `upstream-unavailable`, `upstream-invalid`, `result-unavailable`, `unsupported`, `invalid-query`, or `too-large`. A provider never raises an authorization reason: it does not know who is asking, which is the point.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Two seams rather than one. The Runner-facing `ctx.gmo` names what a member wants; this one names what a source can do. Keeping them apart is what lets the gateway between them be the only party that maps a governed reference to an upstream id, and the only party that decides whether it may.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `GmoSource` service definition and its upstream vocabulary |

### Data model

`UpstreamCategory` carries the source's name for the category and, when it says, how many results it holds. `UpstreamResult` carries a result's name, tool, period, row count, creation time, and the steps of a multi-step result, each addressable on its own. `UpstreamDescription` is the domain description without the governed references, plus the upstream ids. `UpstreamAnswer` is the source's bounded JSON, already without its own bookkeeping, beside the category it names.

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the governed vocabulary this seam feeds.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — why the credential stays on the Control Plane.

<a id="model-experience"></a>
## Model Experience

None, as the seam runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is incomplete on its own. They are current package constraints.

- **Two reads per question** — `placeResult` answers where a result sits so the gateway can authorize it, and `ask` runs against that category. Each is correct on its own and neither trusts the other's copy.
- **No provider registry** — one provider mounts the service. Several sources in one Control Plane need a registry and a selection policy; the source-code segment of the reference leaves room for it, but nothing consumes that room yet.
- **Questions from a closed vocabulary only** — nothing here runs a statement of the caller's own.
- **Listings are one page at a time** — a category's results are paged by the caller, and the source reports a total, with no change cursor.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the seam owns no registry and publishes no event stream; a provider's own bounds are enforced on each call, and authorization of a question belongs to the gateway, which is the party that authorized it.
