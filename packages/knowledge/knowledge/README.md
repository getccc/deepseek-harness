---
description: "The private-knowledge service (ctx.knowledge): the stable knowledge reference, the authorized directory and passage-search vocabulary, the Session knowledge scope, and the closed failure taxonomy."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge

English | [中文](README.zh.md)

## Summary

`dsh-knowledge` (`ctx.knowledge`) is the seam a Team Runner asks for the private company knowledge its signed-in member may reach. It defines two operations — read the authorized directory, search it for passages — plus the `KnowledgeRef` that names a knowledge base, the `knowledge/scope` Session event that records which knowledge a Session may use, and the closed `KnowledgeFailureReason` set. It holds no address, credential, tenant, or upstream identifier, and it makes no network call: a provider must be mounted, and in Team Edition that provider forwards to a Control Plane that authorizes every operation. The package is deliberately narrow — there is no operation for naming a source or passing an upstream id — so a plugin holding this service still cannot reach a knowledge source except through a decision made elsewhere.

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

A composition that needs private knowledge mounts a provider, which registers this service; plugin and tool authors then call `ctx.knowledge.catalog()` and `ctx.knowledge.search()`. Neither call takes a source, an address, or a credential, because neither is the caller's to choose.

### When to choose it

Import it to build a knowledge provider, a model-facing knowledge tool, or anything that must read the Session's knowledge scope. A deployment that only wants the shipped behavior gets it through the Team profile instead. The service registers no model-facing tool and contributes no prompt of its own: without a mounted provider, both operations are absent rather than empty.

### Minimal configuration

The service has no configuration — it is an abstract seam. A provider row supplies whatever a deployment varies:

```yaml
- name: '@deepseek-ai/dsh-knowledge-team'
  config:
    controlPlaneUrl: https://dsh.example.com
```

### Naming a knowledge base

`KnowledgeRef` is `<providerKind>:<sourceCode>:<upstreamId>` and is the only knowledge identifier that leaves the Control Plane. Build one with `formatKnowledgeRef` and read one back with `parseKnowledgeRef`; the second returns `undefined` rather than throwing, because its callers are deciding whether to accept a value rather than diagnosing one.

The reference is bounded at 64 characters over the audit token alphabet, which is why `formatKnowledgeRef` refuses a source code longer than 19 characters. That is not a stylistic cap: the audit store's `resource_id` carries the same rule, so a longer reference would be one no operation could ever record. The failure therefore lands where the reference is built.

### Reading the Session scope

`foldKnowledgeScope(events)` recovers the current scope from a Session log, and its `end` argument folds a prefix so rewind and fork read what the log said at that point. A log with no `knowledge/scope` event folds to `off`, which is where every Session starts. `selectionOf` turns a scope into the selection an operation carries, answering `undefined` for `off` so a caller does not build a request nobody asked for.

`all` stays a mode rather than an expanded list all the way to the Control Plane, because expanding it is an authorization act: only the Control Plane knows what the principal currently holds.

### Failures

Every failure is a `KnowledgeError` carrying one `KnowledgeFailureReason`. Product surfaces switch on `reason` and supply their own localized text; no upstream response body reaches either. `not-allowed` deliberately covers an unknown reference as well as an unauthorized one, so a refusal never confirms that a knowledge base exists to a principal holding nothing on it.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The seam names product operations, never upstream ones. A transparent passthrough would let a caller choose operations the permission catalog and audit vocabulary do not govern, so the operation set is fixed and small, and each operation is one a Control Plane can authorize against current state.

Scope lives in the Session log and nowhere else. It reaches the model twice — as prompt text naming the chosen knowledge bases, and as whether the search tool exists at all — so recording it anywhere else would make the log insufficient to reconstruct what the model saw.

### Source map

| File | Holds |
|---|---|
| [`src/brand.ts`](src/brand.ts) | `KnowledgeRef`, its grammar, and the audit-token bound that shapes it |
| [`src/types.ts`](src/types.ts) | Directory, search, scope, and failure vocabulary |
| [`src/scope.ts`](src/scope.ts) | The `knowledge/scope` Session event, its fold, and its validator |
| [`src/index.ts`](src/index.ts) | The `Knowledge` service definition |

### Data model

A `KnowledgeBaseEntry` is what a principal may search, named for a reader. A `KnowledgePassage` carries the reference that produced it, so a transcript can attribute text without a second lookup. A `KnowledgeScope` is a versioned discriminated union; its `selected` arm records a display name beside each reference, snapshotted at the moment of choice, because a model-visible name has to be reconstructable from the log.

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge subsystem](../../../docs/subsystems/knowledge.md) — the directory, search, scope, and failure contracts in full.
- [Team private knowledge Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — why knowledge stays behind the Control Plane, and what the first delivery leaves out.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the knowledge tool package, which renders passages to the model and contributes the scope prompt section. This service contributes no prompt and registers no schema.

#### KV Cache effect

No direct invalidation. The named consumer owns the request-prefix change a scope choice causes, which is real: changing scope changes both a prompt section and the tool list, so the following request re-reads its prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is incomplete on its own. They are current package constraints.

- **No full-document read** — the seam has a directory and a search and nothing that returns a document's text. Reading is deferred with the signed document reference that would address it, and the permission catalog keeps `knowledge.read` ungranted until then ([Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md)).
- **No provider registry** — one provider mounts the service, and there is no selection policy, availability query, or provider-change event. A second provider kind would need one, and the `KnowledgeRef` grammar leaves room for it.
- **No ingestion or mutation** — nothing here creates, uploads, edits, or deletes knowledge. Those operations need authorization and audit decisions the permission catalog does not yet carry.
- **Scope cannot express exclusion** — a scope narrows to named knowledge bases or to all of them; there is no "everything except" arm, because authorization has no deny rule for one to compose with.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the seam owns no registry and observes no stream of its own; scope is a fold over the Session log, which `dsh-session` already holds to, and every authorization relationship this capability depends on lives in the Control Plane rather than in this process.
