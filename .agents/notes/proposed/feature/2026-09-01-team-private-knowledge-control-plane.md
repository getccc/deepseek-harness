# Agent Note: Team private knowledge stays behind the Control Plane

Status: proposed

English | [中文](2026-09-01-team-private-knowledge-control-plane.zh.md)

## Problem

Team Edition has the identity, device credential, role, grant, managed-resource, policy-revision, audit, administration, and Runner transport foundations needed to govern company knowledge, but it has no knowledge capability that connects them. A member can install an external WeKnora plugin in a Runner and retrieve content with a fixed API key, yet that direct path does not know the signed-in DSH principal or the principal's current roles.

Such a plugin's configured knowledge-base ids are defaults rather than an authorization ceiling. Its search tool accepts caller-supplied knowledge-base ids, its document tool accepts a document id without a DSH resource decision, and a custom-agent path can let WeKnora choose knowledge bases. A menu that hides unauthorized entries or a `/knowledge` command that changes those defaults would improve discovery but would not prevent a model, another local plugin, or a crafted HTTP request from naming another knowledge base.

Putting the WeKnora API key on the Runner creates a second problem. Any plugin in that process can reach the credential and the upstream server directly, bypassing Control Plane revocation, resource disablement, and audit. Encoding roles into a long-lived key or access token would leave authorization stale after an administrator changes a binding.

The user experience still needs an explicit, understandable control. A member should be able to choose which authorized knowledge bases the current Session may retrieve from, and that choice must reach the model: a selection the model cannot see is a selection that changes nothing. The choice affects model-visible retrieval and therefore must survive resume, fork, replay, and audit without becoming an authorization source.

## Proposal

Ship private knowledge as a built-in Team capability. The `team` profile mounts the Runner-side knowledge Service Provider, the model-facing search tool, and the Web command contribution; a Team user installs no external WeKnora plugin. The `team-control-plane` profile mounts the WeKnora provider, the durable governed catalog, the Runner-facing gateway, and the administration routes. The Control Plane holds the upstream address and credential and authorizes every operation against current account and grant state.

The first delivery supports an authorized directory and hybrid passage search. It deliberately omits paged full-document reading, WeKnora composed answers, custom agents, resumable WeKnora chat sessions, public resource URLs, binary downloads, knowledge ingestion, and remote mutation. Those operations need additional authorization, session ownership, content delivery, or audit decisions and do not enter through an apparently compatible passthrough.

This proposal extends rather than replaces the implemented decisions for [explainable access evaluation](../../implemented/architecture/2026-08-29-access-control-evaluation.md), [a non-executing Control Plane](../../implemented/architecture/2026-08-29-control-plane-carries-no-local-execution.md), [the closed audit vocabulary](../../implemented/architecture/2026-08-29-audit-closed-vocabulary.md), [the Team profile layer](../../implemented/architecture/2026-08-29-team-profile-bundle.md), [Runner version enforcement](../../implemented/architecture/2026-08-30-a-runner-that-can-be-told-it-is-too-old.md), and [the administration console](../../implemented/feature/2026-08-30-control-plane-administration-console.md). None is superseded: each remains the owner of a rule this capability consumes.

### Product outcome

- An administrator sees the WeKnora knowledge bases governed by this Control Plane under **Resource management → Knowledge bases**, refreshes the catalog, and enables or disables each entry.
- An administrator opens one role's **Knowledge access** editor and grants all knowledge bases, selected knowledge bases, or none. Selected access grants `knowledge.search` on each named managed resource.
- A member uses `/knowledge` to choose `All authorized`, a subset of currently authorized knowledge bases, or `Off` for the current Session. The command changes durable Session preference and starts no model turn.
- A Session starts at `Off`. Until a member chooses, no knowledge tool is visible to the model and no knowledge request leaves the computer.
- After a member chooses, the system prompt states the chosen scope by name and `knowledge_search` becomes visible. The member asks an ordinary question and the agent searches; every call reaches the Control Plane with the current device access token.
- Revoking a role grant, suspending the member, revoking the device, disabling the knowledge base, or removing the upstream catalog entry changes the next operation without requiring a new login or Session.
- The packaged desktop Runner binds only to loopback and makes outbound HTTPS requests to the company's remote Control Plane; the remote service never initiates a connection to a member computer.

### Non-goals for the first delivery

