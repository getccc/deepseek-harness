# Agent Note: Members read and search private knowledge outside a conversation

Status: proposed

English | [中文](2026-09-16-member-knowledge-browsing-and-retrieval.zh.md)

## Problem

Private knowledge reaches a member only as something a model does on their behalf. [The first delivery](2026-09-01-team-private-knowledge-control-plane.md) shipped an authorized directory and passage search, and both are consumed inside a conversation: `/knowledge` picks a scope, the prompt names it, and `knowledge_search` retrieves passages the member sees only as a tool result inside an answer.

Three things a member needs are therefore unreachable. They cannot see what a knowledge base holds — the directory names knowledge bases and stops there, so a member deciding whether to select one is guessing at its contents. They cannot read a document: search returns passages, and the document those passages came from is named but cannot be opened. And they cannot judge retrieval itself — whether a query finds the right material, and how the ranking orders it — because every search is buried in a model turn that paraphrases the result and never shows the score.

The first delivery named full-document reading as a deferred second delivery. Document listing was not deferred: it was not designed at all, because nothing in a model-facing retrieval surface needed it. Both are now required by the product, and they are required outside a conversation — a member who wants to look something up should not have to start one.

## Proposal

Ship a member-facing knowledge surface as two global panels reached from the left navigation, and extend the knowledge seam with the two operations they need: list the documents in an authorized knowledge base, and read one document's content.

### Product outcome

- A member sees **知识库** and **知识库检索** under **新工作任务** in the left navigation of a Team build. A build without private knowledge shows neither.
- **知识库** opens a panel showing the knowledge bases the member's roles authorize as cards, each naming how many documents it holds and the day the source created it. Opening one lists its documents under a breadcrumb that goes back up; opening a document draws it in a drawer over the right of the panel.
- **知识库检索** opens a panel that runs one retrieval and shows the passages ranked by score, grouped under the document each came from, with no model turn and no token cost.
- Selecting a result's document starts a new Session whose knowledge scope is narrowed to that one document, so the conversation that follows retrieves from it and nothing else.
- Every panel operation is authorized on the Control Plane against current grants, exactly as `knowledge_search` already is. Revoking a role, suspending the member, revoking the device, or disabling the knowledge base changes the next panel operation without a new login.

### Non-goals for this delivery

- Do not offer upload, deletion, reparsing, folder editing, tagging, or any other mutation of upstream knowledge. Both panels are read-only.
- Do not persist a document, a passage, or a directory on the member computer. Preview bytes are transient UI input and reach no workspace, cache, or attachment store.
- Do not return an upstream URL, an upstream identifier, or a credential to the browser. The panels address knowledge through DSH references alone.
- Do not add a model-facing document-reading tool. The model's retrieval surface stays `knowledge_search`; this delivery narrows what that tool may reach, and adds nothing it may call.
- Do not expose WeKnora composed answers, custom agents, or session continuation.

## What the member reaches from the left navigation

The left navigation already has the seat: `sidebar.panellist` is a list slot whose rows render directly under the New chat and New work task entries, each row addressing a `main` panel by the same id ([contract/slots.ts](../../../../packages/client/ui-sidebar/src/client/contract/slots.ts)). No production plugin registers into it yet; these two rows are the first, and the sidebar shell needs no change to carry them.

Both panels are root-scoped and hold no Session. The knowledge panel therefore draws documents itself rather than opening the right Sidebar, whose tabs are session-scoped and whose docking surface exists per Session.

Inside the panel it is two levels and a drawer rather than side-by-side columns: the cards, then one knowledge base's documents with a breadcrumb back up, then one document over the right of the panel. Columns would have given every level a third of the width whether or not a member was reading a document, and a knowledge base's name is what a member needs above the list either way.

A card names its document count and creation day, and both come from the catalog mirror rather than a live upstream read: the directory is an authorization answer, and making it reach the source would put the source's availability in front of a member who only wanted to see what there is. The count was already mirrored; the creation time cost the catalog one nullable column, `knowledge_base.upstream_created_at`, and a `SCHEMA_VERSION` of 4. That bump is the whole price, and it is paid by hand on a deployment holding an older file, because this repository ships no migration code for its SQLite stores.

