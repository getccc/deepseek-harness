# Agent Note: Team BI analysis through the Control Plane

Status: proposed

English | [中文](2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)

## Problem

The company's BI system, webi, holds projects of saved charts that already answer the questions members ask most: sales by region, orders by month, the metrics a dashboard was built to show. A Team member who asks DSH one of those questions gets an answer from general knowledge, because no capability reaches webi. webi itself offers two ways in, a REST API and an MCP server over SSE, and both authenticate with one personal access token whose reach is the token owner's: a token in a Runner would put a company credential on a member's computer, hand every project that token can see to whoever uses that computer, and record nothing. [Private knowledge](2026-09-01-team-private-knowledge-control-plane.md) solved exactly this for WeKnora: the Control Plane holds the credential, an administrator grants per resource, the Session records what a member chose, and the model sees a tool only after a choice was made. The work composer already seats an inert BI分析 chip, on the `feat/composer-placeholder-seats` branch, waiting for the capability. What is missing is the BI counterpart of that design: the vocabulary, the governed project catalog, the role grant, the Session scope, the tools, and the control.

## Proposal

Ship BI analysis as a built-in Team capability shaped like private knowledge. The `team-control-plane` profile mounts a webi provider that holds the API key, a governed project catalog, the Runner-facing gateway, and the administration routes; the `team` profile mounts the Runner-side provider, two model-facing tools with a prompt section, the browser Remote, and the composer control. webi itself does not change: every operation the first delivery needs is an existing route that accepts `Authorization: ApiKey`.

### Product outcome

- An administrator writes one webi personal access token into the Control Plane's credential store and names it from the `bi-webi` row's `credentialRef`, as the WeKnora row does. The token belongs to a dedicated webi organization administrator created for DSH, so it reaches every project and every space, private ones included, and no person's key is at stake.
- An administrator sees every webi project under **Resource management → BI management**, refreshes the catalog, and enables or disables each project.
- An administrator opens one role's **BI access** editor and grants all projects, selected projects, or none. A project grant covers every saved chart in the project, in public and private spaces alike.
- A member of a granted role opens a work conversation, picks one project from the composer's BI control, and asks an ordinary question. The agent lists the project's saved charts, picks the closest, runs it, and answers from the rows: a chart as an `echarts` fence the deployment's renderer draws, a table as Markdown, a single number as prose.
- A conversation starts with BI off. Until the member picks a project, no BI tool is visible to the model and no BI request leaves the computer.
- Revoking the role grant, suspending the member, revoking the device, disabling the project, or the project disappearing from webi changes the next operation without a new login or conversation.

### Non-goals for the first delivery

- No dashboards, dashboard filters, or dashboard-scoped chart runs.
- No ad-hoc queries over webi's semantic layer, which are the explore, field, and table-data operations its own MCP server exposes, and no SQL runner. The model runs saved charts as they were saved.
- No filter, parameter, or sort override on a saved chart beyond a row bound; no chart creation, editing, or version writes; no image export.
- No per-space grants: the project is the unit of authorization, by product decision.
- No `all` mode and no several projects in one conversation: one conversation analyzes one project.
- No key entry in the console page and no webi-side change.

## Security invariants

1. The Runner stores no webi address, API key, project id, or chart id that could authorize a direct upstream call; a Runner request carries governed references only.
2. Every Runner-facing request verifies the current device access token and takes `orgId`, `principalId`, and `deviceId` from verified claims, never from request fields.
3. The Control Plane evaluates `bi.query` on the project every operation names, on every call. An unknown project and an ungranted project produce the same refusal.
4. A chart is authorized through the project webi says it belongs to, resolved upstream on every call, so a chart reference from another project is refused before any row is read.
5. Session scope only narrows current authorization; it is re-evaluated on each operation and survives only in the Session log.
6. Chart names, descriptions, field labels, rows, and upstream error bodies never enter the Control Plane audit store or ordinary logs; an audit row carries references, counts, and closed reasons.
7. The Control Plane calls only its configured webi origin and the fixed endpoint set below. A Runner request has no URL, header, body, or operation field the gateway did not define.
8. Every Runner-facing route carries a BI `protocolVersion` evaluated before any other field; an unsupported version answers `426` and performs no operation.
9. Whatever the model can see about the chosen project is reconstructable from the Session log alone.

