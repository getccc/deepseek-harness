---
description: "The SQLite catalog engine behind the governed knowledge, BI, and GMO gateways: reconcile a source listing into governed access-control resources, decide access on every operation, and record the audit row."
kind: "package-library"
---

# @deepseek-ai/dsh-governed-catalog-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-governed-catalog-sqlite` lets a Control Plane gateway keep a durable catalog of what a source governs. It reconciles the catalog against one listing, registers each entry as a governed resource in access control, asks access control fresh on every member operation, and writes the audit row. The knowledge, BI, and GMO gateways share it, so a fix to reconciliation or authorization lands once. It makes no source calls and defines no request grammar; each gateway supplies those and the columns it stores.

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

### When to use it

Use it in a gateway whose entries a source lists, an administrator switches on, and a role is granted one by one. `dsh-knowledge-gateway-sqlite`, `dsh-bi-gateway-sqlite`, and `dsh-gmo-gateway-sqlite` import it. A gateway that governs one resource, such as web search, needs no catalog and does not use it.

### Entry point

A gateway constructs one `GovernedCatalog` in its constructor and delegates to it:

```text
this.catalog = new GovernedCatalog(ctx, resolvedConfig, {
  name, table: 'gmo_category', sourceTable: 'gmo_source', refColumn: 'category_ref',
  resourceType, catalogResource, syncAction: 'gmo.catalog.sync', failureKey: 'gmoFailure',
  startsEnabled: false, listedColumns: ['result_count'],
  applySchema, source, describe, failureReason, unknownEntry, entry,
})
const row = await this.catalog.admit(principal, ref, 'gmo.query') // undefined when refused
```

`sync`, `view`, and `setEnabled` serve the administration page; `admit` and `authorizedEntries` serve member operations; `record` writes one audit row. `applyCatalogSchema` checks the file's application id and schema version when it opens. See [`src/types.ts`](src/types.ts) for every field the gateway supplies.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Two databases cannot commit together. Access control stays authoritative for roles, grants, and resources; the catalog records what an entry is. Reconciliation is therefore idempotent and repeated: a write that failed after the first of the pair is repaired by the next synchronization.

One synchronization lists the source, describes every entry before anything is written, retires the access-control resources of entries the listing dropped, writes the listing in one transaction, and registers the resources. A failed listing keeps the last snapshot and records a failure word on the source row. Concurrent callers join the synchronization in flight. A new entry starts switched on or off as the gateway says; a known entry keeps the administrator's choice.

`admit` returns the row only when the entry exists, is switched on, and access control allows the action now. An unknown, disabled, and ungranted entry are one outcome, so a member holding nothing cannot learn that an entry exists. `authorizedEntries` walks the catalog rows, never the resources of the type, because the catalog administration resource shares the type and a type-wide grant would otherwise admit it.

Table and column names come from the gateway's constants and are written into the SQL text. They are never request data.

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | `GovernedCatalog`: synchronization, switching, admission, listing, and the audit record |
| [`src/schema.ts`](src/schema.ts) | `applyCatalogSchema`: the application id and version check |
| [`src/types.ts`](src/types.ts) | The spec a gateway supplies, the rows, and the views |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-gmo-gateway-sqlite`](../../gmo/gmo-gateway-sqlite/README.md) — the smallest gateway built on it.
- [`dsh-knowledge-gateway-sqlite`](../../knowledge/knowledge-gateway-sqlite/README.md) — the largest, with search over several catalogs.
- [Access-control subsystem](../../../docs/subsystems/access-control.md) — the decision this engine asks for.
- [Audit subsystem](../../../docs/subsystems/audit.md) — the closed vocabularies a record is checked against.

<a id="model-experience"></a>
## Model Experience

None, as the engine runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it; catalog contents become model-visible only after a gateway authorizes them and a Runner-side tool renders them.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **Two stores cannot commit together** — an interrupted write between the catalog and access control leaves a row the next synchronization repairs; until then a row without its governed resource is hidden from the administration view.
- **One source per organization in the status view** — the source status reads the first source row of the organization; a second source would need a status per source.
- **No migration** — a database of another schema version is refused; rebuilding costs one synchronization and the administrator's enablement choices.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The engine replaced three copies of the same reconciliation and authorization code. The Runner-side composer controls and the Typert controllers of the three capabilities still repeat each other; their wire types differ by name on purpose, so they were left for their own change.

</details>

**Runtime invariant:** No companion is published: the engine owns no state beyond the SQLite file whose application id and schema version it checks on open, and the relation between the catalog and access control is repaired by synchronization rather than asserted at runtime.
