---
description: "The recording and transcription placeholder in the chat composer."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice

English | [中文](README.zh.md)

## Summary

This package provides the Transcribe placeholder in the chat composer tool row. It reports that recording and transcription is not built yet and does not record audio or modify drafts. A separate voice input plugin provides functional dictation.

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

Mount this plugin alongside `ui-conversation` to show the transcription chip in chat composers. It has no configuration fields.

### What a member sees

The chip displays a waveform and Transcribe beside the web switch, before the knowledge and office chips. Below a 460px composer it shows only its glyph. Its accessible name, `aria-disabled` state and tooltip identify the unavailable capability. It does not appear in work sessions.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip registers in `conversation.input.left` at order 60 and reads the Session kind through `useSessions`. The plugin leaves `conversation.input.voice` free for functional voice input. Its node apply is empty.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages describe the composer and its slots.

- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.left` zone and the `conversation.input.voice` seat.
- [ui-web-access](../ui-web-access/README.md) — the chip the transcribe chip sits beside, and the shape a live composer control takes.
- [Web Client Slots](../../../docs/subsystems/slots.md) — the seat hierarchy the chip joins.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the placeholder produces no model-visible text or Session events.

#### KV Cache effect

The controls add no prompt content and change no request prefix, so no request prefix moves.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

This package provides a placeholder only.

- **No recording or transcription** — the chip requests no microphone permission, captures no audio and inserts no draft text.
- **Chat conversations only** — work sessions do not show the chip.
- **Default composer** — interactions such as plan review can temporarily replace the InputBar containing the chip.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** The package owns one slot effect; package tests cover its registration and disposal.
