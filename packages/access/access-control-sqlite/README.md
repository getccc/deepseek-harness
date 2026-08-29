---
description: "SQLite-backed access control: roles, grants, governed resources, and the default-deny evaluation over them, for deployments composing the Team Edition Control Plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-access-control-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-access-control-sqlite` implements [`dsh-access-control`](../access-control/README.md) over one SQLite database, using Node's built-in driver — no external database process and nothing to install. It holds roles, groups, governed resources, and both grant shapes, and answers `authorize` with a single query over the principal's roles. The database declares the invariants rather than trusting the service to: grants carry a foreign key into the seeded permission catalog, so a grant naming a pair this build does not govern cannot be stored even by a caller that reached the database directly.

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

```yaml
- id: access-control
  name: '@deepseek-ai/dsh-access-control-sqlite'
  config:
    path: /var/lib/dsh-team/access.db
```

`path` accepts `:memory:` for an in-process database, which is what tests use. It needs `accountStore` mounted alongside it, because the organization's policy revision lives with the organization.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The evaluation is one query

`authorize` reads the resource by the identity a request names, refuses a disabled one, collects the principal's roles — direct and group-derived, unioned — and then matches type grants and resource grants in a single statement. A decision returns every grant that admitted it, which is what makes a refusal or an approval explainable without a second lookup.

### Invariants live in the schema

The permission catalog is seeded into a table on open, and both grant tables carry a foreign key into it. Seeding only inserts: a pair this build no longer governs stays in the table so existing grants keep their key, while the service's own check — which reads the code catalog, not this table — stops it being granted again. Deleting rows would break stored grants instead of retiring them.

`(org_id, type, external_ref)` is unique on resources, and `(role, target, action)` is unique on both grant tables, so granting the same pair twice yields one grant rather than two rows a decision would both name.

### The policy revision is not local

It lives with the organization in the account store, so one counter serves every cache. Every mutation here that can change an outcome advances it — including governing a resource, because a type grant some role already holds now covers one more thing. Creating a group binds no role and therefore does not.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The provider, the evaluation, and the mutations that advance the revision |
| [`src/schema.ts`](src/schema.ts) | DDL, row shapes, catalog seeding, and version enforcement |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`access-control`](../access-control/README.md) — the contract this implements.
- [Access-control subsystem](../../../docs/subsystems/access-control.md) — the evaluation rules in full.
- [`account-store-sqlite`](../../account/account-store-sqlite/README.md) — the sibling backend holding identity.

<a id="model-experience"></a>
## Model Experience

None, as authorization storage is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of this backend, not a task backlog.

- **One process at a time** — SQLite serializes writers within a file, matching the single Control Plane instance the deployment targets. Two instances against one file is what a client/server database would be for.
- **No migration path yet** — `SCHEMA_VERSION` is 1 and opening refuses a newer file, but nothing upgrades an older one. The first schema change must add that.
- **No decision cache** — every `authorize` reads the database. The policy revision exists so a caller can cache safely; this backend does not cache on its behalf.
- **Roles are not deleted** — nothing removes a role, because grants and bindings reference it. A deletion path needs those references decided first.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`node:sqlite` needs no dependency and is already the backend for session persistence, session query, storage, and the account store. A PostgreSQL backend for multi-instance deployments is a second provider behind the same Service Definition, not a change here.

</details>
