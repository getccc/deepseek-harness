---
description: "Composer voice controls for the Web GUI: the transcribe chip and the voice-input button, seated and inert ahead of the recording capability; for maintainers building that capability."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice

English | [中文](README.zh.md)

## Summary

This package holds the Web GUI's two voice controls: a 录音转写 chip in the composer tool row beside the web switch, and a microphone button between the context meter and the send action. Both are placed and inert — they settle the seats, the order among the sibling chips, and the copy, and each states through `aria-disabled` and its tooltip that the capability is not built. Neither holds state, reads a projection, or calls a Remote; the recording and dictation behavior arrives here later.

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

Mount this plugin alongside `ui-conversation`; the two controls then appear in every chat conversation. Nothing to configure: a deployment that does not want the seats shown leaves the plugin out of its composition.

### What a member sees

The chip carries the waveform glyph and the label in the composer's own ink, next to the web switch and before the knowledge and office chips; below a 460px composer it collapses to its glyph, as the sibling chips do. The microphone button is a quiet circle in the trailing group, after the context meter and before the send circle. Both name themselves for assistive technology, both are announced as unavailable, and both carry a tooltip saying the feature is still being built. Clicking either does nothing. Neither appears in a work session: the capability is being built for the chat composer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip joins the conversation-declared `conversation.input.left` list at order 60 — after the web switch at 50, before the knowledge and office chips at 100. The button occupies `conversation.input.voice`, the single seat `ui-conversation` declares between its context meter and the send circle, and takes `locked` from that seat so it dims with its neighbors while the composer refuses interaction. Both read the Session kind through the standard-kit `useSessions` and render nothing outside a chat Session. The node half is an empty apply (the roster row).

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the controls are not enough. They move from the seats to the composer that declares them.

- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.left` zone and the `conversation.input.voice` seat.
- [ui-web-access](../ui-web-access/README.md) — the chip the transcribe chip sits beside, and the shape a live composer control takes.
- [Web Client Slots](../../../docs/subsystems/slots.md) — the seat hierarchy both controls join.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as both controls are inert placeholders that render no model-facing text and record nothing in the Session log.

#### KV Cache effect

The controls add no prompt content and change no request prefix, so no request prefix moves.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current package. They state what the seats do not yet carry.

- **No recording and no dictation** — the capability behind both controls is unbuilt: no microphone permission is requested, no audio is captured, and no transcript reaches the draft. Building it belongs in this package, over a Host seam that owns the transcription provider.
- **Chat conversations only** — a work session shows neither control, so a member dictating a task has to type it.
- **The controls belong to the default composer** — a pending whole-composer interaction such as plan review temporarily replaces the InputBar and both of its seats.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package owns two slot effects whose declaration, registration, and teardown are exercised by this package's own tests, and no relationship two observers could see differently.