## Runtime architecture

```text
3090 Team Runner                                   3095 Control Plane                      webi

composer BI control                               administration API
        |                                                 |
bi/scope Session event                          governed project catalog
        |                                                 |
prompt section + tool visibility                        RBAC + audit
        |                                                 |
bi_list_charts / bi_query_chart                           |
        |                                                 |
Team BI Provider -- current device token --> BI Gateway -- fixed endpoints + ApiKey --> REST API
```

### Capability and package topology

| Package | Role and responsibility |
|---|---|
| `packages/bi/bi` | Browser-safe Service Definition `ctx.bi`, the branded `BiProjectRef` and `BiChartRef`, request and result types, the `bi/scope` Session event, and the closed failure set |
| `packages/bi/bi-source` | Control Plane-only upstream seam `ctx.biSource`: list projects, list a project's charts, place a chart in its project, and run a chart, in upstream ids |
| `packages/bi/bi-webi` | Service Provider for webi's fixed endpoints; resolves the credential per operation and bounds rows, cells, and time |
| `packages/bi/bi-gateway` | Governed gateway seam `ctx.biGateway`: the durable project catalog, and the authorized directory, chart listing, and run |
| `packages/bi/bi-gateway-sqlite` | Durable catalog, synchronization, access-control registration, per-project authorization, and audit |
| `packages/bi/bi-gateway-http` | Runner-facing routes with token verification and the BI protocol version |
| `packages/bi/bi-team` | Runner-side `ctx.bi` provider carrying the current device token to its configured Control Plane |
| `packages/bi/tool-bi` | `bi_list_charts`, `bi_query_chart`, the `bi:scope` prompt section, scope-driven visibility, and the tools' presentation |
| `packages/api/bi-controller` | Team-only Remote serving the browser its authorized projects and recording the conversation's choice |
| `packages/client/ui-bi` | The composer control: the seated chip becomes a single-select over authorized projects |

Two seams rather than one, for the reason knowledge keeps them apart: `ctx.bi` names what a member wants, `ctx.biSource` names what webi can do, and the gateway between them is the only party that maps a governed reference to an upstream id and decides whether it may.

### Stable references

The Control Plane mints one `BiProjectRef` per webi project and addresses a chart beneath it:

```text
webi:<sourceCode>:<projectUuid>
webi:<sourceCode>:<projectUuid>/<chartUuid>
```

The project reference is the durable catalog key and the access-control `ManagedResource.externalRef`; grants name the resource's surrogate id, so a renamed project keeps every grant. The bounds are the knowledge bounds, 64 characters over the audit token alphabet and a source code of at most 19 characters, because the reference lands in the same `resource_id` column. A chart reference is a separate brand, as a document reference is, because a chart is never an audit resource: what an operation records is the project.

## Governed catalog

### SQLite records

`bi.sqlite` holds one source record and one record per project, opened through the repository's SQLite sequence with strict tables and a monotonic schema version:

| Record | Fields |
|---|---|
| Source | Organization id, source code, provider kind `webi`, configured origin identity, last successful sync, last attempt, and health |
| Project | `BiProjectRef`, source code, upstream id, display name, project type, warehouse type, administrator-enabled bit, remote-present bit, and last discovery |

The database stores no API key, chart, row, or query text. Charts are not catalogued: they are listed from webi on each authorized call, so the catalog says which projects exist and the source says what is in them now.

### Synchronization

Synchronization runs on an explicit administration request, when the console page opens, at Control Plane start, and on a configured period. One successful full listing applies the knowledge rules: a new project registers an enabled `bi_project` managed resource; a known project updates its name without changing its reference, resource, or grants; a project missing from a successful listing is retired with its resource and every grant naming it; a manual disable is never overridden by a sync. A listing that fails leaves the last snapshot in place and records the failure on the source.

