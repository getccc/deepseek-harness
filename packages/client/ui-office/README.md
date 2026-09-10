---
description: "The composer chip choosing which office deliverable this conversation should produce: Word, Excel, PowerPoint, or charts."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-office

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-office` is the composer chip a member uses to say which office document a conversation should produce. It is single-select — Word, Excel, PowerPoint, or charts, each row carrying its own mark — and clicking the chosen kind again clears it. The chip reads the chosen kind from the `office` projection and records a click through the Team-only `office` Remote, so a reload or a second browser shows the same choice, and the model reads it through the prompt section `dsh-tool-office` owns.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in a Team browser composition; it seats a control in the composer's left zone and mounts the `office` Remote namespace it calls. It needs no configuration. A build whose Host folds no office choice renders nothing.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `office/kind` event the chip records, which `dsh-tool-office` turns into the prompt section naming the document kind.

#### KV Cache effect

Each choice changes the `office:kind` system-prompt section that `dsh-tool-office` owns, so the next request's prefix differs from that section onward; opening the chip costs nothing until a kind is clicked.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The choice lives in one conversation** — there is no remembered default, so every new conversation starts with no office format chosen.
- **Produced documents are not surfaced as cards** — a `.docx`, `.xlsx`, or `.pptx` the office tools write stays reachable from the workspace only; the file delivery seam returns with the next upstream merge.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The chip lists the four kinds from a local const rather than importing the vocabulary's `OFFICE_KINDS`, because a client bundle may not import a runtime value across plugins; the type still comes from `@deepseek-ai/dsh-office`.

</details>

**Runtime invariant:** No companion is published: a composer seat whose disposal is proven by the HMR-safety spec reads the Session's office choice through the Host, emits no cordis events, and owns no cross-plugin mutable state.
