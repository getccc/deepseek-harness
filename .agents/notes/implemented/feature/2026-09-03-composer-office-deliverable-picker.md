# Agent Note: A composer picker chooses the office deliverable

Status: implemented

English | [中文](2026-09-03-composer-office-deliverable-picker.zh.md)

## Problem

A member asking a Team Runner for "a deck" or "a spreadsheet" had no way to say which office format they meant, and the model guessed. The knowledge chip already showed the shape of the answer — a composer control that records a per-conversation choice the model reads — but there was no equivalent for the deliverable format, and no way to say "use our company's PowerPoint template" short of describing it in prose every time.

## Decision

**The office-deliverable choice is a Session event folded into a prompt section, chosen from a composer chip — the knowledge chip's exact shape.** A member picks one of Word, PowerPoint, the AMEC PowerPoint template, or Excel; the choice records an `office/kind` event; a prompt section names the format for the model; a projection lets the chip show the current choice. Resume, fork, and a second browser all recover it from the log, and nothing is stored twice.

**Single-select, and clicking the chosen kind clears it.** Unlike knowledge's multi-select scope, a conversation produces one kind of document, so the control is a radio: the tinted chip names the chosen kind, and clicking it again returns to `none` (no imposed format, no section).

**The AMEC kind carries a template path, not a copy.** When the deployment ships a PowerPoint template, the installer writes its absolute path into the `office` row, and the prompt section tells the model to import that file and keep its masters, layouts, fonts, and colours. With no template configured, the section sends the model to an AMEC template skill in the session catalog, so the option is never dead; [the office section defers to the template skill](../bug-fix/2026-09-06-the-office-section-defers-to-the-template-skill.md) records why the earlier brand-style fallback was replaced.

**Four packages, mirroring the knowledge triad.** `dsh-office` is the vocabulary (the kind, the `office/kind` event, the fold, the validator); `dsh-tool-office` owns the prompt section and the projection; `dsh-api-office-controller` is the Team-only Remote the browser records through; `dsh-client-ui-office` is the chip. The Team bundle mounts the last three; the vocabulary is a shared dependency.

## Alternatives considered

**One combined package.** Rejected on two hard constraints the knowledge split already encodes. The Typert generator crashes when a Remote face's boundary type resolves into a package that augments a projection or event map, so the controller must not import a package carrying those augmentations — the vocabulary is kept free of the projection merge, and the controller's wire type is self-contained. And a client bundle may not import a runtime value across plugins, so the chip lists its kinds from a local const rather than the vocabulary's `OFFICE_KINDS`.

**Record the choice through the session controller's generic surface.** There is no generic "append a Session event" Remote; the knowledge controller exists for exactly this reason, and office follows it.

## Consequences

The four packages reach the packaged Runner transitively through the Team bundle, not as executable-closure roots: listing a client UI package as a closure root makes `verify-runtime-closure` demand every client peer as a closure dependency, which the transitive path does not.

The prompt section instructs; it does not enforce. Producing the named format is the univer office tools' work, and a model may still choose otherwise. The section is guidance, and a snapshot proving the section text against a recorded office choice is deferred — it is additive and absent from a default (`none`) Session, so no shipped snapshot changes.

The desktop shell carries the template as `DSH_TEAM_PPT_TEMPLATE`, staged beside the Runner and pathed at runtime like the Control Plane certificate. A build with no template still ships the AMEC option.
