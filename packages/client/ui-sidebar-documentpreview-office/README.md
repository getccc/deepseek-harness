---
description: "Right-Sidebar previews for Word, Excel, and PowerPoint files: three external renderers registered with the shipped document preview registry, removable as one bundle row."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-documentpreview-office

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-sidebar-documentpreview-office` previews Word, Excel, and PowerPoint documents inside the right Sidebar's document tab, so a `.docx`, `.xlsx`, or `.pptx` a conversation produced or a member opened from the file tree reads in place instead of only in a desktop application. It registers three external renderers with the Sidebar's document preview registry and mounts only in the Team browser composition; the builtin plain-text fallback returns the moment it is unmounted. Rendering runs in the browser from the file's complete bytes, and nothing leaves the page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it beside `dsh-client-ui-sidebar-documentpreview` in a browser composition; the Team bundle does. It needs no configuration. Opening a `.docx`, `.xlsx`, `.xlsm`, `.xls`, or `.pptx` file in the Sidebar then shows the document instead of the "not a text file" line, and the document toolbar still lists every registered renderer for that suffix. Remove the bundle row to uninstall: the registry ranks an external renderer above a builtin one, so a later upstream renderer for the same suffix can be tried beside this one and this package dropped once it is preferred.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin owns no tab, file read, or toolbar. The document owner reads the file's complete bytes and seats the body whose registration claims the suffix; each body renders those bytes into a container it owns and clears on unmount, with a loading line before and a retry line after a failure. Word goes through `docx-preview`, which lays out pages as HTML with images inlined as data URLs; the body scales the pages to the pane's width until the reader moves the zoom slider or Alt + wheel, and a fit-width button returns to following the pane. Excel goes through SheetJS: the workbook is parsed once, one worksheet renders at a time as a grid with Excel's column letters, row numbers, column widths, and merged cells, and a sheet beyond 2,000 rows or 200 columns is cut there and says so. PowerPoint goes through `pptx-renderer`, which draws the deck as one scrolling list fitted to the stage under the recommended zip limits, with previous and next controls and, on a stage at least 380 px wide, a rail of slide previews drawn as they come into view; the viewer is destroyed with the tab.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Registers the dictionary, the three renderer definitions, and the keyed bodies |
| [`src/client/office/DocxBody.tsx`](src/client/office/DocxBody.tsx) | Word pages through `docx-preview` |
| [`src/client/office/SheetBody.tsx`](src/client/office/SheetBody.tsx) | Workbook parsing, worksheet tabs, and the bounded table |
| [`src/client/office/PptxBody.tsx`](src/client/office/PptxBody.tsx) | Slide list through `pptx-renderer` with navigation and refit, destroyed with the tab |
| [`src/client/office/PptxRail.tsx`](src/client/office/PptxRail.tsx) | Slide previews drawn while near the rail's viewport |
| [`src/client/office/Status.tsx`](src/client/office/Status.tsx) | Loading, failure with retry, and unsupported-content lines |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package draws documents a member opens in the browser and registers nothing model-facing.

#### KV Cache effect

None; file bytes travel over the Remote and assemble no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Reading only** — the bodies present a document; editing stays with the desktop application the file card opens.
- **Excel shows values** — formulas render as their cached results; column widths, merges, hidden columns, and number formats are honoured, while fonts, fills, borders, frozen panes, and charts are not drawn, and a worksheet beyond 2,000 rows or 200 columns is cut at that bound with a notice.
- **PowerPoint fidelity is the renderer's** — SmartArt and EMF fallbacks that need PDF.js are not bundled, so those elements render as the library's placeholders.
- **Legacy binary formats** — `.doc` and `.ppt` are not claimed; `.xls` is read by SheetJS.
- **One bundle, loaded at boot** — the three renderers and their libraries ship in one client bundle of about 3.5 MB that the Team composition loads with the page.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The renderer libraries (`docx-preview`, `xlsx`, `@aiden0z/pptx-renderer` with its `echarts` and `jszip`) are inlined into `lib/client.js` by the shared client bundle preset; their Apache-2.0 notices reach `THIRD_PARTY_NOTICES.md` through `gen-third-party-notices`. `SheetBody` keeps the parsed workbook in component state and folds only the selected sheet, so switching sheets never re-reads the bytes. The PowerPoint body copies the bytes into a standalone `ArrayBuffer` before opening, because the viewer takes ownership of the buffer it receives; the renderer sizes each slide to its scroller's `clientWidth`, so the stage, not the scroller, carries the inset around the deck. Each body takes the shared document body's whole height and reports its own scroller through `scrollportRef`, which keeps the Word zoom bar and the PowerPoint toolbar pinned while the pages or slides scroll.

</details>

**Runtime invariant:** No companion is published: the plugin registers three renderers and their bodies through registry and slot effects that already prove their own disposal, reads file bytes the document owner supplies, emits no cordis events, and owns no cross-plugin mutable state.
