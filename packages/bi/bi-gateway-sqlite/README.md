---
description: "The SQLite-backed governed BI gateway: the durable project catalog, synchronization against an upstream source, per-project authorization, and audit."
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-gateway-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-bi-gateway-sqlite` provides `ctx.biGateway` over a SQLite catalog. It mints the stable `BiProjectRef` for each upstream project, reconciles the catalog against a source, registers each project as a governed resource, evaluates access per project on every member-facing call, and records what happened. It runs in the Control Plane only. The catalog records what a project *is* and nothing about what anyone asked it: there is no column for a chart, a row, a query, or a credential.

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

Mount it in a `team-control-plane` composition after access control, audit, and a BI source.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-bi-gateway-sqlite'
  config:
    path: /var/lib/dsh/control-plane/bi.sqlite
```

| Field | Default | Meaning |
|---|---|---|
| `path` | — | Where the catalog database lives |
| `defaultChartPageSize` | `20` | How many charts one listing page holds when a caller names no size |
| `defaultMaxRows` | `200` | The most rows one run returns when a caller names no bound |

### Synchronization

One successful full listing is applied in a single transaction, then reconciled against access control. A new upstream id creates a row and registers an enabled governed resource. A known id updates the display name, the description, and the project's kind and warehouse without changing the reference, the resource id, or any grant. An id missing from a successful listing is retired: its governed resource is deleted first, taking every grant that named it, and then the row. A manual disable is never overridden by a sync.

A source that does not answer leaves the last successful snapshot in place and records the failure. One outage must not disable every project an organization governs. Concurrent callers join the reconciliation already in flight rather than racing two over the same rows.

### Authorization

Every member-facing call evaluates `bi.query` on the named project, freshly. An unknown project, a disabled one, and an unauthorized one produce the same refusal, recorded the same way, so a member holding nothing cannot learn that a project exists. The directory enumerates the durable catalog and joins it to managed resources, never the resources of the type, because the catalog administration resource shares it.

A chart listing authorizes the project, reads the whole listing from the source, narrows it by the caller's keyword over name, space, and description, and pages what matched. A run authorizes the project in the chart reference, asks the source where the chart sits, and refuses with `chart-unavailable` when the source's project disagrees, running nothing; only then is the chart run, with the caller's row bound or the deployment's.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Two databases that cannot commit together

Access control stays authoritative for roles, grants, and resources; this catalog records what a project is. Reconciliation is therefore idempotent and repeated: a write that failed after the first of the pair is discovered and repaired by the next synchronization rather than left as a permanent disagreement. In between, a catalog row with no governed resource is hidden rather than shown, because offering a role editor an id no grant could name is worse than showing one entry late.

### Source map

| File | Holds |
|---|---|
| [`src/schema.ts`](src/schema.ts) | The two tables, their constraints, and the application id and schema version |
| [`src/index.ts`](src/index.ts) | Synchronization, authorization, the listing, the run, and audit |

### What an operation records

One audit row per operation — `bi.charts`, `bi.query`, or `bi.catalog.sync` — carrying identity, the governed project, the outcome, a bounded item count, and correlation. Upstream failures carry the closed `biFailure` label rather than a new audit reason. A chart's name, a row, and the keyword a member searched by have nowhere to land; a malformed chart reference names no project and is recorded against none.

<a id="further-exploration"></a>
## Further Exploration

- [BI subsystem](../../../docs/subsystems/bi.md) — the governed vocabulary.
- [Team BI analysis Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — the reconciliation rules and why a project grant covers private spaces.

<a id="model-experience"></a>
## Model Experience

None, as the gateway runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here. Rows become model-visible only after a Runner-side tool renders them, which is where their prefix cost lands.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is incomplete on its own. They are current package constraints.

- **One active instance** — a SQLite file supports one active Control Plane process with durable storage and backup. Horizontal replicas need a shared-database design rather than copies of this file.
- **Authorization iterates** — a directory evaluates once per project; a listing or a run evaluates once, for the one project it names. This is fine at tens of projects; a bulk access-control operation would have to preserve per-resource evaluation and policy-revision semantics rather than authorizing once for several.
- **A keyword reads the whole listing** — narrowing happens here, over the listing the source answered, so every chart listing costs one full upstream read up to the provider's bound.
- **Reconciliation is all-or-nothing per listing** — an entry whose reference cannot be minted, or whose row the catalog refuses, rolls the whole listing back, so one malformed upstream project blocks the others until the source is fixed.
- **Retirement is not reversible** — a project a successful listing stops naming is deleted along with its governed resource and every grant on it. A source that lists a subset of what it holds therefore costs an administrator the grants they made.
- **Nothing here schedules synchronization** — `sync` runs when a caller asks. Start-up and periodic reconciliation belong to the composition that knows which organization this Control Plane serves, which this package does not.
- **A schema version strands an existing file** — `SCHEMA_VERSION` is monotonic and refused in both directions, with no migration code. The grants and administrator switches in a file are what make deleting it the wrong answer; a bump needs a documented column repair.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### The reconciliation shape is shared with the knowledge gateway

Source row, serialized sync, all-or-nothing listing, retirement before rows, resource registration, and the audit record are the same mechanics `dsh-knowledge-gateway-sqlite` carries, written here against a project catalog rather than a knowledge-base catalog. The clone detector reports the shared stretches. Extracting one governed-catalog helper the two gateways parameterize is the follow-up; it touches the knowledge gateway and its tests, which is why it did not ride the change that added this package.

</details>

**Runtime invariant:** No companion is published: the provider publishes no event stream; that every returned row came from a chart in a project this request authorized is enforced inside `query` and asserted by the package's tests.
