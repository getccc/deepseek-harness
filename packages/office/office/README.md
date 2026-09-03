---
description: "The office-deliverable choice vocabulary: which document kind a conversation should produce, its Session log event, the fold that recovers it, and the validator that reads one off a wire."
kind: "package-reference"
---

# @deepseek-ai/dsh-office

English | [中文](README.zh.md)

## Summary

`dsh-office` is the shared vocabulary of one small choice: which office document a conversation should produce — `word`, `ppt`, `amec-ppt`, `excel`, or `none`. It owns the `OfficeKind`, the `office/kind` Session event that records a choice, the fold that recovers the current one from a log, and the validator that reads one back off a wire. It carries no plugin, no prompt, and no projection: the model-facing tool (`dsh-tool-office`) and the browser Remote (`dsh-api-office-controller`) build on this vocabulary, which is deliberately free of any module augmentation beyond the Session event so a generated Remote face that names `OfficeChoice` never drags a projection registry into itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the vocabulary to record or read a Session's office choice:

- `OfficeKind`, `OFFICE_KINDS`, `isOfficeKind` — the kinds and the guard.
- `foldOfficeChoice(events)` — the current choice, or `none` when the log records none.
- `parseOfficeChoice(value)` — validate a choice from a wire or a store; `undefined` when the value is not one this build accepts.
- `DEFAULT_OFFICE_CHOICE` — the `none` a fresh Session holds.

-----

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **One choice per Session** — the vocabulary records the current kind, not a history or a per-directory default; a new conversation starts at `none`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `office/kind` event augments `SessionEventMap` in `scope.ts`; the projection augmentation lives in `dsh-tool-office`, not here, so the Remote controller can name `OfficeChoice` without importing a projection registry.

</details>
