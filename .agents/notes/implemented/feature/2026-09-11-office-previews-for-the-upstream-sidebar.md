# Agent Note: Office previews for the upstream Sidebar

Status: implemented

English | [中文](2026-09-11-office-previews-for-the-upstream-sidebar.zh.md)

## Problem

Word, Excel, and PowerPoint previews in the right Sidebar came from the third-party office previewer the Team installer shipped, which registered only with the third-party sidebar's service. The [two-stage upstream merge](../process/2026-09-10-two-stage-upstream-merge.md) replaced both with upstream's Sidebar, whose builtin renderers cover Markdown, code, HTML, PDF, and images, so a `.docx`, `.xlsx`, or `.pptx` opened from the file tree or a deliverable card fell to the plain-text body and read "not a text file". The office deliverables the composer chip asks for are exactly those files.

## Decision

A fork-owned client plugin, `dsh-client-ui-sidebar-documentpreview-office`, registers three external renderers with upstream's document preview registry and seats their bodies in the keyed `sidebar.right.tab.document` slot: `docx-preview` for Word, SheetJS for Excel (one worksheet at a time as a bounded text table), and `pptx-renderer` for PowerPoint. It mounts through one row of the Team bundle's patch and nowhere else. Upstream's registry ranks an external implementation above a builtin one for the same suffix and its toolbar lets a reader switch among registered renderers, so an upstream office renderer can later be tried beside this one and this package removed by deleting that row.

## Alternatives considered

- **Bring the third-party previewer back.** Rejected: it speaks the retired sidebar's service, not upstream's registry, and carried Univer beside the same three libraries.
- **Convert documents on the Host and preview the result.** Rejected: the Sidebar's document owner already delivers complete bytes to a renderer, and a conversion step would need a Host tool, a temp file, and a second read for every open.
- **Load the renderer libraries on first use.** Rejected for now: the client bundle format is one closure-factory artifact per plugin with no chunk loading, so the three libraries ship in one bundle of about 3.5 MB.

## Consequences

Members read office documents in place again, with the file card's open and reveal actions unchanged. Excel previews show cached values and stop at 2,000 rows or 200 columns with a notice; PowerPoint fidelity is the renderer's, and SmartArt or EMF fallbacks that need PDF.js are not bundled. The registration and each body are covered by the package's specs, with a generated Word package and workbook as fixtures and the PowerPoint viewer mocked; the Web e2e lane gains an office scenario that drives a recorded turn over the shipped composition plus an overlay mounting the plugin, then opens a generated Word document and workbook from Files.
