---
description: "The Team-only knowledge Remote: the authorized directory a browser reads, and the Session scope choice it records."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-knowledge-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-knowledge-controller` is the Host half of the `/knowledge` picker: it answers what a member may search and records what they chose. The browser cannot reach `ctx.knowledge` itself — the service lives on the Host and its provider is what holds the device token — so the picker asks here. It is its own package rather than more surface on the session controller because knowledge is Team-only: a composition without it does not mount this, where a controller tolerating an absent service would have to report an empty directory, which reads as "you have access to nothing".

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

Mount it in a composition that already mounts a knowledge provider; it registers the `knowledge` Remote namespace.

### Minimal configuration

The controller has no configuration.

```yaml
- name: '@deepseek-ai/dsh-knowledge-team'
  config:
    controlPlaneUrl: https://dsh.company.com
- name: '@deepseek-ai/dsh-api-knowledge-controller'
```

### The two methods

`scope(sessionId)` answers what one Session may choose from, what it has chosen, and which of its selected references the authorized directory no longer holds. `choose(sessionId, mode, knowledgeRefs?)` records the choice and answers the same view.

The directory is read on every call rather than cached: a grant revoked since the last look should narrow the picker, and a knowledge base an administrator switched off should leave it.

### Why a choice carries names

The scope event records a display name beside each reference, because the prompt names the chosen knowledge bases and a model-visible name has to be reconstructable from the Session log. The names come from the directory as it stands at the moment of choice.

That is also why a reference the directory does not hold is refused rather than recorded. The Control Plane would refuse it at search time anyway, and recording it would put a name in the log that no search can honour.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Nothing here authorizes. The directory this controller offers is one the Control Plane already narrowed to what the member holds, and a search over the recorded choice is authorized again on its own. What this owns is the difference between a member's intent and what the log says — which is why a stale selection is reported rather than silently shrunk.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `knowledge` Remote namespace, its request validation, and the scope projection |

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge subsystem](../../../docs/subsystems/knowledge.md) — the scope value this records.
- [Team private knowledge Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — why the scope lives in the Session log.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-knowledge`: the scope this records is what its prompt section names and what decides whether its tool is offered. This controller contributes no prompt and registers no schema.

#### KV Cache effect

No direct invalidation, but a recorded choice causes one: the named consumer's prompt section and tool list both change, so the following request re-reads its prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the controller is incomplete on its own. They are current package constraints.

- **A choice needs a live Session** — both methods resolve an agent by Session id and refuse when none is open, so a scope cannot be set for a conversation that is not running.
- **No change notification** — a browser that has the picker open does not learn that a grant changed; it sees the narrowed directory the next time it opens.
- **No per-choice audit** — recording a scope writes only the Session event. Which knowledge bases a member searched is audited by the Control Plane at search time, which is where the decision is.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
