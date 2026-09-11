---
description: "The SQLite-backed governed knowledge gateway: the durable catalog, synchronization against an upstream source, per-resource authorization, and audit."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-gateway-sqlite

English | [中文](README.zh.md)

## Summary

`dsh-knowledge-gateway-sqlite` provides `ctx.knowledgeGateway` over a SQLite catalog. It mints the stable `KnowledgeRef` for each upstream knowledge base, reconciles the catalog against a source, registers each base as a governed resource, evaluates access per knowledge base on every member-facing call, and records what happened. It runs in the Control Plane only. The catalog records what a knowledge base *is* and nothing about what anyone asked it: there is no column for a query, a passage, a filename, or a credential.

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

Mount it in a `team-control-plane` composition after access control, audit, and a knowledge source.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-knowledge-gateway-sqlite'
  config:
    path: /var/lib/dsh/control-plane/knowledge.sqlite
```

| Field | Default | Meaning |
|---|---|---|
| `path` | — | Where the catalog database lives |
| `defaultMaxResults` | `10` | The most passages one search returns when a caller names no bound |

### Synchronization

One successful full listing is applied in a single transaction, then reconciled against access control. A new upstream id creates a row and registers an enabled governed resource. A known id updates display metadata without changing the reference, the resource id, or any grant. An id missing from a successful listing becomes not-present and its resource is disabled — the row and its grants stay, because a temporary removal must not silently replace identity, and deleting the resource would delete every grant naming it. A returning id is restored, and is re-enabled only while an administrator's own switch is still on.

A source that does not answer leaves the last successful snapshot in place and records the failure. One outage must not disable every knowledge base an organization governs.

Concurrent callers join the reconciliation already in flight rather than racing two over the same rows.

### Authorization

Every member-facing call evaluates `knowledge.search` per knowledge base, freshly. `all` expands to what the principal currently holds; `selected` authorizes each named reference and refuses the whole request on the first failure. An unknown reference and an unauthorized one produce the same refusal, so a member holding nothing cannot learn that a knowledge base exists.

A multi-base scope whose members do not share an embedding model is refused with `scope-incompatible` **before** the source is called. Cross-knowledge-base retrieval is defined only for bases that share one, and a source declares no error for a set that does not — so the behavior of such a call is unspecified, and unspecified upstream behavior must not become a silent product behavior.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Two databases that cannot commit together

Access control stays authoritative for roles, grants, and resources; this catalog records what a knowledge base is. Reconciliation is therefore idempotent and repeated: a write that failed after the first of the pair is discovered and repaired by the next synchronization rather than left as a permanent disagreement. In between, a catalog row with no governed resource is hidden rather than shown, because offering a role editor an id no grant could name is worse than showing one entry late.

### Source map

| File | Holds |
|---|---|
| [`src/schema.ts`](src/schema.ts) | The two tables, their constraints, and the application id and schema version |
| [`src/index.ts`](src/index.ts) | Synchronization, authorization, search, and audit |

### What a search records

One audit row per knowledge base a search covered, carrying identity, the governed resource, the outcome, a bounded result count, and correlation. Upstream failures carry a closed label rather than a new audit reason. The query and the passages it returned have nowhere to land.

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge subsystem](../../../docs/subsystems/knowledge.md) — the governed vocabulary.
- [Team private knowledge Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — the reconciliation rules and why absence disables rather than deletes.

<a id="model-experience"></a>
## Model Experience

None, as the gateway runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here. Passages become model-visible only after a Runner-side tool renders them, which is where their prefix cost lands.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is incomplete on its own. They are current package constraints.

- **One active instance** — a SQLite file supports one active Control Plane process with durable storage and backup. Horizontal replicas need a shared-database design rather than copies of this file.
- **Authorization iterates** — a directory and an `all`-mode search evaluate once per knowledge base. This is acceptable for a full-listing deployment; a bulk access-control operation would have to preserve per-resource evaluation and policy-revision semantics rather than authorizing once for several.
- **Reconciliation is all-or-nothing per listing** — an entry whose reference cannot be minted rolls the whole listing back, so one malformed upstream id blocks the others until the source is fixed.
- **Retirement is not reversible** — a knowledge base a successful listing stops naming is deleted along with its governed resource and every grant on it. A source that lists a subset of what it holds therefore costs an administrator the grants they made.
- **Nothing here schedules synchronization** — `sync` runs when a caller asks. Start-up and periodic reconciliation belong to the composition that knows which organization this Control Plane serves, which this package does not.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the provider publishes no event stream; that every returned passage came from a knowledge base this request authorized is enforced inside `search` and asserted by the package's tests.