- Do not ship `knowledge_read`, paged full-document text, or the signed document reference that would address it. Search passages are the whole model-visible retrieval surface; [full-document reading](#deferred-full-document-reading) is a named second delivery.
- Do not expose WeKnora administration, upload, delete, chunk editing, sharing, or API-key management in DSH.
- Do not expose composed answers, custom `agentId`, WeKnora session continuation, or server-side web search.
- Do not proxy arbitrary WeKnora paths, headers, request bodies, file URLs, or provider errors.
- Do not grant `knowledge.read` or `knowledge.download`, and do not return a directly loadable upstream resource URL.
- Do not persist the Session scope choice outside the Session log. A new Session starts at `Off` rather than inheriting a user setting.
- Do not support several organizations or several WeKnora sources in one Control Plane, although stable references include a source code so that this restriction does not become persisted identity.

## Security invariants

The implementation is complete only while all of these invariants hold.

1. The Runner stores no WeKnora address, API key, tenant credential, or upstream document id that can authorize a direct upstream call.
2. Every Runner-facing request verifies the current device access token and obtains `orgId`, `principalId`, and `deviceId` from verified claims rather than request fields.
3. The Control Plane evaluates `knowledge.search` for every knowledge base named by an operation. An absent resource and an ungranted resource produce the same external refusal.
4. A request in `all` mode expands only to the principal's currently authorized enabled resources, never to every knowledge base visible to the Control Plane credential.
5. A request that names one unauthorized, unknown, missing, or disabled entry fails as a whole. The gateway never silently drops refused entries and returns partial results.
6. Every member-facing knowledge path enumerates the durable knowledge catalog and joins it to managed resources. No such path enumerates `listResources` for `knowledge_scope`, because the administration catalog resource shares that type.
7. Session knowledge scope narrows current authorization. It never adds a resource, survives only through the Session log, and is re-evaluated on each operation.
8. Search queries, returned passages, filenames that contain prose, tool arguments, upstream error bodies, and upstream URLs never enter the Control Plane audit store or ordinary logs.
9. The Control Plane calls only its configured WeKnora origin and fixed endpoint set. A Runner request has no URL, tenant, API key, header override, or arbitrary operation field.
10. The WeKnora provider requests handle-mode resources and the gateway returns text plus DSH references only. No response contains a public or credential-bearing upstream URL.
11. The desktop Runner listens only on loopback. Knowledge traffic is an outbound Runner-to-Control-Plane request and no Control Plane route requires inbound reachability to the member computer.
12. A production Runner accepts only its packaged company Control Plane HTTPS origin. It never disables TLS verification, follows a server-supplied origin, or exposes an editable arbitrary knowledge gateway.
13. Every Runner-facing knowledge request carries `protocolVersion`. The gateway evaluates that field before decoding any other operation field; an unsupported version fails with `426 Upgrade Required` and performs no knowledge operation.
14. The desktop package contains no WeKnora address or credential. WeKnora runs on the Control Plane host and is reached over loopback.
15. Whatever the model can see about the chosen scope is reconstructable from the Session log alone. The prompt section names knowledge bases only when the Session log holds those names.

## Runtime architecture

```text
3090 Team Runner                                      3095 Control Plane                         WeKnora

Web /knowledge command                               administration API                    (same host, loopback)
        |                                                     |
knowledge/scope Session event                       governed knowledge catalog
        |                                                     |
prompt section + tool visibility                            RBAC + audit
        |                                                     |
knowledge_search                                              |
        |                                                     |
Team Knowledge Provider -- current device token --> Knowledge Gateway -- fixed endpoints + key --> REST API
```

The Runner and the Control Plane speak a narrow DSH protocol rather than a transparent WeKnora proxy. The protocol names product operations and DSH references; only the provider knows WeKnora paths and upstream ids.

### Deployment topology and network ownership

Port 3095 is the remotely deployed Control Plane origin. A production reverse proxy terminates TLS and exposes the existing administration, device, and model routes plus the new `/team/knowledge/*` routes under one company origin. The proxy preserves request cancellation and response status, applies body and timeout limits compatible with the bounded knowledge protocol, and does not rewrite the bearer header into a query parameter or a log. The Control Plane process and its durable SQLite volumes sit on the trusted server network; the first SQLite release supports one active Control Plane instance rather than several instances over separate files.

WeKnora runs on that same remote host. The Control Plane reaches it over a loopback base URL, and the WeKnora listener binds loopback so that no network peer other than the Control Plane process can reach it. This is what makes invariant 14 a deployment fact rather than an aspiration: there is no WeKnora origin for a member to discover, and no credential in flight across a network segment. A future deployment that separates the two hosts must restore the equivalent restriction — a private network segment and a service identity — before it moves the base URL off loopback.

Port 3090 is the Electron-packaged Team Runner on each member computer. It binds only `127.0.0.1` or the equivalent IPv6 loopback address, serves the local browser UI, and directs every knowledge call at its packaged `controlPlaneUrl`. The knowledge provider carries that origin as its own validated config field, exactly as the company model transport does, and the desktop installer's generated profile patch is the single place the origin is written. Browser CORS is not on the knowledge path, because the local browser calls the local Runner, which then makes the authenticated server-side HTTPS request. Administration pages remain same-origin with the remote 3095 and keep their existing Session, same-origin, and CSRF controls.

One desktop build is assigned to one company Control Plane origin and embeds no company secret. The device private key stays in local application data; the Runner reads the current access token per operation and sends it only in an HTTPS `Authorization` header. Enterprise proxy, DNS, and private CA support must use explicit deployment configuration and the platform trust store; no production option disables certificate verification.

Every Runner-facing knowledge route carries a `protocolVersion` field owned by the knowledge HTTP package, with its own current and minimum values, and reuses the `ProtocolSupport` and `ProtocolRefusal` vocabulary already exported by `team-control-plane-http`. Knowledge does not share the device-binding version constant: a knowledge-only protocol change must not force the binding version up, and raising the knowledge minimum must not lock an old Runner out of binding. The gateway checks `protocolVersion` before decoding any other field, and a mismatch returns the existing `426` response carrying the supported range, which the Runner projects as the established upgrade-required experience. Delivering this capability therefore means publishing a new signed desktop artifact per supported platform rather than installing a plugin at runtime. The company model route remains exempt from version negotiation, which is a known asymmetry to resolve in its own change rather than here.

When the WAN, DNS, TLS, a proxy, or the remote Control Plane is unavailable, local Sessions and non-Team local features keep working, while the directory and search return the closed `control-plane-unreachable` or `update-required` results. The Runner persists no private passages and no offline-searchable directory. It retains only the opaque choice in the Session log; reconnection refreshes authorized display metadata and re-authorizes the next operation.

### Capability and package topology

| Package | Role and responsibility |
|---|---|
| `packages/knowledge/knowledge` | Browser-safe Service Definition, plus the DSH-branded reference types used by the directory, search, and Session scope |
| `packages/knowledge/knowledge-source` | Control Plane-only upstream seam: list a source, search an already-authorized set of its knowledge bases, in upstream ids |
| `packages/knowledge/knowledge-weknora` | Control Plane Service Provider for the fixed WeKnora list and search endpoints; resolves credentials per operation |
| `packages/knowledge/knowledge-gateway` | Governed gateway seam: the durable catalog an administrator curates, and the authorized directory and search a Runner reaches |
| `packages/knowledge/knowledge-gateway-sqlite` | Durable catalog and governed-operation Service Provider; syncs governed resources, evaluates access, and records audit events |
| `packages/knowledge/knowledge-gateway-http` | Bearer-token Runner-facing HTTP adapter; owns the knowledge `protocolVersion` and validates every decoded request and response |
| `packages/knowledge/knowledge-team` | Runner-side `ctx.knowledge` Service Provider; reads the current `teamAccountClient` token per operation and calls its configured Control Plane |
| `packages/knowledge/tool-knowledge` | Registers `knowledge_search`, the scope prompt section, scope-driven tool visibility, native rendering, and Web presentation metadata |
| `packages/api/knowledge-controller` | Team-only Typert remote serving the browser its authorized directory and recording a scope choice; mounted by the `team` bundle alone |
| `packages/client/ui-knowledge` | `/knowledge` command decoration, authorized multi-select, localized Session chip, scope projection, and reconnect invalidation |
| `packages/bundle/team` and `packages/bundle/team-control-plane` | Product-shipped composition rows; the Runner gains no upstream credential and the Control Plane keeps its no-local-execution exclusions |
| `apps/team-runner-desktop` | Packages the loopback-only 3090 Runner for one remote Control Plane origin; carries version metadata and no WeKnora configuration |

The Runner installs and applies no external WeKnora plugin, and `knowledge-weknora` takes no dependency on one. It owns a minimal REST adapter with contract fixtures, because a third-party runtime scope inside the Control Plane would be the one non-`@deepseek-ai` package in the process that holds company credentials, and because the fixed two-endpoint surface is smaller than the client that would wrap it.

The upstream seam is separate from the Runner-facing one because the two answer different questions: `ctx.knowledge` names what a member wants, `ctx.knowledgeSource` names what a source can do. Keeping them apart is what leaves the gateway between them as the only party that maps a governed reference to an upstream id, and the only party that decides whether it may.

`packages/api/knowledge-controller` exists because the browser cannot reach `ctx.knowledge` directly. The model catalog reaches the browser the same way, through `@Remote('modelCatalog')` on the session controller. Knowledge does not join that controller: `ctx.llm` is mounted in every Web build while `ctx.knowledge` is Team-only, and a controller that tolerated an absent service would make a missing mount look like an empty directory instead of failing loud.

The `team-control-plane` composition comment currently reserves this slot as a "Knowledge MCP Gateway". That name predates this proposal and describes a different design; the same change that inserts these rows corrects the comment.

### Stable knowledge references

The Control Plane mints one stable `KnowledgeRef` per upstream knowledge base:

```text
weknora:<sourceCode>:<upstreamKnowledgeBaseUuid>
```

`sourceCode` is a validated deployment configuration value. The `KnowledgeRef` is both the durable catalog key and the access-control `ManagedResource.externalRef`; grants continue to name the managed resource's surrogate `ResourceId`. A changed display name or description therefore leaves every grant untouched. The catalog stores the upstream id separately and only the WeKnora provider reads it.

The reference must satisfy `AUDIT_TOKEN`, the audit store's `resource_id` rule: at most 64 characters drawn from letters, digits, and `. _ : @ -`. With an eight-character prefix, a separator, and a 36-character UUID, `sourceCode` is bounded at 19 characters over the same alphabet, and the provider validates it at plugin load with that rule as the stated reason. A reference the audit store would refuse is a reference no operation could record, so the failure belongs at load rather than at the first denial.

Search results carry the `KnowledgeRef`, the passage text, a score, and a title. They carry no upstream document id and no reference that would authorize a later fetch, because the first delivery has no later fetch to authorize.

## Governed catalog

### SQLite records

The catalog holds one source record and one record per knowledge base. Its schema records operational metadata only:

| Record | Required fields |
|---|---|
| Source | Organization id, source code, provider kind, configured origin identity, last successful sync, last attempt, and health |
| Knowledge base | `KnowledgeRef`, source code, upstream id, display name, description, kind, document/chunk/processing counts, embedding model id, administrator-enabled bit, remote-present bit, last discovery, and last upstream update when the upstream supplies one |

The database stores no API key, query text, passage, filename, or search result. It uses the repository SQLite open sequence, application id, monotonic schema version, strict tables, and explicit indexes for source and knowledge-reference uniqueness.

The access-control database remains authoritative for roles, resources, grants, and policy revisions. The knowledge catalog cannot assert that a principal is authorized. Cross-database coordination follows existing Control Plane practice: catalog registration calls `accessControl.registerResource`, catalog enablement calls `setResourceEnabled`, and a state whose second write failed is discoverable and repairable by the next sync.

### Synchronization

Synchronization runs on an explicit administration request, at Control Plane start after the services mount, and on a configured period. Remote unavailability is an operational failure rather than a malformed configuration: start-up retains the last successful snapshot and exposes the failure state instead of deleting or disabling every entry.

One successful full WeKnora listing applies these rules in a single catalog transaction, then performs idempotent access-control reconciliation:

- A new upstream id creates a catalog row and registers an enabled `knowledge_scope` managed resource when the administrator-enabled bit is true.
- A known upstream id updates display metadata and counts without changing the `KnowledgeRef`, the `ResourceId`, or any grant.
- An entry missing from a successful full listing becomes `remotePresent = false` and its managed resource becomes disabled. The catalog row and its grants remain, so a temporary removal or restoration does not silently replace identity.
- A returning missing entry restores remote presence and is re-enabled in access control only while the administrator-enabled bit is still true.
- A manual disable changes the administrator-enabled bit and the managed-resource state. Synchronization never overrides that choice.

An administrator can clean up a missing entry only through a separate explicit operation added after the first delivery. The first UI offers no cleanup, because `deleteResource` also deletes every grant naming the resource; that is an irreversible policy change rather than catalog tidying.

## Permissions and role composition

The existing `knowledge_scope` resource type already carries `knowledge.search`, `knowledge.read`, and `knowledge.download`. The first delivery enforces and grants `knowledge.search` alone. `knowledge.read` stays in the catalog, ungranted by any editor, until full-document reading ships.

Two administration permissions join the closed catalog:

- `knowledge.catalog.read`
- `knowledge.catalog.manage`

The administration API registers `urn:dsh:admin:knowledge-catalog` as a `knowledge_scope` managed resource. Menu and page read routes check `knowledge.catalog.read` on that exact resource; sync and enablement routes check `knowledge.catalog.manage`. Role assignment still checks `role.grant.manage`, because it changes another role's grants.

Sharing the `knowledge_scope` type between the administration catalog resource and the member-facing knowledge bases has one consequence the implementation must handle everywhere. `listResources(orgId, 'knowledge_scope')` returns the administration resource alongside real knowledge bases, and an `all`-mode type grant on `knowledge.search` admits it. Every member-facing path — the Runner directory route, `all`-mode expansion, and the role editor's selectable list — therefore enumerates the durable knowledge catalog and joins it to managed resources by `KnowledgeRef`, which is how the model catalog already keeps its own administration resource out of the model list. The administration resource is never a searchable knowledge base, whatever grant names its type.

The role editor submits an explicit mode:

| Mode | Stored grants |
|---|---|
| `none` | No `knowledge.search` type or resource grant is stored |
| `all` | A `knowledge.search` type grant is stored |
| `selected` | A resource grant for `knowledge.search` is stored on each selected knowledge resource |

Saving the editor revokes the role's existing type and resource grants for that action, writes the requested set, and clears `coversCatalog` when the result is narrower than the full permission catalog. It changes no grant for `knowledge.read`, `knowledge.download`, the catalog administration permissions, or any other resource type. The response returns the full role list in the existing protocol form.

Several roles continue to union. A role holding knowledge-wide access plus a selected role yields every enabled knowledge base; two selected roles yield the union of their resources. The system has no deny rule, so the UI must not offer one.

## Control Plane API

### Administration API

| Method and path | Permission | Behavior |
|---|---|---|
| `GET /team/api/knowledge-bases` | `knowledge.catalog.read` | Returns the durable catalog, effective enablement, remote health, counts, and last sync state; never upstream credentials or URLs |
| `POST /team/api/knowledge-bases/sync` | `knowledge.catalog.manage` | Runs one serialized full synchronization and returns the new catalog; concurrent callers join the same in-flight operation |
| `PATCH /team/api/knowledge-bases/:knowledgeRef` | `knowledge.catalog.manage` | Resolves the exact managed resource, then changes administrator enablement |
| `POST /team/api/roles/:roleId/knowledge-bases` | `role.grant.manage` | Replaces the role's knowledge search grants with `none`, `all`, or a selected set |

These routes use the existing administration Session, same-origin check, CSRF check for writes, bounded JSON reader, typed refusal words, and per-route access evaluation. The UI permission projection only hides controls; each route still enforces again. That projection maps a `knowledge_scope` permission to the administration catalog resource, matching how it already maps every `model` permission to the model catalog resource.

### Runner API

| Method and path | Operation | Behavior |
|---|---|---|
| `POST /team/knowledge/catalog` | Directory | Accepts `protocolVersion` alone, verifies the device token, evaluates `knowledge.search` for every present enabled catalog entry, and returns `KnowledgeRef`, display name, description, and kind |
| `POST /team/knowledge/search` | Search | Resolves the requested Session subset, approves `knowledge.search` per entry, calls WeKnora with exact upstream ids, bounds results and text, and returns passages |

A Runner request body never supplies an organization, principal, device, upstream origin, tenant, API key, upstream knowledge-base id, or upstream document id. The gateway accepts only registered operations and refuses extra fields at the HTTP parser.

Directory and `all`-mode authorization iterate the catalog, consistent with the knowledge-scope access-control design. Caching is optional and admissible only when the cache key carries the organization, the principal, and the exact `policyRevision`, invalidates when catalog effective state changes, and preserves identical refusal behavior. The first implementation should prefer uncached evaluation until profiling proves otherwise.

## Runner tools and `/knowledge`

### Session scope state

Extend `SessionEventMap` with a versioned `knowledge/scope` event whose payload is one of:

```text
{ version: 1, mode: "off" }
{ version: 1, mode: "all" }
{ version: 1, mode: "selected", bases: [{ ref: KnowledgeRef, displayName: string }] }
```

No event means `off`. A Session therefore starts with knowledge unavailable and stays there until a member chooses. A projection unit folds the latest event, validates selected references as branded protocol values, and exposes the value to Host and Web clients. Fork and rewind derive the value from the resulting event log. The event is model-visible input because it decides both what the prompt says and which tools exist; the TypeScript and Python SDK event projections and expected outputs must be updated in the same change.

The `selected` payload carries the display name beside each reference, snapshotted at the moment of choice. That is what makes a named prompt section legal under the model-visible-equals-logged rule: the model may only be told names the log holds. It has a consequence worth stating plainly — after an administrator renames a knowledge base, the prompt for an already-recorded Session keeps the name that was logged, while the input chip and the picker show the current name resolved from the authorized directory. The log is not rewritten to match.

`all` mode logs no names, because the set it denotes is whatever the principal is authorized for at each call and cannot be snapshotted honestly. Its prompt section therefore states the mode without enumerating knowledge bases.

The `selected` values are a preference taken from an authorized directory response. A stale or forged reference still reaches Control Plane evaluation and cannot widen authorization. When a selected reference is no longer discoverable, the UI marks the choice unavailable and asks the member to update it; a tool call fails rather than silently falling back to a smaller set or to `all`.

### What the model sees

`tool-knowledge` contributes a `knowledge:scope` system-prompt section at a new `FIRST_PARTY_SECTION_ORDER` slot, resolved per assembly from the folded Session scope. In `off` the section text is empty and contributes nothing. In `selected` it names the chosen knowledge bases from the logged display names and states that company-specific questions should be searched before answering. In `all` it states that every authorized knowledge base is in scope. This is the same mechanism plan mode uses to make a logged Session mode reach the model.

Tool visibility follows the same folded state. While the scope is `off`, `knowledge_search` is not in the model's tool list at all: `tool-knowledge` applies a `tools.restrict()` deny on the agent's scoped context and disposes it when a scope event opens the Session. This is a live registration keyed to the agent scope, not a per-assembly filter, so a resumed Session must apply it at agent construction from the same fold, and a scope change must re-apply it. A model that cannot see a tool does not spend schema tokens on it and does not attempt a call that would only be refused.

### Command behavior

`/knowledge` is a Host command with a Web `popupSelect` decoration, sitting beside `/model` in the command list. A bare invocation opens `All authorized`, `Off`, and a multi-select of the current authorized directory. Saving appends a `knowledge/scope` event and returns a visible confirmation; it starts no model turn. The first delivery's command takes no query, because a human command does not run a model turn and combining a state change with a hidden prompt would create a second input path.

The input box shows a localized chip reading `Knowledge: all`, `Knowledge: off`, or the selected names. The chip reads the Session projection and directory metadata; it never reads role grants directly. Reconnection and policy-revision invalidation refresh directory names and availability without rewriting the recorded choice.

The choice lives only in the Session log. It is not written to user settings and a new Session does not inherit it, so every Session begins at `Off` and the member states intent once per Session.

### The model-facing tool

`knowledge_search` accepts a natural-language `query` and an optional bounded `max_results`. It reads the Session scope, refuses locally when the mode is `off` — a state the model should not reach, because the tool is invisible then — and sends `all` or the exact selected DSH references to the Team provider. Its canonical result carries the query, the searched DSH references with display names, bounded passage results, scores, truncation markers, and titles. It never exposes an upstream id.

The tool declares cancellation and timeout, uses reversible registration, provides pure Host presentation metadata, and gains a named Web card derived from raw events and persisted result metadata. Its native text stays sufficient for headless and unsupporting clients. The tool description states when to search, and does not list current knowledge bases or dynamic authorization in its schema — the prompt section carries that, and it carries it from logged facts.

### Cost and budget

Retrieved passages are charged to the organization's budget without a knowledge-specific ledger. A passage becomes prompt tokens on the member's next model request, and that request already reserves against `quota` through the company model gateway, which keys reservations by `modelRef`. A knowledge search has no model, so the knowledge gateway must not call `quota.reserve` — doing so would require inventing a `modelRef` and would corrupt the model usage ledger.

The real cost control is therefore the result bound, not a second meter: `maxSearchResults` and `maxPassageChars` on the WeKnora provider decide how much retrieved text can enter a prompt. This deployment sets them high, and the values remain validated `Config` fields so a deployment that finds them expensive can lower them without a code change.

<a id="deferred-full-document-reading"></a>

### Deferred: full-document reading

A second delivery adds `knowledge_read` for paged full-document text. It is deferred rather than dropped because it is the largest and most operationally expensive piece of this design and is not required by the first delivery's outcome: a signed `KnowledgeDocumentRef` needs a signing-key credential, a rotation runbook, a validity window with an upper and lower bound that are both wrong for some Session, one more Runner route, one more audit action, and the `document-unavailable` failure class.

The first delivery keeps that door open at no cost by fixing the `KnowledgeRef` format now, granting nothing on `knowledge.read`, and leaving the permission in the catalog. The second delivery adds the signed reference, the read route, the `knowledge.read` grant in the same role editor, and the rule that possession of a search result is not continuing authority: a read must prove the reference was minted for a knowledge base and evaluate `knowledge.read` on that knowledge base again.

## WeKnora provider behavior

The provider config owns every deployment-varying choice: source code, base URL, API-key credential reference, request timeout, maximum search results, and maximum passage characters. The credential must be a WeKnora space key, not a platform key: a space key is fixed to the space it belongs to, while a platform key reaches any space and takes an `X-Tenant-ID` header to say which, so a Control Plane holding one could read knowledge outside the space this deployment governs. That is also why the provider has no tenant field — with a space key there is nothing to name. An invalid URL, source code, bound, or credential-reference syntax fails at plugin load; a missing runtime credential and an unavailable upstream fail the operation without exposing the secret value.

The first delivery's provider uses only these WeKnora operations:

- `GET /api/v1/knowledge-bases`, reading `id`, `name`, `description`, `type`, `knowledge_count`, `chunk_count`, `processing_count`, `embedding_model_id`, and `updated_at` from each entry;
- `POST /api/v1/knowledge-bases/{id}/hybrid-search` with a `SearchParams` body carrying `query_text`, `match_count`, and an explicit non-empty `knowledge_base_ids` array of authorized upstream ids.

Three properties of that endpoint shape the provider, each pinned by a contract fixture against the live deployment. Its path still requires a knowledge-base id even when the body overrides scope, and that id must be a member of `knowledge_base_ids` — a path id outside the list is refused with `ErrNotFound` — so the provider puts one authorized id in the path and the full authorized set in the body, and never lets the path id widen scope. `match_count` is a global budget across the selected bases rather than a per-base one, so one base can fill the result set and crowd the others out entirely. And `match_count` is not a hard cap while context enrichment is on: the endpoint returns the top matches plus their parent, nearby, and relation chunks, so a request for ten answers with eleven. The provider keeps enrichment, because the surrounding context is what partly stands in for the deferred document read, and enforces `maxSearchResults` as a hard bound after decoding.

WeKnora silently ignores a knowledge-base id it does not know: a list mixing one real id with one unknown id answers `success` with results from the real base alone. That makes invariant 5 a requirement rather than a preference — the gateway cannot delegate existence or authorization to the upstream, whose answer to an unrecognized scope is a quietly narrowed one. Every reference is resolved and authorized in the Control Plane before a request is built, and the whole request is refused when any of them fails.

`hybrid-search` takes no `resource_urls` parameter. That parameter exists only on the chat and session endpoints, where `public` returns loadable direct links, and none of those endpoints is on the knowledge path. Invariant 10 therefore rests on the retrieval endpoint having no way to produce a loadable upstream URL, rather than on the provider asking it not to — a stronger position, which a contract test pins by asserting that no forwarded field carries an `http` or `https` URL, because a later WeKnora version could add the parameter or change its default. Nothing in the first delivery can redeem a `resource://` reference, and passages in this deployment do carry them, so the provider replaces any that survive in passage text with a neutral placeholder and drops chunks whose `chunk_type` is not `text` along with their `image_info`.

The provider forwards `content`, `score`, `knowledge_title`, and `knowledge_base_id`, and drops every other `SearchResult` field: `knowledge_filename`, `knowledge_source`, `knowledge_description`, `knowledge_channel`, `knowledge_custom_metadata`, `matched_content`, `metadata`, `chunk_metadata`, `chunk_index`, `parent_chunk_id`, `sub_chunk_id`, `match_type`, `start_at`, `end_at`, and `seq`. It keeps `knowledge_base_id` because it maps each hit back to a `KnowledgeRef`, which lets the gateway verify that every returned hit came from a base it authorized — worth having when the scope travelled in a body field the upstream is free to interpret.

The provider sends a fresh request correlation id, forwards cancellation, applies a bounded timeout, validates decoded JSON and required response fields, and maps failures onto closed DSH reasons by reading `AppError.code`, the numeric enum whose members include `ErrBadRequest`, `ErrUnauthorized`, `ErrForbidden`, `ErrNotFound`, `ErrTooManyRequests`, `ErrInternalServer`, `ErrServiceUnavailable`, `ErrTimeout`, and `ErrValidation`. It never forwards `AppError.message` or `AppError.details`. Contract fixtures pin every upstream path, method, header name, and read field against the live deployment, including both envelopes it actually returns: `{ "data": …, "success": true }` on success and `{ "error": { "code", "message", "details" }, "success": false }` on failure, the second nesting `AppError` rather than returning it flat as the OpenAPI document declares. An optional real-WeKnora e2e self-skips without deployment credentials.

WeKnora qualifies multi-base retrieval in the field's own definition: `knowledge_base_ids` allows one retrieval call to span multiple knowledge bases that share the same embedding model, and the API declares no error for a set that does not share one. Undefined upstream behavior must not become a silent product behavior, so the catalog records each entry's `embedding_model_id` and the gateway refuses a multi-base operation whose members do not share one, with the closed `scope-incompatible` reason, before any upstream call. A single-base selection is unaffected. `all` mode expands to the authorized set and can therefore be refused for the same reason, which is why the refusal names the incompatible bases and the administration page shows the embedding model: the member narrows the selection, and the administrator can see why they had to.

## Audit and operational visibility

Add `knowledge.search` and `knowledge.catalog.sync` to `AUDIT_ACTIONS` with closed metadata. Search records one row per named knowledge resource after authorization, carrying outcome and a bounded result count through the existing `itemCount` key; sync records the catalog administration resource, outcome, and entry count. Refusals carry the existing closed reasons and never upstream text.

Upstream failure kinds arrive as a new `label`-kind metadata key rather than a new `AuditReason`. This is not a style preference: `AUDIT_REASONS` is compiled into the audit table's `CHECK` constraint, and the store applies its DDL with `CREATE TABLE IF NOT EXISTS` and no rebuild path, so a reason added to the code list would silently fail to apply to an existing database. Actions and metadata keys are re-seeded by insert on every open and are safe to add. An upstream failure is therefore recorded with an `error` outcome and a label naming the failure class.

Operational logs may carry the request correlation token, HTTP status class, duration, counts, and verified knowledge references. They must not carry queries, passages, filenames, upstream URLs, credentials, or raw response bodies. Telemetry follows the same exclusions.

The knowledge catalog page shows last attempt, last success, source health, and a localized failure class. It does not show a raw upstream error. Operators diagnose detailed upstream failures in the WeKnora deployment or restricted infrastructure logs rather than in the audit trail of members' work.

## Failure semantics

| Condition | Runner-visible result | State change |
|---|---|---|
| No valid device token | `unauthenticated` | None |
| Inactive member or revoked device | `unauthenticated` | None |
| No matching grant, unknown reference, or disabled/missing resource | `not-allowed` | Refusal audit only |
| Selected Session scope is stale | `scope-unavailable` | None; the choice is retained pending explicit member correction |
| Selected bases do not share one embedding model | `scope-incompatible` | Refusal audit only; no upstream call is made |
| WeKnora unavailable or timed out | `upstream-unavailable` | Failure audit; catalog snapshot and grants retained |
| Malformed WeKnora response | `upstream-invalid` | Failure audit; no partial model-visible value |
| WAN, DNS, proxy, TLS, or Control Plane failure | `control-plane-unreachable` | None; no stale private result is served |
| Unsupported Runner protocol version | `update-required` | None; no other request field or operation is processed |
| Cancellation | `cancelled` | Cancellation audit only when the operation reached the governed gateway |

A refusal does not distinguish an unknown resource from an ungranted one. Search returns no partial passages when one requested scope fails authorization or one required upstream response fails validation.

## Administration UI

Add a product-shipped `Knowledge bases` menu under `Resource management` at `/resources/knowledge-bases`, guarded by `knowledge_scope|knowledge.catalog.read`. The page follows the model page's loading, error, and write patterns and its typed localized dictionaries.

The table shows name, DSH reference, upstream kind, document count, chunk count, processing count, embedding model, effective state, remote presence, last successful sync, and source health. Actions include `Refresh` and `Enable/Disable` while the member holds `knowledge.catalog.manage`. A missing entry stays visible and disabled, so an administrator can see why a role selection became unavailable.

Role rows gain `Knowledge access`. The dialog offers `None`, `All enabled knowledge bases`, and `Selected knowledge bases`; the selected mode shows the durable catalog with missing entries disabled while retaining already-selected missing rows for inspection. The dialog states that several roles union, and that the choice grants search alone — not read, download, or administration.

Every product string, accessibility name, empty state, error, confirmation, and tool card label is owned by a localized dictionary. A PR changing user-visible GUI behavior records a GIF from the PR's real server and model flow, per the repository browser GIF workflow.

## Delivery plan

Deliver through a dependent PR stack. Lower branches carry no UI dependency and each branch passes its own focused checks.

### PR 1 — Domain, permissions, and Session vocabulary

- Add the `packages/knowledge` group with its bilingual group README, an entry in both `packages/README` files, and a linked `docs/subsystems/` page; the group cannot silently inherit a subsystem-page exemption.
- Add the `knowledge` Service Definition, branded references, request and result types, discriminated failures, configuration-independent validators, and package documentation.
- Validate the `KnowledgeRef` length and alphabet against the audit token rule, and prove a too-long source code fails at load.
- Extend the permission catalog with `knowledge.catalog.read` and `knowledge.catalog.manage`; register no route yet.
- Add the versioned `knowledge/scope` event with its display-name snapshot, the projection unit, the TypeScript and Python SDK projections, expected outputs, and fold tests.
- Prove malformed references, unknown union arms, invalid scope payloads, fork and rewind projection, and the default `off` behavior.

### PR 2 — WeKnora provider and governed catalog

- Add `knowledge-weknora` and `knowledge-gateway-sqlite`, the SQLite schema, source configuration, credential resolution, sync reconciliation, and access-control managed-resource registration.
- Add upstream contract fixtures for listing and explicitly scoped hybrid search, pinned against the live deployment's own responses; refuse every unregistered path and malformed response.
- Prove the provider bounds results itself when context enrichment returns more than `match_count`, and that an unknown reference is refused in the Control Plane rather than left to an upstream that ignores it.
- Prove a multi-base request whose entries do not share an embedding model is refused before any upstream call, and that a single-base request is unaffected.
- Add authorization tests for type grants, resource grants, multi-role union, disabled and missing resources, whole-request refusal, current policy revision, and the call after a role change.
- Prove the administration catalog resource is never returned as a searchable knowledge base under an `all`-mode type grant.
- Add the audit action entries and the upstream failure label key, and prove that queries, passages, filenames, URLs, and raw errors cannot satisfy or enter the audit schema.
- Add an optional self-skipping real-WeKnora e2e so CI does not depend on a private deployment.

### PR 3 — Control Plane HTTP and administration API

- Add the Runner endpoints with bearer-token verification, knowledge-owned `protocolVersion` evaluated before any other field, strict request parsing, bounded bodies, cancellation, stable refusal mapping, and no arbitrary proxy field.
- Add the administration catalog, sync, and enablement routes and the exact role knowledge-grant replacement.
- Register the catalog administration resource at Control Plane start and update the held-permission projection for its special resource.
- Insert the provider, catalog, gateway, credential, and HTTP rows into `team-control-plane`, correct the reserved "Knowledge MCP Gateway" comment, and keep every no-local-execution composition assertion passing.
- Test real HTTP composition with accounts, device authorization, access control, audit, a fake WeKnora, revoked tokens, role changes, protocol mismatch, reverse-proxy path preservation, and upstream failure.
- Document the single active 3095 process, durable volume backup, TLS termination, proxy timeout and body limits, loopback WeKnora reachability on the same host, and enterprise certificate configuration.

### PR 4 — Runner provider, tool, and what the model sees

- Add `knowledge-team` with per-operation token reads, its own validated `controlPlaneUrl`, protocol-version reporting, Control Plane response validation, and closed offline errors; insert it into `team` after `team-account-client`.
- Add `tool-knowledge`, native rendering, canonical output, presentation metadata, cancellation, tool UI design, and the tool description.
- Add the `knowledge:scope` prompt section with its new section-order slot, and prove `off`, `all`, and `selected` each render the intended text from the log alone.
- Add scope-driven tool visibility through `tools.restrict()` on the agent scope, and prove it is applied at agent construction for a resumed Session and re-applied on a scope change.
- Add keyless recorded-session snapshots in the existing headless lane with a stub knowledge provider, covering `off` invisibility, `selected` search output, truncation, empty results, refusal, and fork/rewind of the scope event.
- Update `apps/team-runner-desktop` so the generated profile patch carries the knowledge row's `controlPlaneUrl`, and so artifacts carry one company origin and Runner version, no WeKnora setting, and loopback-only 3090.
- Update the tool catalog, package READMEs, model-experience section, deployment guide, configuration catalog, and Team bundle composition tests.

### PR 5 — `/knowledge`, the API remote, administration pages, and the role editor

- Add `packages/api/knowledge-controller` with the authorized-directory and scope-selection remotes, mounted by the `team` bundle alone.
- Add the product-shipped menu entry, knowledge catalog page, sync and enablement actions, role knowledge editor, typed API models, and localized text.
- Add `ui-knowledge` command decoration, authorized directory loader, multi-select, projection-driven input chip, stale-choice state, reconnect refresh, and permission-driven control visibility.
- Add browser component tests and assembled e2e for `off` default, selected, all, stale, revoked, missing, sync failure, and role union behavior.
- Record the required GIF from the PR's real server and model or tool flow.
- Update user and administrator documentation only once the delivered behavior is observable.

### Stack completion

Run the repository pre-push selection workflow against each branch's outgoing diff after it is published or rewritten. Before landing, use the repository stacked-PR workflow, keep same-repository dependencies in an official stack, merge from the bottom, and let GitHub retarget the remaining branches.

## Verification matrix

| Concern | Required evidence |
|---|---|
| Reference and protocol validation | Focused unit tests over every invalid discriminant field, extra field, malformed token, oversized source code, and response mismatch |
| RBAC | Real access-control provider tests over none/all/selected, multi-role union, resource disablement, account suspension, device revocation, immediate grant revocation, and the administration catalog resource never appearing as a knowledge base |
| Catalog durability | SQLite restart, rename, missing, reappearing, manual disable, sync failure, concurrent sync, and cross-store reconciliation tests |
| Upstream compatibility | A deterministic fake-WeKnora contract suite covering both response envelopes, `resource://` references, non-text chunks, mixed embedding models, error codes, an upstream that silently ignores an unknown base, enrichment overshooting `match_count`, and no forwarded field carrying an http(s) URL, plus an optional credentialed e2e |
| Runner transport | Real device access-token flow, per-operation token refresh, strict response decoding, cancellation, and captured requests carrying no upstream credential or address |
| Remote deployment | Loopback-only 3090, outbound HTTPS to the packaged 3095 origin, protocol `426`, reverse-proxy route/status/cancellation preservation, TLS failure, timeout, and reconnection tests |
| Desktop packaging | macOS arm64 and Windows x64 artifact metadata carrying one Control Plane origin and Runner version, no WeKnora secret or endpoint, over the existing signed update path |
| Model-visible behavior | Keyless recorded-session snapshots in the headless lane with a stub provider: `off` tool invisibility, prompt section text per mode, search output, truncation, empty results, and refusal |
| Session durability | Fold, resume, fork, rewind, compaction and replay compatibility, TypeScript SDK and Python SDK expected outputs |
| Administration security | Browser Session, same-origin, CSRF, route permission, stale write, and hidden-controls-are-not-authorization tests |
| GUI behavior | Component tests, assembled browser e2e, localization gates, accessibility queries, and a real-flow GIF |
| Packages and documentation | Focused package tests, typecheck, lint, publish-path build smoke, hygiene on manifest change, subsystem-page and group-README gates, `test:docs`, `doc-sync`, and `git diff --check` |

Two roles receiving disjoint results for the same query is proven in the gateway's access-control tests, not in a recorded-session snapshot. The snapshot corpus has lanes for `acp`, `sdk`, `session`, and `web` and no Team lane, and standing a keyless Control Plane, seeded roles, a bound device, and a fake WeKnora into that harness is its own project. The snapshot lane proves what the model sees; the gateway tests prove who is allowed to see it.

An implementation reports only the commands it actually ran. Do not claim a full suite passed unless it did; CI owns exhaustive coverage and the platform matrix.

## Acceptance criteria

- A Team Runner starts with the knowledge tool and `/knowledge` built in, with no external WeKnora plugin to install or configure.
- A new Session starts at `Off`, `knowledge_search` is absent from the model's tool list, and no knowledge request leaves the computer until a member chooses a scope.
- After a `selected` choice, the system prompt names exactly the knowledge bases recorded in the Session log, and a subsequent administrator rename does not alter that recorded Session's prompt.
- The packaged 3090 Runner listens only on loopback, sends outbound knowledge requests only over verified HTTPS to its assigned remote 3095 origin, and requires no inbound route from the Control Plane.
- Desktop artifacts identify one company Control Plane origin and Runner version while containing no WeKnora address, credential, tenant, or separately editable knowledge gateway.
- WeKnora is reachable only over the Control Plane host's loopback interface, and no member-reachable network path to it exists.
- Every Runner-facing knowledge endpoint refuses an unsupported protocol version with the established upgrade-required response before decoding any other operation field or performing any operation.
- WAN, DNS, TLS, proxy, or 3095 unavailability returns a closed unavailable result and never serves a cached private passage; reconnection triggers a current directory and authorization check.
- No captured Runner configuration, credential, request, tool result, or browser state contains a WeKnora API key or a callable upstream URL.
- The Control Plane catalog mirrors a successful WeKnora listing, preserves identity across renames, disables confirmed-missing entries without deleting grants, and retains the last successful snapshot after a sync failure.
- Only a principal holding `knowledge.catalog.read` can list catalog state in the administration page; every mutating action enforces its write permission, same-origin proof, and CSRF proof independently.
- A role saved as none, all, or selected holds exactly the described `knowledge.search` grants, holds nothing on `knowledge.read`, leaves other permissions unchanged, and unions with other roles.
- The administration catalog resource is never returned to a Runner as a searchable knowledge base, including for a role holding an `all`-mode type grant on `knowledge_scope`.
- Two principals with disjoint selected grants receive disjoint directories and search results for the same query form; a principal holding both roles receives the union.
- An explicitly unauthorized or unknown knowledge reference refuses the whole request, confirms nothing about its existence, and returns no authorized partial result.
- A multi-base search whose entries do not share one embedding model is refused before any upstream call, and no tool result, passage, or upstream URL is produced for it.
- `/knowledge` persists off, all, and selected in the Session log, survives resume, fork, and replay, cannot widen current authorization, and reports a stale choice instead of silently changing it.
- Search audit rows carry only identity, governed resource, action, outcome, bounded counts, and correlation; tests prove member content and upstream detail are structurally inadmissible, and that no new `AuditReason` was required.
- Retrieved passages are charged through the existing model reservation on the next request, and the knowledge gateway holds no quota reservation of its own.
- The Control Plane composition mounts no new Agent, filesystem, shell, subprocess, sandbox, code-runtime, or other local execution capability.
- Production deployment documentation requires TLS, one active SQLite 3095 instance with a durable backup volume, reverse-proxy limits, and loopback-only WeKnora on the Control Plane host.
- Model-facing behavior has keyless recorded-session snapshots, both SDK projections cover the new Session event, and user-visible GUI behavior has assembled e2e evidence and the required GIF.
- On moving to implemented, the full bilingual documentation pair is re-recorded and the implemented Agent Note describes the packages and protocol actually delivered, without retaining this delivery checklist.

## Alternatives considered

**Install an external WeKnora plugin in each Runner with role-specific defaults.** Rejected because defaults are a caller-overridable scope choice, the API key would reach the member process, and revocation would depend on configuration or credential rotation rather than the next access decision.

**Add only a `/knowledge` command.** Rejected because a command owns discovery and Session preference, not the retrieval implementation or the authorization boundary. The agent still needs a model-facing tool, and the gateway must enforce every operation without depending on the command.

**Hide unauthorized knowledge bases in the browser.** Rejected because another plugin, the model, or a crafted request bypasses browser state. UI filtering remains useful but never approves an operation.

**Default the Session to automatic knowledge use.** Rejected in favor of an explicit `off` default. Automatic retrieval would search every authorized knowledge base for questions that have nothing to do with company knowledge, spending latency and prompt budget on passages nobody asked for, and it would make private content enter a model request without a member ever stating that intent. `all` survives as an explicit choice, so a member who does want breadth states it once instead of selecting twelve checkboxes.

**Keep the scope choice in user settings so a new Session inherits it.** Rejected because it would create a second state source beside the Session log, and the log would no longer be sufficient to reconstruct what the model saw. Choosing once per Session is the cost of keeping fork, rewind, and replay exactly derivable.

**Leave `knowledge_search` registered while the scope is `off`.** Rejected because a permanently visible tool that always refuses spends schema tokens on every request and invites a refused call the member never asked for. Tool visibility follows the same fold as the prompt section, so both answer the same question about the Session.

**Name knowledge bases in the prompt by resolving the current directory at assembly time.** Rejected because those names would be model-visible input that the Session log does not hold, breaking the model-visible-equals-logged rule and making a replayed Session's prompt depend on the Control Plane's current state. Snapshotting the names into the event costs a stale name after a rename, which is visible only in already-recorded Sessions.

**Ship `knowledge_read` in the first delivery.** Deferred rather than rejected. It is the most operationally expensive part of the design — a signing key, its rotation, and a validity window that is wrong in one direction for some Session — and the first delivery's outcome is met by search passages alone. Fixing the `KnowledgeRef` format now keeps the second delivery from reworking identity.

**Fan out one search per embedding model and merge the results.** Rejected for the first delivery because scores from separate WeKnora searches are normalized within their own rerank and are not comparable across calls, so merging would invent a ranking the provider never produced. It also contradicts the whole-request rule: a member asking one question would receive a silently reordered union rather than a result the gateway can explain. Refusing names the problem where an administrator can fix it.

**Meter knowledge retrieval against `quota` in the knowledge gateway.** Rejected because `ReservationRequest` is keyed by `modelRef` and a knowledge search has no model; a synthetic ref would corrupt the model usage ledger. Passages are already charged as prompt tokens on the following model request, so a second meter would double-count what one already counts.

**Add a new `AuditReason` for upstream failure classes.** Rejected because `AUDIT_REASONS` is compiled into a `CHECK` constraint applied through `CREATE TABLE IF NOT EXISTS`, so a new reason would not reach an existing database and the failure would be silent. A `label`-kind metadata key is re-seeded on every open and carries the same closed vocabulary.

**Share the device-binding `protocolVersion` constant with knowledge routes.** Rejected because it couples two independently evolving protocols: a knowledge-only change would force the binding version up, and raising the knowledge minimum would lock an old Runner out of binding as well. Knowledge owns its own version and reuses the existing refusal vocabulary.

**Read the Control Plane origin from `teamAccountClient` instead of a second config field.** Rejected because the account client does not expose its origin, and the company model transport already carries its own validated field. The desktop installer's generated patch is the single place all rows are written, which is where a single source of truth belongs.

**Depend on an external WeKnora client package inside `knowledge-weknora`.** Rejected because it would be the only non-`@deepseek-ai` runtime scope in the process holding company credentials, and the fixed two-endpoint surface of the first delivery is smaller than the client that would wrap it.

**Mount the full external plugin in the Control Plane.** Rejected because the Control Plane deliberately has no Agent or tool registry and must not gain either. It mounts a fixed upstream provider and a governed HTTP service, not model-facing tools.

**Expose a transparent WeKnora reverse proxy.** Rejected because arbitrary paths and fields would let a Runner choose operations the permission catalog and audit vocabulary do not govern. The DSH protocol names exact operations and fields.

**Let a WeKnora custom agent choose knowledge bases.** Rejected for the first delivery because server-side selection can widen beyond the DSH decision, and a resumable chat session needs separate principal and scope ownership. A later proposal may add composed answers only when it supplies explicit authorized ids and a DSH-owned session handle.

**Delete catalog entries and grants when a knowledge base disappears upstream.** Rejected because one failed or incomplete listing would cause irreversible policy loss. Absence disables access only; a future explicit cleanup owns deletion.

## Risks

- Knowledge bases created with different embedding models cannot be searched together, and a deployment that grows such a set makes `all` mode refuse for roles holding broad access. The administration page surfaces the embedding model so this is diagnosable, but keeping one embedding model across a company's knowledge bases is a deployment discipline DSH cannot enforce.
- The published WeKnora API markdown and the deployed OpenAPI document disagree: the markdown describes a top-level `POST /knowledge-search` this build does not serve, its search result omits fields the deployment returns, and the deployment's failure envelope nests `AppError` under `error` rather than returning it flat. Fixtures are pinned against the deployment's own document, and the named upgrade owner re-reads that document rather than the upstream repository's prose on every WeKnora bump.
- The WeKnora API may change independently. Contract fixtures and the optional real e2e detect drift, but the provider still needs a named upgrade owner.
- Directory and `all`-mode authorization evaluate once per knowledge base. This is acceptable for the initial full-listing deployment; a future bulk access-control operation must preserve per-resource evaluation and policy-revision semantics rather than authorizing once for several operations.
- A prompt section built from logged display names goes stale after a rename. The reference keeps meaning and the UI shows current names, but a long-running Session's prompt can name a knowledge base by a name no administrator would recognize. Session length is the practical bound.
- Tool visibility that changes mid-Session changes the tool list a model sees between turns. Providers tolerate this, but a model that read an earlier turn's tool list may still attempt a call; the local refusal remains the backstop.
- Separate SQLite databases cannot commit catalog and access-control changes atomically. Idempotent reconciliation repairs an interrupted write, and a request may briefly observe the earlier state before the next reconciliation.
- A member may still reach WeKnora directly through a credential or network path outside DSH. Running WeKnora on the Control Plane host's loopback interface closes the network path for this deployment; a deployment that later separates the hosts reopens it until it restores an equivalent restriction. DSH cannot revoke authorization WeKnora granted independently.
- Returning private source passages raises model context sensitivity. High result and passage bounds are a deliberate choice for this deployment, so provider and model data-handling policy carries proportionally more weight than RBAC does.
- Remote 3095 latency and transient WAN failure can make a local 3090 tool call slow or unavailable. Bounded end-to-end deadlines, cancellation forwarding, closed offline results, and no fallback to stale content keep the behavior explicit.
- Enterprise proxy, private certificate authority, DNS policy, and reverse-proxy timeouts vary by deployment. The implementation needs tested configuration points and operator diagnostics without introducing a certificate-verification bypass.
- Desktop and Control Plane versions can drift, because a client upgrade may lag the server. Protocol-first `426` handling and signed platform artifacts state the required upgrade before any knowledge operation runs.
- The SQLite catalog and access-control files limit the first 3095 deployment to a single active instance with durable storage and backup. Horizontal replicas need a later shared-database and synchronization design rather than copies of these files.
- The package stack is broad, and it adds a package group with its own README, subsystem-page, and per-file coverage obligations. Ordering the PRs by domain, provider, HTTP, tool, and UI keeps each review small, but the capability must not be exposed before both Control Plane enforcement and the Runner path exist.
