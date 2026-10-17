---
description: "GMO supply-chain composer control: the single-select naming which GMO category this conversation asks about, recorded through the Team-only gmo Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-gmo

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-gmo` is the work composer's GMO supply-chain control, seated to the right of the BI chip: a single-select over the categories the member may analyze, recording the choice as a `gmo/scope` event through the Team-only `gmo` Remote and reading the projection of that same event. Nothing about the choice is kept in the browser, so a second browser, a reload, and the model all see the same category. The plugin carries no Host behavior; mounting it is what puts its browser half in the boot graph.

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

Mount it in a Team build, after `dsh-api-gmo-controller`:

```yaml
- id: api-gmo-controller
  name: '@deepseek-ai/dsh-api-gmo-controller'
- id: client-ui-gmo
  name: '@deepseek-ai/dsh-client-ui-gmo'
```

### What the control does

It renders only for a work Session, never for a chat Session, whose tool-less preset has no result to ask. The label is the display name the Session recorded; clicking the chosen category again clears it. The directory is read when the menu opens, so a grant revoked since the last open narrows the rows. The menu's footer says when the change could not be saved, when the member has no category to choose, and when the recorded category is no longer available.

### Copy

The copy lives in the `gmo` locale namespace in simplified Chinese and English, and the composer chip reads GMO供应链 or GMO supply chain.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The chosen category is read from the `gmo` projection rather than held in the component, so the chip, a reload, a second browser, and the model agree. The control writes through the Remote and reads through the projection; it never reconciles the two.

### Source map

| File | Holds |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | The browser plugin: the Remote mount, the dictionaries, and the composer slot registration |
| [`src/client/GmoSelect.tsx`](src/client/GmoSelect.tsx) | The control |
| [`src/client/locales.ts`](src/client/locales.ts) | The namespace's dictionaries |

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the scope the control records.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — the composer control and why a conversation starts at off.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `gmo/scope` event the control records, which `dsh-tool-gmo` turns into the prompt section naming the category and into the visibility of the five GMO tools.

#### KV Cache effect

Each choice changes the `gmo:scope` system-prompt section and the tool list that `dsh-tool-gmo` owns, so the next request's prefix differs from that section onward; opening the control costs nothing until a category is clicked.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **One category per conversation** — the control is a single-select with no arm for several or for all.
- **The generated Remote client counts declared arguments** — the control passes every declared argument, the trailing one as `undefined` when there is no category, because the client refuses a call with fewer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the control reads one projection and writes one event through one Remote, and its component and plugin tests assert that.
