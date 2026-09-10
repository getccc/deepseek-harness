# Agent Note: deliverable cards open in the sidebar

Status: implemented

English | [中文](2026-09-04-deliverable-cards-open-in-the-sidebar.zh.md)

## Problem

A Team member asked the Welinkin Work desktop application for a Word document, a workbook, or a deck and, when the turn finished, had nothing to click. The office tools hand a document back through `univer_export`, whose `output` argument names the `.docx`, `.xlsx`, or `.pptx` file written; the produced-files row read only `write`, `edit`, and `str_replace_editor`, so a turn that produced a deck ended with no row at all, and the document was reachable only by finding it in the explorer. A `.md` the model wrote through `write` did appear, as one chip among the source files. The member's reference was Trae: a card at the foot of the turn naming the document, which opens it in a preview beside the conversation.

Two further facts stood between the row and that experience. The sidebar plugin the deployment ships, `dsh-better-sidebar`, previews files by wrapping `ctx.workspaces.openPath`, the door every chat-side file open once went through; the chat had since started calling `session.openWorkspacePath` directly, so the plugin's wrapper wrapped nothing, a click on a stock chip left through the operating system, and the plugin's own row twin, registered at priority `-1`, was what a member actually saw. And the sidebar previews images, Markdown, HTML, and PDF itself, but an `.xlsx` answered `此文件类型不支持预览` with a download button: office previews live in a separate plugin the sidebar's own catalog recommends, and the deployment did not ship it.

## Decision

**Superseded on 2026-09-10 by the [two-stage upstream merge](../process/2026-09-10-two-stage-upstream-merge.md):** the third-party sidebar and office previewer this note wires into left the deployment; upstream's Sidebar and file delivery own the row now.

**A document the turn produced is a card.** `dsh-client-ui-deliverables` renders a `.md`, `.docx`, `.xlsx`, `.csv`, `.pptx`, or `.pdf` as a card — a tile naming the family by its extension, the file name, the path — stacked above the chip lane, which keeps every other file. `documentKind` decides by extension, and a turn that produced only documents shows no lane. The entry registers at `TURN_TAIL_PRIORITY`, `-10`, below the default and below the sidebar's row twin, so the cards are what a member sees.

**The row learns tools from the plugins that own them.** `ctx.deliverables.recognize({ tool, path })` teaches the vocabulary one tool: `path` reads the produced path off one call's parsed arguments, and a successful call then lists it exactly as `write` does. The Definition reads the live recognizer set on every fold and is re-registered when the set changes, so a conversation already on screen folds again with the tool it just learned; the first-party set and an already-taught tool refuse a second teacher. `dsh-client-ui-office`, the package that already speaks for the office tools, teaches `univer_export` reading `output`.

**`ctx.workspaces.openPath` is the browser's one file-open door again.** `IWorkspaces` carries `openPath(path)`, `WorkspaceController` hands the resolved path to `session.openWorkspacePath` and raises the Host's own message as `WorkspaceOpenPathError`, and the chat's `openFile` resolves against the Session workspace and calls it. Every card, chip, tool-row path link, and prose mention leaves through it, so the sidebar plugin's wrapper takes them all into its editor tab, which expands the panel and matches a viewer by extension; a deployment without such a plugin reaches the Host opener as before.

**The desktop installer ships the office previewer.** `@huanlin/dsh-plugin-better-sidebar-plugin-office`, the plugin the sidebar's own catalog names for `.docx`, `.xlsx`, and `.pptx`, joins `SHIPPED_PLUGIN_BUNDLES` after the sidebar it registers with, installed into the staging profile whose `node_modules` `DSH_TEAM_PLUGIN_TREE` stages.

## Alternatives considered

**Read `univer_export` in the deliverables package itself.** One more case in `mutationPath` would have listed the file with no seam. Rejected: the package would then name a third-party tool it knows nothing else about, and every further tool would need the same edit. The seam costs one service method and puts the office coupling where the office prompt already is.

**Read the presenter's `locations` instead of arguments.** The sidebar's row twin derives produced files from `ToolCallView.locations`. Rejected: `univer_export` presents no location, and the Definition folds Session events, which carry arguments and not presentation; a recognizer reads what is there.

**Leave the sidebar's row twin in front.** Rejected: the twin renders chips, and the member asked for cards. Shadowing it costs one priority constant, and the sidebar's own opens keep working because they go through the door this decision restores.

**Call the sidebar service from the card.** The card could open its file through `ctx.betterSidebar.openTab` when present. Rejected: the harness would then know a plugin's face, and a chip, a tool row, and a prose mention would each need the same knowledge. Restoring the one door the plugin already wraps serves all of them.

**Render office previews in the harness.** A viewer of its own for `.docx`, `.xlsx`, and `.pptx` would have needed the same render libraries the recommended plugin carries. Rejected under [dependencies over hand-rolling](../process/2026-07-26-dependencies-over-hand-rolling.md): the plugin exists, is maintained, and registers through the sidebar's documented viewer service.

## Consequences

A finished turn that handed back a document ends with a card; clicking it expands the sidebar, and with the office previewer shipped the workbook, document, or deck renders there, while `.md` opens in the sidebar's Markdown preview. Every chat-side open again goes through one method a plugin can wrap, which the sidebar's existing interception relies on, and the chat and tool tests assert the Workspace service call rather than the Remote. A round-trip probe export the model makes to verify its work is listed like any other successful export until the model deletes it, because the vocabulary reads arguments, and a document written through a shell command is not listed at all. The installer grows by the office previewer's render libraries. The client tests of `ui-deliverables`, `ui-office`, `workspace-controller`, `ui-chat`, and `ui-tool` pin the cards, the taught tool, the door, and its refusal; the packaged application needs a rebuild with the staged plugin tree before a member sees the previewer.
