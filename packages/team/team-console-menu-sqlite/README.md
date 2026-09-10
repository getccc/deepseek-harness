---
description: "SQLite-backed console menus: one database file holding an organization's administration navigation and the shipped entries it starts from."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-console-menu-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-team-console-menu-sqlite` stores the navigation [`dsh-team-console-menu`](../team-console-menu/README.md) defines in one SQLite database file, using Node's built-in driver — no external database process and nothing to install. Mount it in a Control Plane composition, point it at a path, and the administration console's tree — including every rename, reorder, and hidden entry — persists across restarts.

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

One configuration row is the whole setup:

```yaml
- id: team-console-menu
  name: '@deepseek-ai/dsh-team-console-menu-sqlite'
  config:
    path: /var/lib/dsh-team/menus.db
```

`path` accepts `:memory:` for an in-process database, which is what tests use. The file and its schema are created on first open. Seeding is a separate call the administration API makes, because this store does not know which organization a Control Plane serves.

### What it guarantees

Each write is a single statement, so each is already atomic; nothing here spans two tables. `listMenus` returns each entry immediately before its own subtree, with siblings in `sortOrder` and then insertion order, so the tree an administrator sees does not shuffle between reads.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Schema ownership

The database carries an application id and a monotonic `SCHEMA_VERSION`. Opening refuses a file another application stamped, and refuses one a newer build wrote — a downgrade cannot know what a column it has never seen means, so it stops rather than migrating down.

### Invariants live in the schema

A unique index on `(org_id, seed_key)` is what makes re-seeding on every start safe: a second insert of a shipped entry conflicts rather than duplicating the tree. A foreign key from `parent_id` back to the table keeps a child from naming an entry that is gone. Both are declared to SQLite, which is why the package's invariant companion installs nothing.

The organization is named by id and not joined to: accounts live in the account store's own database, and an entry outliving the organization it names is exactly the relation this file cannot enforce.

### A rename drops the shipped copy key

`updateMenu` clears `label_key` whenever it writes a name, and leaves it alone for every other edit. That is what keeps a translated shipped entry translated until an administrator gives it words of their own.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The store implementation and its plugin config |
| [`src/schema.ts`](src/schema.ts) | DDL, row shapes, and version/application-id enforcement |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`team-console-menu`](../team-console-menu/README.md) — the contract this implements.
- [`team-admin-api`](../team-admin-api/README.md) — the routes that read and write through it.
- [`team-control-plane/`](../../bundle/team-control-plane/README.md) — the server profile this is composed into.

<a id="model-experience"></a>
## Model Experience

None, as the backend stores an administrator's navigation that no prompt section, tool, or request context reaches.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of this backend, not a task backlog.

- **One process at a time** — SQLite serializes writers within a file, so this backend suits the single Control Plane instance the deployment targets. Running two instances against one file is not supported; that is what a client/server database would be for.
- **Only additive schema changes carry themselves** — every statement is `CREATE ... IF NOT EXISTS`, so an older file gains what a newer build added and is stamped with the new version. A change that alters or drops an existing column has no path yet and must bring one.
- **A deleted shipped entry returns** — seeding matches on the shipped key, so an entry the product ships comes back at its shipped settings on the next start. Suspending or hiding it is what makes the removal last.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`node:sqlite` needs no dependency and is already the backend for the account store, access control, and audit in the same composition, so this package adds no driver to the repository. The store deliberately has no opinion about which organization exists: seeding takes the organization as an argument, and that argument comes from the one plugin whose config names it.

</details>

**Runtime invariant:** No companion is published: the durable relations this backend must hold (one row per shipped entry inside an organization, and a child naming an entry that exists) are declared to SQLite as a unique index and a foreign key, so the database rejects a violating write.
