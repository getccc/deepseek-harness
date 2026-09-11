---
description: "SQLite-backed account store: one database file holding an organization and its member accounts, for deployments composing the Team Edition Control Plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-account-store-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-account-store-sqlite` stores the accounts [`dsh-account-store`](../account-store/README.md) defines in one SQLite database file, using Node's built-in driver — no external database process and nothing to install. Mount it in a Control Plane composition, point it at a path, and organizations and member accounts persist across restarts. The database declares its own invariants: a login name unique inside its organization, and an account that must belong to an existing organization, so a violating write is refused by SQLite rather than admitted for a later check to notice.

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
- id: account-store
  name: '@deepseek-ai/dsh-account-store-sqlite'
  config:
    path: /var/lib/dsh-team/accounts.db
```

`path` accepts `:memory:` for an in-process database, which is what tests use. The file and its schema are created on first open.

### What it guarantees

Each write is a single statement, so each is already atomic; nothing here spans two tables. `listUsers` returns accounts in insertion order, taken from SQLite's own row identity rather than a timestamp, so two accounts issued in the same millisecond still come back in the order they were created.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Schema ownership

The database carries an application id and a monotonic `SCHEMA_VERSION`. Opening refuses a file another application stamped, and refuses one a newer build wrote — a downgrade cannot know what a column it has never seen means, so it stops rather than migrating down.

### Invariants live in the schema

The `(org_id, login_name)` unique index and the foreign key to `organization` are the durable relations this backend must hold. Declaring them to SQLite means a violating write never lands, which is why the package's invariant companion installs nothing: there is no window in which a bad row exists to be found.

Only the login-name index becomes a seam error. Any other failure — a missing organization, a full disk — travels unchanged, so a caller is never told the wrong cause.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The store implementation and its plugin config |
| [`src/schema.ts`](src/schema.ts) | DDL, row shapes, and version/application-id enforcement |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`account-store`](../account-store/README.md) — the contract this implements.
- [Account package map](../README.md) — how this family is split.
- [`team-control-plane/`](../../bundle/team-control-plane/README.md) — the server profile this is composed into.

<a id="model-experience"></a>
## Model Experience

None, as the backend stores server-side identity that no prompt section, tool, or request context reaches.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of this backend, not a task backlog.

- **One process at a time** — SQLite serializes writers within a file, so this backend suits the single Control Plane instance the deployment targets. Running two instances against one file is not supported; that is what a client/server database would be for.
- **Only additive schema changes carry themselves** — every statement is `CREATE ... IF NOT EXISTS`, so an older file gains what a newer build added and is stamped with the new version. A change that alters or drops an existing column has no path yet and must bring one.
- **Policy revisions are read through `Number`** — the column is a 64-bit SQLite integer surfaced as `bigint`, but the read converts via a JavaScript number, so the value is exact only below 2^53. A revision counter will not reach it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`node:sqlite` needs no dependency and is already the backend for session persistence, session query, and storage, so this package adds no driver to the repository. A PostgreSQL backend for multi-instance deployments is a second provider behind the same Service Definition, not a change here.

</details>

**Runtime invariant:** No companion is published: the durable relations this backend must hold (a login name unique inside its organization, an account belonging to an existing organization) are declared to SQLite as a unique index and a foreign key, so the database rejects a violating write.
