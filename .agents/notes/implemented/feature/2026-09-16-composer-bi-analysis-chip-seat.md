# Agent Note: Composer BI analysis chip seat

Status: implemented

English | [中文](2026-09-16-composer-bi-analysis-chip-seat.zh.md)

## Problem

BI analysis is a capability the Team work composer is getting: a member with a workspace asks for a report over company data. It needs a place in the composer tool row, which already carries the `+` launcher, the web switch, the transcribe chip, and the knowledge and office chips, and the design puts it to the right of 办公. Deciding that placement inside the change that also has to reach a data source and run an analysis would bury it.

## Decision

`@deepseek-ai/dsh-client-ui-bi` owns the chip. It joins `conversation.input.left` at order 120, after the office chip at 110, and renders for a work Session only — a chat conversation has no workspace to analyze. Like the [voice seats](2026-09-16-composer-voice-control-seats.md), it is placed and inert: glyph, label, `aria-disabled`, and a tooltip saying the capability is not built, with no click handler, no state, no projection read, and no Remote call. `ui-primitives` gains the trend glyph it wears, stroked rather than filled so it reads apart from the office chart-kind bars beside it.

The **Team bundle** mounts it, next to the office chip row, rather than the web-app bundle the voice seats ride: the chip's neighbor is Team-only, and a plain `dsh web` deployment has no BI service to reach, so a chip there would be dead with nothing behind it even after the capability lands.

## Alternatives considered

**Mount it in the web-app bundle.** That is where the voice seats sit, and it would put the chip under the Web snapshot lane, which composes the shipped web-app layers. Rejected: 办公 — the chip this one is placed against — is Team-only, so in a plain `dsh web` work session the chip would sit alone against a capability that deployment will not have. The cost is that the chip has no Web golden, exactly as the office and knowledge chips have none; the package's own specs are its coverage.

**Reuse `IconChartOutline16` for the mark.** The office picker already uses it for its 可视化 kind. Two glyphs of the same bars, one inside the office menu and one on the chip beside it, would read as the same thing; a stroked trend line is one glyph of new artwork and keeps them apart.

**Wait for the capability.** The same argument the voice seats settled: the row's layout is reviewable on its own, and the capability change should be about the data source and the analysis.

## Consequences

The work composer's row is settled through BI: the capability change adds behavior to a chip that already exists, in a package that already exists. The cost is a shipped surface that does nothing — clicking gives no response beyond the tooltip, and the package's Known Limitations says so. Only Team deployments see it.

## Testing

The package's own specs pin the registration and its teardown, the work-only gate, and the copy in both languages. There is no Web golden: the snapshot lane composes web-app, which does not mount Team rows, so this chip sits outside it like the office and knowledge chips.
