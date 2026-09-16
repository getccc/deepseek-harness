---
description: "BI analysis composer chip for the Web GUI: the control seated beside the office chip and inert ahead of the analysis capability; for maintainers building that capability."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-bi

English | [中文](README.zh.md)

## Summary

This package holds the Web GUI's BI-analysis chip: a BI分析 control in the composer tool row, to the right of the office chip. It is placed and inert — it settles the seat, its order among the sibling chips, and the copy, and states through `aria-disabled` and its tooltip that the capability is not built. It holds no state, reads no projection, and calls no Remote; the analysis behavior arrives here later.

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

Mount this plugin alongside `ui-conversation`; the chip then appears in every work conversation. Nothing to configure: a deployment that does not want the seat shown leaves the plugin out of its composition. The Team bundle mounts it beside the office chip it follows.

### What a member sees

The chip carries the trend glyph and the label in the composer's own ink, after the web, knowledge, and office chips; below a 460px composer it collapses to its glyph, as the sibling chips do. It names itself for assistive technology, is announced as unavailable, and carries a tooltip saying the feature is still being built. Clicking it does nothing. It does not appear in a chat conversation, which has no workspace to analyze.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip joins the conversation-declared `conversation.input.left` list at order 120 — after the web switch at 50, the transcribe chip at 60, the knowledge chip at 100, and the office chip at 110. It reads the Session kind through the standard-kit `useSessions` and renders nothing outside a work Session. The node half is an empty apply (the roster row).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the chip is not enough. They move from the seat to the composer that declares it and the chip it follows.

- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.left` zone.
- [ui-office](../ui-office/README.md) — the chip this one sits beside, and the shape a live composer choice takes.
- [ui-voice](../ui-voice/README.md) — the other seats placed ahead of their capability.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the chip is an inert placeholder that renders no model-facing text and records nothing in the Session log.

#### KV Cache effect

The chip adds no prompt content and changes no request prefix, so no request prefix moves.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current package. They state what the seat does not yet carry.

- **No analysis** — the capability behind the chip is unbuilt: it opens nothing, reads no data, and produces no report. Building it belongs in this package, over a Host seam that owns the data source and the analysis it runs.
- **Work conversations only** — a chat conversation shows no chip.
- **The chip belongs to the default composer** — a pending whole-composer interaction such as plan review temporarily replaces the InputBar and its seat.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns one slot effect whose declaration, registration, and teardown are exercised by this package's own tests, and no relationship two observers could see differently.
