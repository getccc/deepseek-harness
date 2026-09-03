---
description: "Package map for the office-deliverable choice: which document kind a conversation should produce, the prompt section that tells the model, and the composer picker that records it."
kind: "package-group"
---

# office/ — office-deliverable choice family

English | [中文](README.zh.md)

## Summary

The `office/` group lets a member say, from the composer, which office deliverable a conversation should produce — a Word document, an Excel workbook, a PowerPoint, the company's AMEC PowerPoint template, or interactive charts — and folds that choice into a prompt section the model reads. It exists because "make me a deck" and "make me a spreadsheet" are the same request until the member names the format, and the format is a per-conversation decision that must survive a resume, a fork, and a second browser. The group owns the vocabulary: the `OfficeKind` a conversation may pick, the `office/kind` Session event that records it, and the fold that recovers it. It owns no document engine — producing the file is the univer office tools' job, and drawing a chart is the web surface's; this group only names the target and, for the AMEC kind, points at the shipped template.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`office/`](office/README.md) | The choice vocabulary: the kind, the `office/kind` event, the fold, and the validator | — |
| [`tool-office/`](tool-office/README.md) | What the model sees: the `office:kind` prompt section and the choice projection | registers on `ctx.systemPrompt` |
| [`api/office-controller/`](../api/office-controller/README.md) | Host Remote: read and record one Session's office choice from the browser | `ctx.remote.office` |
| [`client/ui-office/`](../client/ui-office/README.md) | The composer chip that chooses the kind | browser plugin |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The controller's Remote face names a self-contained wire type rather than importing `OfficeChoice`, so the Typert generator never follows a boundary type into a package that augments a projection or event map.

</details>