That cuts the panel off from the right Sidebar's registered document bodies, which is the one thing this shape costs: the renderer slot is declared by the Sidebar's own tab type and scoped to a Session, so the Word, Excel, and PowerPoint bodies cannot be rendered from a panel that has none. The drawer therefore draws what a browser draws from bytes on its own — PDFs, images, anything that is text — plus the parsed text the Control Plane falls back to, and says plainly that an Office file is not shown here yet. Closing that gap means a renderer seat both surfaces can reach, which is its own change to the Sidebar's contract.

## Capability and package topology

| Package | What this delivery adds |
|---|---|
| `packages/knowledge/knowledge` | `documents` and `documentContent` on the service, the `KnowledgeDocRef` brand, the recorded document narrowing, and the `document-unavailable` failure reason |
| `packages/knowledge/knowledge-source` | `listDocuments` and `fetchDocument` in upstream identifiers, beside the existing `list` and `search` |
| `packages/knowledge/knowledge-weknora` | Three more fixed endpoints, the document byte bound, and `knowledge_id` retained on every search hit |
| `packages/knowledge/knowledge-gateway` | The two governed operations, each authorizing the knowledge base the document belongs to |
| `packages/knowledge/knowledge-gateway-sqlite` | Authorization and audit for both operations; the catalog records no document |
| `packages/knowledge/knowledge-gateway-http` | Two Runner-facing routes and the raised knowledge protocol version |
| `packages/knowledge/knowledge-team` | The Runner-side provider for both operations |
| `packages/knowledge/tool-knowledge` | The prompt section and search request for a document-level scope |
| `packages/api/knowledge-controller` | `directory`, `documents`, `documentContent`, and `search` remotes for the browser |
| `packages/client/ui-knowledge-panels` (new) | The two navigation rows, the two panels, and the document drawer |
| `packages/bundle/team` | The composition rows that mount the new client package |

The catalog stays a catalog of knowledge bases. A document is not a governed resource, is not synchronized, and gets no durable row: it exists upstream, it is named by a reference the gateway can verify, and the grant that admits it is the one on its knowledge base.

## Knowledge document references

A document reference is its knowledge base's reference, a `/`, and the upstream document id: `weknora:lingang:<kbId>/<docId>`. It is a separate brand from `KnowledgeRef` with its own validation and its own maximum length, because `KnowledgeRef` is bounded at 64 characters by the audit store's `resource_id` token and two upstream UUIDs do not fit. Nothing is lost by that separation: audit rows record the knowledge base resource, which is what a grant names and what an administrator disables.

Every operation taking a document reference resolves the document upstream and refuses when the knowledge base it belongs to is not the one the reference names. That check is what makes an unsigned reference safe: possession of a reference proves nothing, the knowledge base in it is re-authorized on every call, and a reference whose two halves disagree is refused before any content is read. It replaces the signed reference with a validity window that the first delivery sketched, which would have needed a signing key, a rotation runbook, and two bounds that are wrong for some Session.

## Control Plane API additions

| Method and path | Operation | Behavior |
|---|---|---|
| `POST /team/knowledge/documents` | Document listing | Verifies the device token, authorizes the named knowledge base, lists one page of its documents, and returns document references, titles, file types, sizes, and parse state |
| `POST /team/knowledge/document` | Document content | Verifies the device token, resolves the document's knowledge base and authorizes it, then returns the original file bytes with a content type and file name, or the parsed text when bytes are unavailable |

Both routes carry `protocolVersion` and are refused before any other field is decoded when the request declares a version this build does not serve, exactly as the existing two do. Adding routes raises the current knowledge protocol version and leaves the minimum alone. The version is the request's, not the Runner's: a Runner built before this delivery keeps searching and keeps its directory and has no panels to call the new routes from, and a Runner updated ahead of its Control Plane keeps the same two operations and is refused only where it asks for a route that deployment has never had.

A request body still names no organization, principal, device, origin, tenant, credential, or upstream identifier. The document reference is the only new field, and it is a DSH reference the gateway resolves itself.

## Upstream operations this delivery uses

Pinned against the deployment's own routes and handlers, as the first delivery's contract fixtures are:

