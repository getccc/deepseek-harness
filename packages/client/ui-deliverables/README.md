---
description: "Produced-files and clickable file references for the Web GUI: the document cards and chip lane a finished turn ends with, the service other plugins teach a tool through, and inline-code links in the closing prose; for users and maintainers of the deliverables experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deliverables

English | [中文](README.zh.md)

## Summary

This package renders the deliverables a finished turn ends with — a card for each document the turn handed back and a chip lane for the other files the mutation tools created or modified — and links matching inline-code references in the closing prose, so a mentioned file opens through the Workspace opener. The vocabulary comes from the mutation tools' own arguments and from the tools other plugins teach it through `ctx.deliverables`, never from the closing prose — a produced file is listed whether or not the model remembered to name it. The shipped Web patch is the only composition that loads this package; removing its cordis.yml entry removes the guidance, cards, chips, service, and prose links together.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation`; a finished turn then ends with the produced files between the closing message's body and its action footer. Each card and chip opens the file through `ctx.workspaces.openPath`, the browser's one file-open door, with relative paths resolved against the session cwd; a sidebar plugin that wraps that door shows the file in its own preview instead of handing it to the Host. When the chip lane first appears, it queries `session.canOpenWorkspacePath()`, and a **Show in folder** action opens the session workspace only when the page is loopback and that query succeeds with `true`.

### Document cards

A `.md`, `.docx`, `.xlsx`, `.csv`, `.pptx`, or `.pdf` the turn produced is a card: a tile naming the document family by its extension, the file name, and the path. Cards stack above the chip lane because a document's name is what a reader scans for; a turn that produced only documents shows no lane at all.

### The row

The row lists every other produced file and shows the largest leading prefix that fits — up to six chips, basename text with the full path as the title — reserving the exact localized `+ N files` width, so the remainder stays visible without wrapping or horizontal scrolling.

### Teaching the row a tool

A plugin whose tool writes files outside `write`, `edit`, and `str_replace_editor` calls `ctx.deliverables.recognize({ tool, path })`: `tool` is the wire name, and `path` reads the produced path off one call's parsed arguments or answers null. Every successful call then lists that path exactly as a first-party `write` does, a live conversation folds again with the tool it just learned, and the returned disposer forgets it. A tool is taught once — the first-party set and an already-taught tool both refuse a second teacher. `dsh-client-ui-office` teaches it `univer_export`, whose `output` names the document the office tools handed back.

### Inline-code links

The closing prose carries the same vocabulary: an inline-code token resolves by exact path, or by being exactly the basename of exactly one produced path — a basename two paths share stays inert rather than guessing, so a mention can never open the wrong file. A resolved mention keeps its code chip and takes the markdown sheet's link language, with the full path as its title.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Node half registers the static `ui:deliverable-file-references` system-prompt section asking the model to mention primary files from successful creation or modification calls and to write those and any other changed-file references as Markdown inline code. The browser half registers `ProducedFiles` into the chat view's `conversation.chat.turnTail` hole at `TURN_TAIL_PRIORITY` (`-10`), below the default rank and below the row twin a sidebar plugin registers at `-1`, so the cards are what a member sees while every click still leaves through the Workspace opener such a plugin wraps. `createDeliverablesDefinition(recognizers)` folds each Turn's successful mutation calls into `DeliverablesTurnData` from the validated raw arguments of `write`, `edit`, and mutating `str_replace_editor` commands, and from the taught tools' recognizers; the plugin re-registers the Definition whenever the recognizer set changes, which rebuilds any live assembly. Reads, deletes, untaught tools, malformed calls, blank paths, and failed results contribute nothing. `documentKind` decides by extension which paths become cards. The package also provides the `chatFileMentions` service the chat view consults per closing message and the `deliverables` service; composing the plugin out removes every surface and leaves the view's empty chain at zero cost.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the deliverables surface is not enough. They move from the row to the turn-tail hole and the decisions behind the vocabulary.

- [ui-conversation](../ui-conversation/README.md) — declares the `conversation.chat.turnTail` hole and renders the closing prose.
- [Workspace file links](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.md) — the decision behind the produced-files row and the Host open path.
- [Deliverable cards open in the sidebar](../../../.agents/notes/implemented/feature/2026-09-04-deliverable-cards-open-in-the-sidebar.md) — the decision behind the document cards, the taught tools, and the one file-open door.
- [Inline file mentions](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.md) — the decision behind clickable mentions in the closing prose.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

### Clickable file-reference guidance

#### What the model sees

One fixed paragraph instructs the model to name primary files from successful creation or modification calls in its final response and to format those and any other changed-file references as exact-path or unique-basename Markdown inline code, such as `out/report.html`.

#### Token effect

One fixed prompt paragraph whenever this package is loaded; no tool schema, tool result, or per-Turn context is added.

#### KV Cache effect

The section is static at first-party order 9000 for the lifetime of the package mount, so it remains in the reusable prompt prefix and does not change across Turns.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current deliverables vocabulary. They are current package constraints, not a general file-linking comparison or a task backlog.

- **Mention matching is exact path or unique basename only** — a suffix mention stays inert; widening the matcher is deferred until a real closing-message shape needs it.
- **Files created indirectly by terminal commands remain outside the matching vocabulary** — naming such a file in inline code does not make it clickable unless a successful mutation location also records that path.
- **Every successful taught call lists its file** — a model's round-trip probe export sits beside the deliverable it verified until the model deletes it, because the vocabulary reads arguments, not the closing prose.
- **Cards are chosen by extension** — a document written under another name, and every `.html` page, stays a chip.
- **Native folder handoff targets the Host desktop** — a browser reached through a non-loopback authority omits the action, as does a deployment reporting no native opener; SSH forwarding that makes a remote Host look loopback-local must set the Session Controller's `nativeOpen: false`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
