---
description: "SQLite-backed audit trail: an append-only event table whose every text column holds a catalog word or a short token, so task content has nowhere to land."
kind: "package-reference"
---

# @deepseek-ai/dsh-audit-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-audit-sqlite` stores the [audit trail](../audit/README.md) in one SQLite database. It is where the privacy claim stops being a convention: the schema seeds both catalogs into tables and references them with foreign keys, declares the token rule again as a `CHECK` on every text column, and refuses `UPDATE` and `DELETE` with triggers. A caller that opened the file directly, bypassing the service, still cannot store a prompt or rewrite what is already stored.

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
plugins:
  '@deepseek-ai/dsh-audit-sqlite':
    path: ./audit.sqlite
    maxQueryRows: 500
```

`maxQueryRows` caps every read. A reader asking for more is served this many; a reader asking for fewer is served what it asked for.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The schema states the rules a second time

| Column | What constrains it |
|---|---|
| `action` | Foreign key to the seeded action catalog |
| `outcome`, `reason` | `CHECK … IN`, rendered from the word lists the definition exports |
| `org_id`, `principal_id`, `resource_id`, `device_id`, `correlation_id` | `CHECK`: 1–64 characters, `NOT GLOB '*[^A-Za-z0-9._:@-]*'` |
| `audit_event_metadata.key` | Foreign key to the seeded metadata key catalog |
| `audit_event_metadata.value_text` | The same token `CHECK` |

There is no `resource_type` column: the action fixes it, so the catalog holds it once and a query that filters on it joins. A denormalized copy would be a text column nothing constrains.

### Append-only, at the database

Four triggers abort `UPDATE` and `DELETE` on both tables. `seq` is `AUTOINCREMENT` rather than a rowid alias, so a deleted maximum could never be handed out again even if a future migration lifted a trigger.

### Seeding is additive

An action or key this build no longer knows stays in its catalog table, so the events referencing it keep their foreign key. The code catalogs — not these tables — are what stop it being recorded again, and a read drops a metadata key the running build has retired rather than surfacing a value no consumer declares.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The service: record, query, and the row-to-event mapping |
| [`src/schema.ts`](src/schema.ts) | Tables, constraints, triggers, and catalog seeding |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`audit`](../audit/README.md) — the Service Definition and the catalogs this backend seeds.
- [Audit subsystem](../../../docs/subsystems/audit.md) — the vocabularies and the storage rules in full.
- [`access-control-sqlite`](../access-control-sqlite/README.md) — the sibling store, with the same schema-version and application-id handling.

<a id="model-experience"></a>
## Model Experience

None, as the audit trail is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **Retention cannot be implemented by deleting rows** — the triggers refuse it by design. Enforcing a retention window needs a documented privileged path, such as dropping a trigger inside a schema migration.
- **A record is not written in the same transaction as the change it describes** — the audit database is separate from the account and access-control databases, so an operation and its record commit independently.
- **`policy_revision` is stored as a SQLite integer** — the same 53-bit ceiling the account store's revision counter already lives with.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests open a second connection to the same file and write raw SQL on purpose. The claim under test is not that the service declines to store a prompt, but that the database does; a test that only went through the service would pass against a schema with no constraints at all.

</details>