| Purpose | Endpoint | Upstream access level |
|---|---|---|
| One page of a knowledge base's documents | `GET /api/v1/knowledge-bases/{id}/knowledge` | viewer, knowledge-base read |
| One document's metadata, including its knowledge base | `GET /api/v1/knowledge/{id}` | viewer |
| The original file bytes, typed by file name for in-browser display | `GET /api/v1/knowledge/{id}/preview` | viewer, knowledge-base read |
| The parsed chunk text of one document | `GET /api/v1/chunks/{knowledgeId}` | viewer |
| Retrieval narrowed to named documents | `knowledge_ids` in the existing `hybrid-search` body | unchanged |

`GET /api/v1/knowledge/{id}/download` serves the same bytes but requires contributor rights and knowledge-base write access upstream, so this delivery uses `preview` instead. The distinction is not about which credential the deployment holds — it is that a read-only product surface must not be built on an endpoint whose upstream guard is a write guard.

Search hits already carry `knowledge_id` and `knowledge_title`; the provider currently drops the first. Keeping it is what lets a ranked result name its document, and it is the only change the existing search path needs.

## Document-level Session scope

A `selected` scope naming exactly one knowledge base carries the documents inside it, as an optional `documents` on that recorded entry — each a reference with the title it was chosen by.

It is an optional property rather than a mode of its own, and the reason is the persistence mechanism rather than taste. A new union variant is classed as a changed type, which requires a `SESSION_FORMAT_VERSION` bump and the whole adjacent-migration apparatus: a format package, an identity edge with per-artifact stages, snapshot successors, historical-format documents, and a `release/*` integration base. An optional property is a same-version addition. The feature does not earn a format generation, so it takes the shape the rules allow ([record](../../../../docs/persistence-changes/2026-09-16-knowledge-scope-documents.md)).

That choice has one cost, and it is stated rather than hidden: a build that predates the field ignores it and searches the whole knowledge base — wider than the member chose, never narrower. Reaching it takes a member recording a narrowed scope on a newer build, downgrading their packaged Runner, and resuming that Session. A new mode would instead have made an older build refuse the log outright, which is cleaner and costs a format generation.

Each document's title is recorded beside its reference, and the prompt names the document by it. A conversation about one report should be able to say which report, and a model-visible name has to come from the log. The title is the one the member saw, sent by the browser and folded by the controller to one line of at most 200 characters: no governed operation describes a single document, and the title is a label rather than an authorization fact — what is authorized is the knowledge base holding the document. The field is still unreleased, so it replaced the reference-only `docRefs` inside the same acknowledgement rather than stacking a second one; a development log that recorded `docRefs` reads as the whole knowledge base, the same downgrade an older build takes.

<a id="a-document-conversation-is-a-chat-that-can-search"></a>
## A document conversation is a chat that can search

Opening a conversation about a document creates a chat Session: a member reading one report should not have to pick a working directory first. The shipped `chat` preset masks every host tool with `allow: []`, and until this change that included `knowledge_search`, so such a conversation recorded a scope its model was told about and could not use. `dsh-tool-restriction` now takes `allowWhenRegistered`, and the chat preset lists `knowledge_search` there. It stays visible only where a Team deployment registers it, and the tool's own rule still withholds it until a knowledge scope is recorded, so an ordinary chat sends no tool schema.

A Team-only preset holding the same composition was the alternative. Its root would have had to be an absolute path inside an installed bundle, resolved at load in a packaged Runner, and the chat preset already carries a per-session tool in exactly this way. The price of the chosen form is on the restriction row: a name in `allowWhenRegistered` gets no misspelling check, and the list is read once at mount.

The document shows above the composer the way an attached file does, one chip per document from the `ui-knowledge` dock, and its × takes it off; the last one off turns knowledge off rather than widening to a knowledge base the member never chose.

Two invariants hold in the validator rather than in convention: every document reference must resolve to the knowledge base carrying it, and a scope naming several knowledge bases may not carry documents at all, because the upstream narrowing applies inside one.

The scope narrows authorization and never widens it, unchanged from the first delivery. A document-level scope is still authorized as its knowledge base on every call; it adds a filter the gateway passes upstream, not a new thing a member may reach.

## Document preview delivery and bounds

The Control Plane returns complete file bytes under a configured `maxDocumentBytes`, and the Runner hands them to the browser the way workspace files already deliver complete bytes: one base64 payload over the existing remote, decoded into the `DocumentContent` a renderer reads. Nothing new is opened on the Runner.