## Permissions and role composition

The permission catalog gains three pairs on a new resource type:

| Permission | Who holds it |
|---|---|
| `bi_project` / `bi.query` | A member role: list and run the saved charts of the named project |
| `bi_project` / `bi.catalog.read` | An administrator role: read the project catalog |
| `bi_project` / `bi.catalog.manage` | An administrator role: sync the catalog and enable or disable projects |

The administration API registers `urn:dsh:admin:bi-catalog` as a `bi_project` managed resource and checks the two catalog permissions on that exact resource; role assignment still checks `role.grant.manage`. Because the administration resource shares the member resource type, every member-facing path, the Runner directory and the role editor's selectable list, enumerates the durable project catalog and joins it to managed resources by reference, never `listResources` on the type, which is the rule the knowledge catalog already follows.

The role editor submits `none`, `all`, or `selected`; saving revokes the role's existing `bi.query` type and resource grants, writes the requested set, and touches no other permission. Roles union, and there is no deny rule.

## Control Plane API

### Administration API

| Method and path | Permission | Behavior |
|---|---|---|
| `GET /team/api/bi-projects` | `bi.catalog.read` | The durable catalog, effective enablement, source health, and last sync state |
| `POST /team/api/bi-projects/sync` | `bi.catalog.manage` | One serialized full synchronization; concurrent callers join it |
| `PATCH /team/api/bi-projects/:biProjectRef` | `bi.catalog.manage` | Administrator enablement of one project |
| `POST /team/api/roles/:roleId/bi-projects` | `role.grant.manage` | Replace the role's `bi.query` grants with `none`, `all`, or a selected set |

These routes use the administration Session, the same-origin and CSRF checks, the bounded JSON reader, and the typed refusal words the knowledge routes use.

### Runner API

| Method and path | Operation | Behavior |
|---|---|---|
| `POST /team/bi/catalog` | Directory | Verifies the token, evaluates `bi.query` on every enabled catalog entry, and returns references and display names |
| `POST /team/bi/charts` | Chart listing | Authorizes the project, lists its saved charts from webi, filters by an optional keyword, and returns one bounded page |
| `POST /team/bi/query` | Chart run | Resolves the chart's project upstream, authorizes it, runs the saved chart, and returns the definition summary, fields, and bounded rows |

A Runner request supplies no organization, principal, device, origin, key, project uuid, or chart uuid; the gateway refuses extra fields at the parser.

## The webi provider

`bi-webi` speaks four routes of the deployed webi, a Lightdash-derived server, and nothing else:

| Operation | webi route |
|---|---|
| List projects | `GET /api/v1/org/projects` |
| List a project's saved charts | `GET /api/v2/content?projectUuids=&contentTypes=chart&page=&pageSize=` |
| Read a chart's definition and project | `GET /api/v1/saved/:chartUuid` |
| Run a saved chart | `POST /api/v2/projects/:projectUuid/query/chart`, then `GET /api/v2/projects/:projectUuid/query/:queryUuid` until the query is ready, paged |

Every call carries `Authorization: ApiKey <token>` resolved from `credentialRef` per operation. The token is a webi organization administrator's, which is what lets the provider list private spaces: webi shows a private space to its direct members and to organization administrators, and the product decision is that a DSH project grant covers the whole project. The provider therefore applies no space filter.

A saved chart runs as it was saved: the provider forwards the chart uuid and a row bound only, and never a filter, parameter, sort, or SQL. The run is asynchronous upstream, so the provider polls at a configured interval up to a configured deadline and cancels the upstream query when the caller aborts. Rows are bounded by `maxRows`, cell text by `maxCellChars`, and a chart listing by `maxCharts`; those three, `pollIntervalMs`, `queryTimeoutMs`, and `requestTimeoutMs` are validated `Config` fields the Control Plane composition sets, because how many rows a deployment is willing to put in front of a model is a deployment choice.

