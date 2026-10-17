---
description: "The SQLite-backed governed GMO gateway: the durable category catalog, reconciliation against the source, access-control registration, per-operation authorization, and audit."
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-gateway-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-gmo-gateway-sqlite` implements `ctx.gmoGateway` over SQLite. It holds the durable category catalog, reconciles it against one successful listing of the source, registers each category as a governed resource in access control, authorizes every member-facing operation against current grants before the source is asked anything, and records one audit row per operation. The catalog records what a category is and nothing about what anyone asked it: there is no column for a result, a figure, a filter, or a credential.

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

Mount it in the Control Plane after access control, audit, and a `ctx.gmoSource` provider.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-gmo-gateway-sqlite'
  config:
    path: gmo.sqlite
```

| Field | Default | Meaning |
|---|---|---|
| `path` | none, required | Path to the catalog database |
| `journalMode` | `wal` | SQLite journal mode; use a rollback journal on a filesystem that cannot hold WAL's shared-memory file |
| `busyTimeoutMs` | `1000` | How long a statement waits for another connection's lock |
| `defaultResultPageSize` | `20` | How many results one listing page holds when a caller names no size |

### Synchronization

`sync` runs on an administrator's request, serialized: concurrent callers join the operation already in flight. One successful full listing applies these rules. A category not known before registers a managed resource and starts **switched off**. A known category updates its name and result count without changing its reference, resource, or grants. A category missing from a successful listing is retired with its resource and every grant naming it. A manual enable or disable is never overridden. A listing that fails leaves the last snapshot in place and records the failure word on the source.

### Authorization

Every member-facing operation resolves its category against the catalog and asks access control for `gmo.query` on that category's resource, fresh, before the source is called. An unknown, disabled, and unauthorized category are one refusal, recorded the same way, so a member holding nothing cannot learn that one exists. A result reference is then placed by the source, and a source that disagrees about the category refuses the operation with nothing read; an answer the source attributes to another category is dropped unread.

### Audit

One row per operation: `gmo.results`, `gmo.describe`, `gmo.ask`, and `gmo.catalog.sync`. A row carries the category reference, the kind of question, an item count, and a closed failure label. Names, columns, filters, and figures never enter it.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Two databases cannot commit together. Access control stays authoritative for roles, grants, and resources; this catalog records what a category is. Reconciliation is idempotent and repeated, so a write that failed after the first of the pair is repaired by the next synchronization rather than left as a permanent disagreement.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The gateway, its config, synchronization, authorization, and audit |
| [`src/schema.ts`](src/schema.ts) | The tables, the schema version, and the application id check |

### Data model

`gmo_source` holds one row per configured source with how the last listing went; `gmo_category` holds one row per category with its reference, upstream key, display name, result count, the administrator's enablement bit, and when it was last discovered. The schema version is monotonic and a database written by any other build is refused rather than migrated, which is this repository's pre-release stance on durable formats.

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the vocabulary and the failure taxonomy.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — the invariants this package enforces.

<a id="model-experience"></a>
## Model Experience

None, as the gateway runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it; figures become model-visible only after this gateway authorizes them and a Runner-side tool renders them.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **Two stores cannot commit together** — an interrupted write between the catalog and access control leaves a row the next synchronization repairs; until then a row without its managed resource is hidden rather than shown as governed.
- **Authorization evaluates once per category** — the directory asks access control per category, which is fine at tens of categories; a later bulk operation must keep per-resource evaluation.
- **No migration** — a database of another schema version is refused; rebuilding costs one synchronization and the administrator's enablement choices.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The reconciliation, catalog, and authorization code is a third copy of the knowledge and BI gateways', and `pnpm run duplication` reports the clones. Extracting a shared governed-catalog helper is the follow-up: it touches shipped knowledge and BI code that no recorded-session test covers, which is why this change did not.

</details>

**Runtime invariant:** No companion is published: the package owns a SQLite file whose schema version and application id it checks on open, and the relation between the catalog and access control is repaired by synchronization rather than asserted at runtime.