Two bounds are deliberate and separate. `maxDocumentBytes` on the source provider is what the Control Plane is willing to pull from upstream and hold in memory; the controller's own bound is what a browser is willing to decode. A document over either bound is not an error the member has to solve: the panel falls back to the parsed chunk text, which also serves a document whose type no registered renderer claims.

## Permissions

`knowledge.search` admits document listing and document reading in this delivery. The permission catalog's `knowledge.read` and `knowledge.download` stay ungranted where the first delivery left them.

This is a deliberate deviation from that delivery, which named full-document reading as a grant of its own, and the reason to record is that the deviation is a product decision rather than an oversight: a member who may retrieve passages from a knowledge base may also open the documents those passages are in. Two things keep it reversible. The gateway reads the action it evaluates from one constant per operation, so tightening a document read to `knowledge.read` is that constant plus a role-editor mode, not a re-layered authorization path. And document reads are audited under their own action, so the audit trail separates "retrieved passages" from "opened the file" even while one grant admits both.

## Audit

`knowledge.document.list` and `knowledge.document.read` join `AUDIT_ACTIONS` with the closed metadata the existing knowledge actions use — a bounded count and the upstream failure label. Both record the knowledge base resource, never the document, because the document is not a governed resource and a document title is prose.

Adding actions is safe against an existing store: actions and metadata keys are re-seeded by insert on every open. Audit reasons are not, which is why upstream failure kinds continue to arrive as a label rather than a new `AuditReason`.

Queries, titles, file names, passages, bytes, and upstream errors stay out of the audit store and ordinary logs, unchanged.

## Delivery plan

Four changes, each shippable on its own.

**Retrieval panel and the two navigation rows.** The new client package, both navigation rows, the 知识库检索 panel, and the controller's `search` and `directory` remotes. No Control Plane route changes and no new permission: this runs on the search path that already ships. Selecting a result starts a Session scoped to the result's knowledge base with the passage quoted, which the last change replaces.

**Document listing.** The `documents` operation through all five layers, the listing route, its audit action, and the 知识库 panel's document list.

**Document content.** The `documentContent` operation, the content route, the drawer, and the chunk-text fallback.

**Document-level scope.** The recorded `documents`, the prompt section and search request that read it, the picker and composer chip that display it, and the retrieval panel's document-narrowed Session.

## Alternatives considered

**Preview in the right Sidebar.** The right Sidebar owns document preview today, including the Office renderers, and reusing it would have bought splitting, floating, and multiple tabs. Its tabs are scoped to a Session and its docking surface is created per Session, while these panels are root-scoped and deliberately have no Session; giving the panels one would mean inventing a Session that exists only to hold a preview. The panel draws documents itself instead, and the price is that the Office bodies stay on the far side of that Session boundary.

**Preview the parsed chunk text only.** Cheapest and safest: no company file leaves the Control Plane, and the retrieved passage can be highlighted in place. It loses the document — layout, tables, images, and page structure are exactly what a member opening a report is looking for. Chunk text remains as the fallback for a document over the byte bound or in a type no renderer claims.

**A second grant for browsing and reading.** `knowledge.read` exists in the permission catalog for this, and the first delivery reserved it deliberately. Requiring it would make every deployment configure a second grant before the panels do anything, and the product's position is that retrieval access to a knowledge base already implies reading its documents. Recorded as a deviation with the two hedges above rather than as the design's intent.

**A signed document reference with a validity window.** The first delivery's sketch for full-document reading. Verifying the document's knowledge base upstream on every call gives the same guarantee — a reference cannot reach a knowledge base the caller is not authorized for — without a signing key, its rotation, or a validity window that is wrong for either a long Session or a shared link.

**Discussing a result at knowledge-base scope.** Starting the Session at the result's knowledge base and quoting the passage needs no scope change at all, and it is what the first delivery ships as. It answers a different question than the member asked: they selected one document, and a conversation that retrieves from the whole knowledge base will answer from documents they did not select. Kept as the first change's behavior, replaced by the fourth.

**Materializing a knowledge document into the workspace.** Downloading the file into the Session workspace would have made the existing file preview work with no new content path at all. It writes company documents onto member computers, where nothing revokes them, and it turns a read the Control Plane authorizes per call into a file that outlives the grant.