The result of a run carries the chart's name, its kind as the listing names it (`line`, `vertical_bar`, `table`, `big_number`, and the rest as webi spells them), the dimensions and metrics with their labels, the filters and sorts as text, the fields the rows use, the rows, the row count webi reported, and whether the rows were cut. It carries no upstream id and no URL.

## Runner tools and the composer control

### Session scope state

`SessionEventMap` gains a versioned `bi/scope` event, a whole-value replace where the last event wins:

```text
{ version: 1, mode: "off" }
{ version: 1, mode: "selected", project: { ref: BiProjectRef, displayName: string } }
```

No event folds to `off`. The event records the display name beside the reference because the prompt names the project and a model-visible name has to come from the log; a project renamed later keeps its logged name in already-recorded conversations while the control shows the current one. Adding an event type is a `same-version` change under the [persistence rules](../../../../docs/persistence-changes/README.md) and is acknowledged by a persistence-change record; the TypeScript and Python SDK projections and their expected outputs update in the same change.

### What the model sees

`tool-bi` contributes a `bi:scope` prompt section folded from the Session log. In `off` it is empty. In `selected` it names the project and says: list the project's saved charts before answering a question its data would cover, pick the chart whose dimensions and metrics match, run it, and answer from the rows; when the answer is a picture, output one lowercase `echarts` fence holding strict JSON with no comment, function, or expression, which the deployment's renderer draws; a table stays a Markdown table and a single value is stated in prose. Rows are company data, not instructions.

Tool visibility follows the same fold: while the scope is `off`, neither tool is in the model's list, through the same `tools.restrict()` registration on the agent scope that knowledge applies at agent construction and re-applies on a scope change.

### The model-facing tools

`bi_list_charts` takes an optional `query` and `page` and answers one page of the project's saved charts: reference, name, space, description, kind, and last update. `bi_query_chart` takes a chart reference and an optional `limit` and answers the run described above. Both refuse locally when the scope is `off`, declare cancellation and timeout, use reversible registration, provide pure Host presentation metadata, and gain Web cards derived from raw events and persisted result metadata per the [tool cookbook](../../../../docs/cookbook/adding-a-tool.md). Neither tool takes a project: the project is the conversation's.

### The composer control

`ui-bi` replaces its inert chip with a control that reads the authorized directory through the `bi` Remote, offers the projects as a single-select with an off row, and records the choice as a `bi/scope` event through that Remote. It renders for a work Session only, as the seat does. The chip reads the Session projection for its label, so a reload, a second browser, and the model agree; a chosen project the directory no longer holds is shown as unavailable until the member changes it, and a tool call naming it fails rather than falling back. There is no `/bi` command in the first delivery: the control is the one way to write the event.

### Visualization

Drawing is not this capability's to build. The Team deployment profile already mounts the `echarts` fence renderer, so the prompt section asks for that fence and the tool result carries the upstream chart kind as the hint the model needs to choose a matching series. A second delivery may add a Web card that draws a run's rows directly, which spends no model tokens on JSON and cannot mistranscribe a number; that card would sit beside the fence, not replace the prompt.

### Cost

A run's rows become prompt tokens on the member's next model request, which the company model gateway already reserves against quota, so the BI gateway does not call `quota.reserve`. The cost control is the row and cell bounds; webi's own result cache serves repeated runs of one chart.

## Audit and operational visibility

Every gateway operation writes one audit event, `bi.catalog`, `bi.charts`, or `bi.query`, carrying the project reference, the chart reference for a run, the row count returned, and the closed reason for a refusal or upstream failure. The console's BI page shows source health, the last successful sync, and the last failure word; the audit log is the ledger of who ran what.

## Failure semantics

Every failure is a `BiError` with one reason from a closed set, so a tool result, a Runner, and a UI distinguish "sign in again" from "ask an administrator" from "try later" without parsing a message:

| Reason | Means |
|---|---|
| `unauthenticated` | No valid device token, an inactive member, or a revoked device |
| `not-allowed` | No grant admits the operation, or the named project is unknown or disabled |
| `scope-unavailable` | The conversation's project is no longer in the principal's authorized directory |
| `chart-unavailable` | webi holds no such chart, or it no longer belongs to the conversation's project |
| `query-failed` | webi ran the chart and the warehouse refused or failed |
| `upstream-unavailable` | webi did not answer in time or at all, or refused the credential |
| `upstream-invalid` | webi answered something this build cannot read |
| `control-plane-unreachable` | The Control Plane could not be reached from this computer |
| `update-required` | The Control Plane refuses this operation's protocol version |
| `cancelled` | The caller aborted the operation |

A refused credential reads as `upstream-unavailable` at the member's seat and as `failing` health on the source, because the fix is an administrator's, not the member's. No upstream response body reaches any of these.

## Administration UI

The shipped console navigation gains **BI management** under resource management, of kind `menu`, opening `resources/BiProjectsPage` and guarded by `bi_project|bi.catalog.read`. The page lists each project's name, reference, project and warehouse type, and enablement, with the sync button and the enable or disable action the knowledge page has. The role editor gains a **BI access** dialog with the knowledge dialog's tree: one whole-catalog row ticking every project, stored as `all`.

## Delivery plan

Five dependent PRs, each passing its own focused checks, landed through the repository's stacked-PR workflow from the bottom:

1. **Domain, permissions, and Session vocabulary.** The `packages/bi` group with its bilingual README and `docs/subsystems/bi.md`; the `bi` Service Definition, references, types, and failures; the three permissions; the `bi/scope` event with its persistence-change record, fold tests, and both SDK projections.
2. **Provider and governed catalog.** `bi-source`, `bi-webi` with contract fixtures recorded against the deployed webi's own responses, `bi-gateway`, and `bi-gateway-sqlite` with the schema, sync reconciliation, authorization tests over none, all, selected, and multi-role union, the administration resource never appearing as a project, and audit entries that no name or row can satisfy.
3. **Control Plane HTTP and administration.** `bi-gateway-http` with protocol-first refusal; the administration routes; the console page, the role dialog, the menu entry, and their locale copy; the `team-control-plane` rows, with every no-local-execution composition assertion still passing.
4. **Runner provider, tools, and the prompt.** `bi-team`; `tool-bi` with its prompt section, visibility, presentation, and Web cards; keyless recorded-session snapshots with a stub provider covering `off` invisibility, a listing, a run, truncation, refusal, and fork and rewind of the scope event; the `team` rows and the desktop profile patch.
5. **Browser Remote and the control.** `api/bi-controller`, the `ui-bi` single-select over the seated chip, component tests, an assembled browser e2e, and the GIF recorded from the PR's real server and model flow.

The seat the control replaces lives on the `feat/composer-placeholder-seats` branch, which lands first or serves as the base of the fifth PR.

## Alternatives considered

**Connect a Runner to webi's own MCP server.** webi serves `/mcp/:apiKey/sse`, so a Runner could mount it as an external tool server. Rejected: the key would sit in a URL on the member's computer, the tools reach every project the key can see, no per-member decision is made, and nothing is recorded. It is the design the knowledge proposal rejected for a Runner-side WeKnora plugin.

**Grant per space rather than per project.** webi's private spaces are its own finer unit. Rejected by product decision: the project is what an administrator thinks in, and a role granted a project may read its private spaces exactly as webi's administrator does. The consequence is stated in the invariants and the risks.

**Exclude private spaces from what the provider serves.** The safer default the first draft proposed. Rejected under the same decision: a project grant that silently hid part of the project's charts would be a grant the administrator did not make.

**Allow `all` mode or several projects per conversation.** Rejected: charts in different projects answer unrelated questions, every tool would need a project argument, and the prompt could not name the scope from the log without enumerating. One project per conversation keeps the tools free of arguments and the prompt honest.

