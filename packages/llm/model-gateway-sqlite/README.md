---
description: "SQLite-backed model gateway: the catalog store, and the authorization and reservation in front of it."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-gateway-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-model-gateway-sqlite` keeps the [company model catalog](../model-gateway/README.md) in one SQLite database and makes the decision in front of it: is there such a model, may this principal invoke it, and is there budget. Registering a model also governs it in access control, in the same call — a catalog entry access control does not know about is a model no grant can name and nobody can ever invoke.

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
  '@deepseek-ai/dsh-model-gateway-sqlite':
    path: ./models.sqlite
```

It injects `accessControl` and `quota`, so both must be mounted before it. There is no configuration for what a model is: the catalog is filled by an administrator, not by a config file.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Registering and governing are one act

`register` writes the catalog row and registers the same model as a governed resource. `setStatus` moves both, so a retired model is refused by access control as well as here — whichever entry point a request arrives at.

### The catalog holds a reference, never a secret

The credential reference is a key into the credential provider. Reading this database yields nothing anyone could spend, and rotating a credential changes nothing here.

### The order of the three decisions

A model nobody may discover is refused as `unknown-model` before anything else runs. An authorized model with no budget is refused *after* the authorization it passed, so an administrator reading an audit trail can tell "not allowed" from "out of money". The reservation is taken last, so a refused request holds nothing.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The catalog operations and the three decisions |
| [`src/schema.ts`](src/schema.ts) | The table, its constraints, and the pragma guards |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`model-gateway`](../model-gateway/README.md) — the Service Definition and the body rewrite.
- [Model-gateway subsystem](../../../docs/subsystems/model-gateway.md) — the whole decision in prose.
- [`access-control-sqlite`](../../access/access-control-sqlite/README.md) — where a model becomes a governed resource.

<a id="model-experience"></a>
## Model Experience

None, as the gateway is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **`discover` asks access control once per model** — fine at the catalog sizes this version targets, and a bulk decision is the access-control seam's to offer rather than this one's to work around.
- **No price metadata** — the catalog carries an output ceiling, not a rate, so the ledger counts tokens rather than money.
- **A model is never deleted** — `setStatus` retires it, because grants, reservations, and settlements reference the ref.
- **Schema version 2 is refused in both directions** — `input_modalities` is a JSON-array column with a non-empty CHECK, and a file at any other `user_version` is refused at open rather than migrated; before the first tagged release a deployment recreates the catalog and registers its models again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests run against real access-control and quota compositions rather than stubs. What is worth testing is the order of the three decisions and what each refuses, and a stub would only replay whatever the test told it to.

</details>

**Runtime invariant:** No companion is published: what the catalog must hold (one row per stable ref within an organization, a positive output ceiling, and a status the word list governs) is declared to SQLite as a primary key and CHECK constraints, so a violating write is refused.