## Acceptance criteria

- Both navigation rows appear under New work task in a Team build, in the member's locale, and are absent from a build that mounts no knowledge service.
- The 知识库 panel lists exactly the knowledge bases the member's roles authorize, lists one selected knowledge base's documents, and previews a selected document from its original bytes; a document over the byte bound or in an unclaimed type previews as parsed text.
- The 知识库检索 panel returns passages ordered by score with their document titles, starts no model turn, and appends no Session event.
- Selecting a result opens a chat Session whose folded scope is that one document with its title, whose prompt section names it, whose composer shows it as an attached file, and which is offered `knowledge_search` retrieving from it alone.
- A document reference whose knowledge base the member does not hold a grant on is refused, and refused identically whether the knowledge base is unauthorized, disabled, or absent.
- A document reference naming a knowledge base the document does not belong to is refused before any content is read.
- Revoking the grant, disabling the knowledge base, or revoking the device changes the next panel operation without a new login or a new Session.
- The audit store records one `knowledge.document.list` or `knowledge.document.read` row per operation against the knowledge base resource, carrying no query, title, file name, or upstream text.
- A Runner built before this delivery keeps its directory and search against a Control Plane serving the new routes.
- A Runner updated ahead of its Control Plane keeps its directory and its whole-knowledge-base search, and is refused `update-required` only on the document operations and a document-narrowed search. The protocol version therefore travels per request, not per Runner.
- A document-narrowed Session's prompt section and tool visibility are covered where they can be: by the owning packages' tests, because no recorded-session tier can reach knowledge at all (see the coverage gap below).

## Named coverage gap: no recorded-session tier reaches knowledge

Every knowledge operation goes through a Control Plane, and the recorded-session harness records model traffic alone. No keyless scenario can therefore exercise the prompt section, the tool visibility, or a transcript of a knowledge search, which is why none of these deliveries updates `snapshots/session/`, `snapshots/sdk/`, or the Python SDK projection: there is nothing in them to change.

What the browser flow does get is an assembled tier. `apps/web/tests/knowledge-panels.e2e.ts` boots the shipped rows with a fixture `ctx.knowledge` in the same process, drives both panels in a real browser, and reads back the `knowledge/scope` event the discussion recorded. It is also the only tier that runs the generated Remote client, which counts declared parameters rather than required ones: a panel call that omits a trailing optional is refused before it reaches the wire, and no unit test sees that.

Closing it means teaching the harness to replay a recorded knowledge transport — a fixture for the Runner-facing routes, recorded once against a real Control Plane and replayed keylessly, the way model traffic already is. That is its own change, and until it lands the model-visible surface here is pinned by package tests plus the real-deployment e2e a maintainer runs by hand.

## Risks

**The largest surface a knowledge refusal now has.** Four operations instead of two, each with the same closed reasons, reaching a panel rather than a tool result. A panel that renders a refusal as an empty list would tell a member they have access to nothing, which is the failure the first delivery called out for the directory; every panel state distinguishes refused, empty, and unreachable.

**Company documents in a browser.** Preview puts original files in the member's browser, where the operating system's own capabilities — printing, saving the rendered page, screen capture — are outside anything the Control Plane can revoke. The delivery bounds what it hands over and persists nothing, and is explicit that this is a read-authorization control, not a copy control.

**Upstream pagination and parse state.** A knowledge base with many documents, or documents still being parsed upstream, makes the listing a moving target. The panel pages, shows parse state, and refreshes on demand rather than caching a directory the Control Plane would have to invalidate.

**A wider surface for the one credential.** Three more upstream endpoints are reachable through the Control Plane's space key. All three are read-level upstream and the provider still calls a fixed set with no caller-supplied path, but the blast radius of a compromised Control Plane grows from retrieval to whole documents.

**The scope change's blast radius.** The fourth change touches a persisted event payload, the prompt, tool visibility, the picker, and the chip. It is last in the sequence for that reason, and everything before it ships without it.

**A downgrade widens a narrowed conversation.** The optional-property shape buys same-version persistence at the price named above: an older build resuming a narrowed Session searches the whole knowledge base. A deployment that cannot accept that has one option — spend a format generation on a mode of its own.
