# Agent Note: Composer voice control seats

Status: implemented

English | [中文](2026-09-16-composer-voice-control-seats.zh.md)

## Problem

Recording a meeting into a transcript, and dictating a draft, are two capabilities the Team composer is getting. Both need a place in a composer row that is already full: the `+` launcher, the web switch, the knowledge and office chips on the left; the model selector, the context meter, and the send circle on the right. Where they sit decides what the row looks like, which package owns them, and — for the dictation button — whether the composer has a seat there at all. Settling that before the capability is built keeps the layout decision out of the change that has to get audio, permissions, and transcription right.

## Decision

`@deepseek-ai/dsh-client-ui-voice` owns both controls. The transcribe chip joins `conversation.input.left` at order 60 — after the web switch at 50, before the knowledge and office chips at 100 — so the shipped chat-composer controls stay together and the deployment-added ones follow. The microphone takes a new single seat, `conversation.input.voice`, which `ui-conversation` declares and renders after the context meter, immediately before the send circle; it takes `locked` from that seat, as the model, plan, and permission seats do.

Both controls are placed and inert: they render their glyph, their name, and `aria-disabled` with a tooltip saying the capability is not built, and carry no click handler, no state, no projection read, and no Remote call. Both render for a chat Session only, the composition the capability is being built for; a work session sees neither. `ui-primitives` gains the two glyphs they wear, a 16-grid microphone and a 14-grid waveform.

## Alternatives considered

**Render both controls in the `InputBar` skeleton.** The skeleton already draws the `+`, stop, and send buttons, so two more buttons would need no package and no new seat. Rejected: the capability behind them will need a Host seam for transcription, so the controls would move out of the skeleton the moment it lands, and a product feature in the shared composer would have no owner in the meantime.

**Put the microphone in `conversation.input.right`.** That zone exists, is documented as "before the composer submit action", and has no occupants anywhere in the repository. It renders left of the model selector, which is not where the button belongs, and moving the zone would silently relocate any out-of-tree plugin that registered into it. A second named seat, beside the existing `plan`, `permission`, and `model` seats, costs one contract line instead.

**Ship nothing until the capability works.** The row's layout would then be decided inside the change that also handles microphone permission, audio capture, and a transcription provider, and the seats would be reviewed under that change's pressure. Placing them first makes the layout reviewable on its own.

**Disable both controls outright.** A `disabled` button is dimmed and unfocusable, which reads as a broken control rather than a coming one. `aria-disabled` with a tooltip keeps the control legible and reachable while still announcing it as unavailable; the microphone additionally takes the real `disabled` state from the composer's `locked`, so it dims with its neighbors.

## Consequences

The composer row is settled: the capability change adds behavior to two controls that already exist, in a package that already exists, without touching `ui-conversation` again. The cost is a shipped surface that does nothing — a member who clicks either control gets no response beyond the tooltip, and the package's Known Limitations says so. The web-app bundle mounts the plugin, so every Web deployment including Team shows both controls; a deployment that does not want them leaves the row out of its composition.

## Testing

The package's own specs pin both registrations and their teardown, the chat-only gate, the copy in both languages, and the microphone following `locked`. The `chat-preset` Web snapshot carries both controls in its captured composer, so a seat that disappears or changes its name fails there.
