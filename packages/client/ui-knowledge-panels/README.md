---
description: "The member-facing knowledge panels: two left-navigation rows, the authorized knowledge-base list, and a retrieval a member runs without a model."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-panels

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-knowledge-panels` is private knowledge outside a conversation: two rows under the sidebar's New work task entry, the authorized knowledge bases with their documents and the one a member opens, and a retrieval they run for themselves and read ranked. A retrieval here starts no model turn and costs no tokens; what reaches a model is only what a member asks for by selecting a result, which opens a conversation narrowed to that document with the passage in its composer. The panels mount in the Team browser composition alone, beside the `/knowledge` picker whose Remote namespace they share.

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

Mount it in a composition that already mounts `@deepseek-ai/dsh-client-ui-knowledge`, whose client half mounts the `knowledge` Remote namespace these panels call.

### Minimal configuration

The plugin has no configuration.

```yaml
- name: '@deepseek-ai/dsh-api-knowledge-controller'
- name: '@deepseek-ai/dsh-client-ui-knowledge'
- name: '@deepseek-ai/dsh-client-ui-knowledge-panels'
```

### What a member reaches

| Row | Panel | What it does |
|---|---|---|
| Knowledge | `knowledge` | Shows the authorized knowledge bases as cards carrying their document count and creation day, the documents in the one a member opens, and one document in a drawer beside the list |
| Knowledge search (知识检索) | `knowledge-search` | Shows the documents in the chosen scope, runs one retrieval over it and ranks the answer by document, and opens a conversation over whichever document a member selects |

Both rows register into the sidebar's `sidebar.panellist` seat and address a `main` panel of the same id, so the sidebar owns the row and this package owns only the glyph and the panel.

### How a member moves through it

Two levels, not columns: the cards, then that knowledge base's documents. The breadcrumb above them names the path — the knowledge base is where it ends — and its earlier step is the control that goes back up; going back drops the document list and closes the drawer, because both belong to the knowledge base that was open. One document opens in a drawer over the right of the panel, which closes on its own control, on a click beside it, or on Escape.

A document card's footer carries its type, size, and day. Its state appears only when it is not the ordinary one — 解析中 or 不可检索 — because a searchable document has nothing to say, while one that is not is otherwise indistinguishable from one a retrieval simply did not rank.

The pager holds the panel's bottom right. With a total it names the total and at most seven page slots: the first and last page, the current one with its neighbours, and an ellipsis for the runs between, sliding to either end near it so the pager keeps one width. Without a total it names only the current page and offers the next while the page is full.

The retrieval panel is a search page: a heading, a query box with its scope menu and send control, and what lies under it. Before a search that is the documents in scope — the first page of each knowledge base, newest first across them, at most 30, each with its file's kind, the source's summary, and its knowledge base — so a member without a question can still pick a document. A knowledge base whose listing fails is left out; only a scope whose every listing failed says so. Enter searches (Shift+Enter is a new line, and an IME still composing owns its Enter), and the answer replaces the documents: one card per document at its best passage's rank, the first three set apart, the passages with the query's whitespace-separated terms marked, and the score as the provider gave it to two significant figures. A new scope asks again; an emptied query goes back to the documents.

Selecting any card — a document or a result — opens a chat narrowed to that document by its title, with the document above an empty composer. Only the one score the provider fuses is shown: the source answers no separate term or vector score to show beside it.

### What the panels hold

Nothing between reads, and nothing crosses between the two panels. The directory is read on every mount, a document list on every knowledge base and page, and a document's content on every document opened, so a revoked grant narrows what a member sees and a disabled knowledge base leaves it; a retrieval answer belongs to the query that asked for it.

A card shows the count and creation day the Control Plane recorded at its last reconcile, not a live reading: the directory is an authorization answer and reaches no source. A deployment that reports neither leaves the card's footer out rather than showing a zero, which is what a Control Plane older than those fields does.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

A member-run retrieval is deliberately not a Session event. The rule that model-visible input is reconstructable from the Session log is what makes a scope choice durable; a retrieval no model sees owes the log nothing, and recording it would put a member's browsing in a conversation's history. The moment that changes is the discussion a result opens, which records the ordinary `knowledge/scope` event through the same Remote as `/knowledge`.

Ranking is the provider's. The panel groups passages under their document and shows the score as given, without re-sorting or normalizing: the number is comparable within one answer, and a second opinion here would make it look like something a member could compare across queries.

### Source map

| File | Holds |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | The two rows, the two panels, and the Remote calls behind them |
| [`src/client/KnowledgeBasesPanel.tsx`](src/client/KnowledgeBasesPanel.tsx) | The knowledge-base cards, the breadcrumb, the document cards, and the drawer |
| [`src/client/DocumentPreview.tsx`](src/client/DocumentPreview.tsx) | One document, drawn from what the Control Plane served |
| [`src/client/KnowledgeSearchPanel.tsx`](src/client/KnowledgeSearchPanel.tsx) | The query box and scope menu, the documents before a search, and the ranked answer |
| [`src/client/results.ts`](src/client/results.ts) | Grouping passages under their document, how a score is written, and which runs of text a query marks |
| [`src/client/documents.ts`](src/client/documents.ts) | How a document is named and dated, and how several listings become one feed |
| [`src/client/Pager.tsx`](src/client/Pager.tsx) | The document list's pager |
| [`src/client/paging.ts`](src/client/paging.ts) | How many pages a total spans, and which of them the pager names |

<a id="further-exploration"></a>
## Further Exploration

- [dsh-client-ui-knowledge](../ui-knowledge/README.md) — the `/knowledge` picker and the composer chip, and the namespace mount these panels wait for.
- [dsh-api-knowledge-controller](../../api/knowledge-controller/README.md) — the Remote methods the panels call.
- [Member knowledge browsing Agent Note](../../../.agents/notes/proposed/feature/2026-09-16-member-knowledge-browsing-and-retrieval.md) — why the panels are global, and what the later deliveries add.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-knowledge`: a retrieval run in these panels reaches no model, and the document-narrowed scope a selected result records is what its prompt section names and what gates its search tool.

