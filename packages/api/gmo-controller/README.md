---
description: "Team-only Host Remote for GMO supply-chain analysis: the authorized category directory a browser reads and the Session category choice it records."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gmo-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-gmo-controller` is the Host Remote that backs the composer's GMO control: the browser cannot reach `ctx.gmo` directly, because the service lives on the Host and its provider holds the device token, so the control asks here. It answers which categories a Session may choose from and which it has chosen, and records a new choice as the `gmo/scope` event that the tools and the prompt section fold. It is a Team-only namespace: a composition without GMO analysis does not mount it.

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

Mount it in a Team Host that mounts a GMO provider; `dsh-client-ui-gmo` calls it.

### The Remote

| Method | Answers |
|---|---|
| `scope(sessionId)` | The authorized choices, the Session's current scope folded from its log, and whether that scope has gone stale |
| `choose(sessionId, mode, categoryRef?)` | Records `off` or one category and answers the scope as it now stands |

The directory is read on every open rather than cached: a grant revoked since the last look narrows the control, and a category an administrator switched off leaves it. A chosen category the directory no longer holds is reported as `unavailable` rather than dropped, so a member whose access changed is told their choice went stale.

### What a choice records

The display name is taken from the authorized directory as it stands now and written into the event, because the prompt names it and a model-visible name has to be reconstructable from the log. A reference the directory does not hold is refused rather than recorded: the Control Plane would refuse it at question time anyway, and recording it would put a promise in the log that nothing can keep.

### Failures

| Code | Means |
|---|---|
| `gmo/no-category` | A `selected` choice named no category |
| `gmo/not-available` | The reference is not a category this member may analyze |
| `gmo/unavailable` | The directory could not be read; the closed reason travels with it |
| `gmo/session-not-open` | The addressed Session is not open in this process |

A malformed request answers `gateway/bad-request` and never becomes an authorization outcome.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

A separate Team-only namespace rather than more surface on the session controller, where an absent service would have to read as an empty directory. The closed reason travels with a directory failure so a control can say sign in again or the Control Plane is unreachable instead of showing an empty list, which would read as access to nothing.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The controller, request parsing, and the scope fold |
| [`src/types.ts`](src/types.ts) | The Remote boundary types, self-contained so the generated face names only types this package declares |

The generated Remote face and the Host binding are build outputs under `lib/`.

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the scope event this Remote records.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — why the choice is recorded in the Session log.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `gmo/scope` event it records, which `dsh-tool-gmo` turns into the prompt section and the tool visibility.

#### KV Cache effect

None of its own. Recording a choice changes the `gmo:scope` prompt section and the tool list that `dsh-tool-gmo` owns; the prefix invalidation is described there.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **The directory is read on every open** — one Control Plane call per open of the control; there is no cache.
- **The generated Remote client counts declared arguments** — a caller must pass the trailing optional `categoryRef` as `undefined`, or the browser call fails while a jsdom test passes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the controller owns no registry; that it records exactly the event the fold reads is asserted by the package's tests.
