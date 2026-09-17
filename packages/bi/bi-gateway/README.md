---
description: "The governed BI gateway seam (ctx.biGateway): the durable project catalog an administrator curates, and the authorized directory, chart listing, and chart run a Runner reaches."
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-gateway

English | [中文](README.zh.md)

## Summary

`dsh-bi-gateway` (`ctx.biGateway`) is the Control Plane service between a member's Runner and a BI source — the only party that decides which projects a principal may reach. It serves two audiences from one owner: an administrator reads and curates the durable project catalog, and a Runner reads an authorized directory, lists one project's saved charts, and runs one of them. Both go through here because the catalog and the authorization decision have to agree; a directory showing a project a run would refuse is worse than either alone. Import it to write a gateway provider or to consume one.

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

A Control Plane composition mounts a provider, which registers this service; the Runner-facing HTTP adapter and the administration API then call it.

### When to choose it

Import it to write a gateway provider or to consume one. Nothing outside a Control Plane mounts it: a Runner reaches BI through `ctx.bi`, whose provider forwards over HTTP to a gateway that authorizes each operation.

### Minimal configuration

The seam has no configuration. A provider row supplies whatever a deployment varies:

```yaml
- name: '@deepseek-ai/dsh-bi-gateway-sqlite'
  config:
    path: /var/lib/dsh/control-plane/bi.sqlite
```

### The two audiences

Administration methods — `sync`, `catalogView`, `setEnabled` — take an organization, because the route that called them has already authorized an administrator. Member-facing methods — `directory`, `charts`, `query` — take a `BiPrincipal` recovered from a verified access token, and authorize it themselves, per project, on every call. A caller that could name its own principal in a request body would be authorizing itself.

Authorization is never cached with a token, so revoking a grant, disabling a project, suspending a member, or revoking a device all take effect on the next call.

### One resource type, two meanings

`BI_CATALOG_RESOURCE` is the governed resource standing for the catalog itself, so a grant to administer it is a grant over the catalog rather than over each project. It shares `BI_RESOURCE_TYPE` with the projects, which has a consequence every implementation must handle: an `all`-mode type grant on `bi.query` admits it too. Every member-facing path therefore enumerates the durable catalog and joins it to managed resources, and never enumerates the resources of that type.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

No member-facing method returns a partial answer. A directory that could not be authorized, a listing on a project that was refused, and a run on a chart outside its project all raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `BiGateway` service definition, the catalog and principal vocabulary, and the governed resource constants |

### Data model

`BiCatalogEntry` carries `adminEnabled` because it is a policy choice synchronization must not override; a catalog holds only what the source still lists, so there is no second bit for whether a project is still there. `effectiveEnabled` is that choice conjoined with the governed resource's own state, so an interrupted write reads as disabled rather than as available. `GovernedChartsRequest` carries the keyword and the page because narrowing is the gateway's, over names the source does not index; `GovernedQueryRequest` carries a row bound and nothing else, because a saved chart runs as it was saved.

<a id="further-exploration"></a>
## Further Exploration

- [BI subsystem](../../../docs/subsystems/bi.md) — the vocabulary this gateway governs.
- [Team BI analysis Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — why every operation is authorized here.

<a id="model-experience"></a>
## Model Experience

None, as the seam runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is incomplete on its own. They are current package constraints.

- **One source per gateway** — the seam names no source, so a Control Plane governs one. Several would need a source selection in the catalog and in every operation.
- **Every member-facing operation is evaluated as a run** — `bi.query` admits the directory and the listing too, by product decision rather than because the operations are the same. A deployment that wants them apart needs a second permission granted and the provider's action constant split.
- **A retired entry takes its grants** — an entry a successful listing stops naming is deleted, and `deleteResource` deletes every grant naming it. A source that answers with a partial listing therefore revokes access an administrator has to grant again; there is no undo and no grace period.
- **Administration methods are unauthorized here** — they take an organization and trust their caller, so a route that forgot its permission check would reach them. The check lives in the route, and its absence is a route defect this seam cannot catch.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the seam owns no registry and publishes no event stream; that a run project was authorized for the principal that ran it lives in the provider, which is the party that authorized it.
