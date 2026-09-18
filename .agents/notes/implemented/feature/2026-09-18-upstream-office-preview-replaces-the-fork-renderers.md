# Agent Note: Upstream Office preview replaces the fork renderers

Status: implemented

English | [中文](2026-09-18-upstream-office-preview-replaces-the-fork-renderers.zh.md)

## Problem

When the fork moved to upstream's right Sidebar, its builtin renderers covered Markdown, code, HTML, PDF, and images, so a `.docx`, `.xlsx`, or `.pptx` opened from the file tree or a deliverable card fell to the plain-text body and read "not a text file" — and those three suffixes are exactly what the composer's office chip asks the model to produce. The fork answered with `dsh-client-ui-sidebar-documentpreview-office`, a Team-only plugin that registered three browser renderers with upstream's preview registry: `docx-preview` for Word, SheetJS folded into Univer's sheets preset for Excel, and `pptx-renderer` for PowerPoint. It cost about 3.5 MB of renderer libraries in one closure-factory bundle, carried no fonts, fills, or borders into an Excel preview, and left SmartArt and EMF fallbacks unrendered.

Upstream `dsh-v0.1.6-alpha.2` ships its own Office preview: `dsh-office-to-pdf` converts DOC, DOCX, XLS, XLSX, PPT, and PPTX on the Node Host through the independently released `@deepseek-ai/libreoffice-kit`, and the shared document preview draws the result with the PDF.js worker it already loads. The web bundle mounts both rows, so the fork's Team profile inherits the feature by stacking `dsh-web-app`.

## Decision

Remove the fork plugin and its Team bundle row, and read Office documents through upstream's conversion preview. The Sidebar's registry ranked an external renderer above a builtin one, which is what kept the fork plugin in front while it existed; deleting the row is the whole uninstall.

The office **authoring** path is untouched: `packages/office/*`, `dsh-client-ui-office`, the composer's office picker, and the `office-word` / `office-excel` / `amec-ppt` / `univer*` skills all stay. Only the reader changed.

## Alternatives considered

- **Keep the fork plugin beside upstream's renderer.** Rejected: the registry would rank the fork's external renderers above the builtin conversion preview, so members would keep the browser renderers and the fork would carry 3.5 MB of libraries plus their own maintenance for a strictly narrower result.
- **Keep the fork plugin for Excel only.** Rejected: the Univer preset was chosen because it looked like a spreadsheet, but a converted PDF keeps fonts, fills, borders, and print layout, which the fold into Univer never carried. One reader for all three suffixes is also one thing to explain.
- **Convert on the Host but keep rendering in the browser.** This was the alternative the fork rejected in 2026-09 for needing a Host tool, a temp file, and a second read per open. Upstream's provider answers exactly that: conversion is a service with bounded admission and a PDF cache keyed by source content, and the Client rechecks source authorization, version, and converter generation before reusing bytes.

## Consequences

Members read Word, Excel, and PowerPoint as converted PDFs, with the file card's open and reveal actions unchanged, and gain the fidelity a LibreOffice conversion carries: fonts, fills, borders, and print layout. Reading is no longer purely in-page — the bytes reach the Host converter, which on the Team Runner is the member's own computer, not the Control Plane. A missing font is reported in the preview rather than silently substituted.

The capability given up is the live spreadsheet: an Excel preview is now paginated print output, so there is no worksheet tab strip, formula bar, or cell selection in the Sidebar. Reintroduce a fork renderer only if members ask for spreadsheet interaction in the preview, and register it beside upstream's rather than in place of it.

Packaging gains a native dependency: `@deepseek-ai/libreoffice-kit` selects a per-target engine from its `optionalDependencies`, so the WeWork installer builds must stage the engine declared for each target — or Node WASM where the kit declares none — before the preview works in a packaged Runner. The fork's own office e2e scenario and its overlay are gone with the plugin; upstream's `document-preview` e2e covers the conversion preview with its own DOC, XLS, and PPT fixtures.
