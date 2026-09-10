---
description: "The upstream knowledge-source seam (ctx.knowledgeSource): listing a source's knowledge bases and searching an explicit, already-authorized set of them."
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-source

English | [中文](README.zh.md)

## Summary

`dsh-knowledge-source` (`ctx.knowledgeSource`) is the seam a governed knowledge gateway speaks to an upstream knowledge product through. It has two operations — list what a source holds, search an explicit set of its knowledge bases — and both are in upstream terms: upstream ids, not `KnowledgeRef`s, because mapping between the two is the catalog's job. It mounts in the Control Plane alone and never in a Runner. Import it to write a provider for a knowledge product, or to consume one from a gateway. The seam has no operation that takes a URL, a caller-chosen header, or an arbitrary upstream path, so a gateway in front of it cannot be talked into an operation the permission catalog does not govern.

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

A Control Plane composition mounts one provider, which registers this service; the governed gateway then calls `ctx.knowledgeSource.list()` and `ctx.knowledgeSource.search()`.

### When to choose it

Import it to write a provider for a knowledge product, or to consume one. A Runner never mounts it: the whole point of the split is that the process holding a member's session holds no knowledge credential.

### Minimal configuration

The seam has no configuration. A provider row supplies whatever a deployment varies:

```yaml
- name: '@deepseek-ai/dsh-knowledge-weknora'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8080
    credentialRef: WEKNORA_API_KEY
```

### What a provider owes its gateway

`providerKind` and `sourceCode` are the first two segments of every `KnowledgeRef` the catalog mints from this source. The kind is a constant of the provider, because it names the code that speaks the protocol; the source code is configuration, because one company's `prod` is another's `kb`.

`search` receives an explicit, already-authorized set of upstream ids and must never widen it. An empty set is not a request for everything: a provider that treated it as one would search whatever its own configuration pointed at, which is the single way a request could reach a knowledge base nobody authorized.

Failures are raised as `KnowledgeError` with `upstream-unavailable` or `upstream-invalid`. A provider never raises an authorization reason — it does not know who is asking, which is the point.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Two seams rather than one. The Runner-facing `ctx.knowledge` names what a member wants; this one names what a source can do. Keeping them apart is what lets the gateway between them be the only party that maps a governed reference to an upstream id, and the only party that decides whether it may.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `KnowledgeSource` service definition and its upstream vocabulary |

### Data model

`UpstreamKnowledgeBase` carries the counts an administrator reads plus `embeddingModelId`, which the catalog records because multi-base retrieval is only defined for knowledge bases that share one. `UpstreamPassage` carries the upstream id that produced it, so the gateway can map each hit back to a governed reference and prove it authorized that base.

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge subsystem](../../../docs/subsystems/knowledge.md) — the governed vocabulary this seam feeds.
- [Team private knowledge Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — why the credential stays on the Control Plane.

<a id="model-experience"></a>
## Model Experience

None, as the seam runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is incomplete on its own. They are current package constraints.

- **No document read** — a source can be listed and searched, and nothing returns a document's full text. The operation arrives with the signed document reference that would address it.
- **No provider registry** — one provider mounts the service. Several sources in one Control Plane would need a registry and a selection policy; the `KnowledgeRef` source-code segment leaves room for it, but nothing consumes that room yet.
- **No ingestion or mutation** — nothing here creates, uploads, edits, or deletes upstream knowledge.
- **No incremental listing** — `list()` returns everything a source holds, with no paging or change cursor. A source with many thousands of knowledge bases would need one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the seam owns no registry and publishes no event stream; a provider's own bounds are enforced on each call, and authorization of a searched knowledge base belongs to the gateway, which is the party that authorized it.