#### KV Cache effect

No direct invalidation. A discussion opens a new Session, so there is no prefix to invalidate; the scope it records is part of that Session's first request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the panels are incomplete on their own. They are current package constraints.

- **Office files are not drawn here** — the drawer draws what a browser draws from bytes on its own: a PDF, an image, anything that is text, and the parsed text the Control Plane falls back to. A `.docx`, `.xlsx`, or `.pptx` arrives as bytes and reads as "not here yet", because the renderers for those live behind the right Sidebar's session-scoped document slot and this panel has no Session.
- **A document list is a page at a time** — there is no search within a knowledge base, no sort, and no folder tree, so finding one document in thousands means paging to it.
- **A preview is re-read, never kept** — opening the same document twice reads it twice, and nothing is cached between panels or reloads. That is deliberate for a file whose authorization is decided per call.
- **A document is identified by its title** — passages carry no document reference yet, so two documents sharing one title inside one knowledge base group as one result.
- **A result that named no document is discussed at knowledge-base scope** — a passage whose source this build could not address narrows a conversation only as far as its knowledge base, which is the narrowest such a result supports.
- **No change notification** — a panel left open does not learn that a grant changed; it sees the narrowed directory the next time it is opened.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `knowledge` Remote namespace is mounted once per Client, by `dsh-client-ui-knowledge`. This plugin injects `remote.knowledge` and never mounts it: a second mount is refused as a namespace collision, which would take down whichever plugin lost the race.

</details>

**Runtime invariant:** No companion is published: every relationship this package owns is between a row and the panel of the same id, which the slot registry already refuses to break, and a panel holds no state a second observation could disagree with.
