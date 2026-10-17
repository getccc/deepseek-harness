---
description: "The governed GMO gateway seam (ctx.gmoGateway): the durable category catalog, and the authorized directory, result listing, description, and question in front of the upstream source."
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-gateway

English | [中文](README.zh.md)

## Summary

`dsh-gmo-gateway` (`ctx.gmoGateway`) is the Control Plane service that stands between a member's Runner and the GMO source, and the only party that decides which categories a principal may reach. An administrator reads and curates the durable category catalog; a Runner reads an authorized directory, lists one category's results, describes one, and asks one a question. Authorization is asked on every operation rather than cached with a token, so revoking a grant, disabling a category, suspending a member, or revoking a device takes effect on the next call.

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

A Control Plane composition mounts one implementation, `dsh-gmo-gateway-sqlite`, which registers this service; the administration API calls `sync`, `catalogView`, and `setEnabled`, and the Runner-facing routes call `directory`, `results`, `describe`, and `ask`.

### What the package exports

The service, the resource type `gmo_category`, the permission `gmo.query`, and the resource `urn:dsh:admin:gmo-catalog` that stands for the catalog itself. The catalog shares the resource type with the categories, which is why every member-facing path enumerates the durable catalog and joins it to managed resources by reference, never by listing resources of the type: an all-categories grant on `gmo.query` would otherwise admit the catalog resource as a category.

### Who is asking

A `GmoPrincipal` carries the organization, the principal, and the device, recovered from a verified access token and never from a request body. Every member-facing request extends it.

### New categories start off

`sync` registers a category the source newly lists as switched off. A role granted every category therefore does not gain a business line the moment the source starts serving it; an administrator enables it first, and synchronization never overrides that choice either way.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

One owner for the catalog and the decision. A directory that showed a category an operation would refuse, or the reverse, would be worse than either alone, so both live behind this service.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `GmoGateway` service definition, the catalog and source-status types, and the governed request types |

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the vocabulary the gateway answers in.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — the security invariants this service enforces.

<a id="model-experience"></a>
## Model Experience

None, as the gateway runs in the Control Plane, which mounts no agent and no tool registry, so a model never reaches it.

#### KV Cache effect

No request prefix changes here; the Runner-side consumer of a governed result owns any that do.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the seam is incomplete on its own. They are current package constraints.

- **One catalog per source** — the catalog and the source status assume one configured source; several would need a registry in the source seam first.
- **Per-category authorization only** — a member granted a category reads every result in it; there is no per-result or row-level decision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the service owns no registry and emits no events; authorization is asked on each call and the implementation's tests assert that a revocation lands on the next one.