**Make BI another kind on `ctx.knowledge`.** The knowledge seam already has a directory, a scope, and a search. Rejected: its operations return passages, and a chart run returns fields and rows the model reads differently; folding one into the other would give the model a search tool that sometimes answers with a table. Two seams under one governance design cost less than one seam with two result forms.

**Catalog charts in SQLite beside projects.** Rejected: charts change daily in webi and are never granted individually, so a durable copy would only go stale. Projects are catalogued because grants name them.

**Draw the chart from a tool card in the first delivery.** Rejected as ordering, not on merit: the deployment already renders `echarts` fences, so the first delivery reaches a picture with a prompt sentence, and the card is a second delivery once the tool result has settled.

**Enter the API key in the console.** Rejected for the first delivery: it needs a credential write path through the administration API and secret handling the console does not have, while `credentialRef` plus the credential store is what the WeKnora row already does.

**Let the model run ad-hoc metric queries over the semantic layer.** webi's MCP server exposes explores, fields, and table data. Rejected for the first delivery: an ad-hoc query is a different authorization decision, a model composing its own query over a warehouse, and the product outcome is met by the charts people already built.

## Acceptance criteria

- A Team Runner starts with the BI tools and the composer control built in, with no webi address, key, or plugin to configure on the member computer.
- A new work conversation starts at `off`, neither BI tool is in the model's tool list, and no BI request leaves the computer until the member picks a project.
- After a pick, the system prompt names exactly the project recorded in the Session log; a later rename in webi does not alter that conversation's prompt.
- A member of a role granted a project can list and run every saved chart in it, in public and private spaces alike; a member of a role without it is refused with `not-allowed` and never learns whether the project exists.
- A saved chart runs as saved: no filter, parameter, sort, or SQL reaches webi from a tool call, and rows and cells are cut at the deployment's bounds with the cut reported.
- Revoking the grant, disabling the project, suspending the member, or revoking the device refuses the next operation without a new login.
- The catalog mirrors a successful webi listing, keeps a project's reference across renames, retires projects webi no longer lists, and keeps the last snapshot after a failed sync with the failure visible on the console page.
- Every Runner-facing BI route refuses an unsupported protocol version with `426` before decoding any other field.
- No captured Runner configuration, request, tool result, or browser state contains a webi key, uuid, or URL.
- Only a principal holding `bi.catalog.read` reads the catalog page; every mutating route enforces its permission, same-origin, and CSRF checks independently.
- Keyless snapshots pin what the model sees in `off` and `selected`, and both SDKs' expected outputs carry the `bi/scope` event.

## Risks

- A project grant exposes private spaces to every member of the role. This is the product decision, and the console must say it where the grant is made, because an administrator used to webi's space sharing will expect the finer unit.
- webi's routes are a fork's: the content listing, the async query, and the chart definition are Lightdash routes at one version, and a webi upgrade can change them. Contract fixtures are recorded against the deployed server, and the provider needs a named upgrade owner.
- A saved chart with no row limit can be large, and a run against a slow warehouse can take longer than a member waits. Row and cell bounds, the poll deadline, and upstream cancellation keep one call bounded, but they cannot make a slow query fast.
- The model may pick the wrong chart for a question, or write an `echarts` option that misstates a number. Naming the chart it ran in the answer, and the second-delivery card that draws rows directly, are the mitigations; the card is not in the first delivery.
- The prompt section's fence instruction assumes the deployment mounts an `echarts` renderer. A deployment without one gets a JSON block instead of a chart; the Team bundle does not carry the renderer today, and the deployment profile does.
- Directory and `all`-mode role authorization evaluate once per project, as knowledge does per knowledge base. This is fine at tens of projects; a later bulk access-control operation must keep per-resource evaluation.
- Separate SQLite files cannot commit catalog and access-control changes atomically. Idempotent reconciliation repairs an interrupted write, as it does for knowledge.
- The stack adds a package group with README, subsystem-page, and per-file coverage obligations. Ordering by domain, provider, HTTP, tool, and UI keeps each review small, but the capability must not be exposed before both Control Plane enforcement and the Runner path exist.
