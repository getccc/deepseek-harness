# Agent Note: Team GMO supply-chain analysis through the Control Plane

Status: proposed

English | [中文](2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)

## Problem

The company's GMO supply-chain platform, excel-tools, turns supplier workbooks into processing results (demand, supply, net gap, allocation) and answers the questions planners ask most through its statistics page: how much is short, which supplier owes it, which week it falls due, which material is short most. A Team member who asks DSH one of those questions gets an answer from general knowledge, because no capability reaches excel-tools, and a model that did reach it would still misread the data: GB and GL, the 2030-12-31 placeholder date, the three different meanings of "gap", and the allocation order are company rules a model cannot infer from column names. [BI analysis](2026-09-17-team-bi-analysis-through-the-control-plane.md) and [private knowledge](2026-09-01-team-private-knowledge-control-plane.md) already solve the access half: the Control Plane holds the credential, an administrator grants per resource, the Session records what a member chose, and the model sees a tool only after a choice. What is missing is the GMO counterpart: a governed unit that matches how the business thinks, an upstream interface excel-tools does not yet have, and a way to hand the business rules to the model.

## Proposal

Ship GMO supply-chain analysis as a separate Team capability beside BI, not as a second BI source. excel-tools gains a read-only, token-authenticated gateway; the `team-control-plane` profile mounts a provider that holds its token, a governed category catalog, the Runner-facing routes, and the administration routes; the `team` profile mounts the Runner-side provider, five model-facing tools with a prompt section, the browser Remote, and the composer control.

### Product outcome

- An administrator creates a gateway token on excel-tools' **管理 → 对话网关** page and stores it as the `gmo-source` row's `credentialRef`.
- An administrator sees every excel-tools category under **Resource management → GMO supply chain**, refreshes the catalog, and enables or disables each category. A category the source starts serving appears switched off, so a role granted every category does not gain a business line the moment it exists.
- An administrator opens a role's **GMO supply-chain access** dialog and grants none, all enabled categories, or selected ones.
- A member of a granted role opens a work conversation, picks one category from the composer's GMO control, and asks an ordinary question. The model lists the category's results, describes the one that answers the question, asks it for figures, and answers from them, stating which result, measure, and filters the answer rests on.
- A conversation starts with GMO off. Until the member picks a category, no GMO tool is visible to the model and no GMO request leaves the computer.
- Revoking the grant, disabling the category, suspending the member, or revoking the device changes the next operation without a new login or conversation.

### Non-goals for the first delivery

- No export, download, deletion, upload, or tool run through the gateway; it reads statistics only.
- No row-level or per-result authorization: the category is the unit, and a member granted it reads every result in it.
- No cross-category questions and no several categories in one conversation.
- No native dashboard panel in the member UI; a panel over the same gateway is a later delivery.
- No second BI source: `ctx.biSource` is a singleton and a BI question is a saved chart, which is not what a planner asks.

## Security invariants

1. The Runner stores no excel-tools address, token, category key, or result id that could authorize a direct upstream call; a Runner request carries governed references only.
2. Every Runner-facing request verifies the current device access token and takes `orgId`, `principalId`, and `deviceId` from verified claims, never from request fields.
3. The Control Plane evaluates `gmo.query` on the category every operation names, on every call. An unknown, disabled, and ungranted category produce the same refusal.
4. A result is authorized through the category excel-tools says it belongs to, resolved upstream on every call, so a result reference from another category is refused before any figure is read; an answer the source attributes to a different category is dropped unread.
5. Session scope only narrows current authorization; it is re-evaluated on each operation and survives only in the Session log.
6. Result names, column values, filters, figures, and upstream error bodies never enter the Control Plane audit store or ordinary logs; an audit row carries references, the kind of question, counts, and closed reasons.
7. The Control Plane calls only its configured excel-tools origin and the fixed endpoint set below. A Runner request has no URL, header, statement, or operation field the gateway did not define; a question is a closed vocabulary whose columns and values the source validates against the result's own columns.
8. Every Runner-facing route carries a GMO `protocolVersion` evaluated before any other field; an unsupported version answers `426` and performs no operation.
9. Whatever the model can see about the chosen category is reconstructable from the Session log alone: the prompt names the category from the log, and the business rules reach the model as tool results, which the log records.

## Runtime architecture

```text
3090 Team Runner                                   3095 Control Plane                  excel-tools

composer GMO control                              administration API
        |                                                 |
gmo/scope Session event                         governed category catalog
        |                                                 |
prompt section + tool visibility                        RBAC + audit
        |                                                 |
gmo_list_results / describe / aggregate /                 |
gmo_overview / gmo_rows                                   |
        |                                                 |
Team GMO Provider -- current device token --> GMO Gateway -- fixed endpoints + token --> /api/gateway
```

### Capability and package topology

| Package | Role and responsibility |
|---|---|
| `packages/gmo/gmo` | Browser-safe Service Definition `ctx.gmo`, the branded `GmoCategoryRef` and `GmoResultRef`, the question vocabulary and its readers, the `gmo/scope` Session event, and the closed failure set |
| `packages/gmo/gmo-source` | Control Plane-only upstream interface `ctx.gmoSource`: list categories and results, place and describe a result, ask it a question, in upstream ids |
| `packages/gmo/gmo-excel-tools` | The provider for excel-tools' gateway; resolves the token per operation and bounds items, time, and bytes |
| `packages/gmo/gmo-gateway` | Governed gateway `ctx.gmoGateway`: the durable category catalog and the authorized directory, listing, description, and question |
| `packages/gmo/gmo-gateway-sqlite` | Durable catalog, synchronization, access-control registration, per-category authorization, and audit |
| `packages/gmo/gmo-gateway-http` | Runner-facing routes with token verification and the GMO protocol version |
| `packages/gmo/gmo-team` | Runner-side `ctx.gmo` provider carrying the current device token to its configured Control Plane |
| `packages/gmo/tool-gmo` | The five tools, the `gmo:scope` prompt section, scope-driven visibility, and the scope projection |
| `packages/api/gmo-controller` | Team-only Remote serving the browser its authorized categories and recording the conversation's choice |
| `packages/client/ui-gmo` | The composer control: a single-select over authorized categories |

BI's package shape is kept, with two seams between the Runner and excel-tools for the reason BI keeps two: `ctx.gmo` names what a member wants, `ctx.gmoSource` names what excel-tools can do, and the gateway between them is the only party that maps a governed reference to an upstream id and decides whether it may.

### The authorization unit

The unit is excel-tools' **category**, the business line shown as a tab on its tools page (`gb`, later `mfc`, customer-supplied material, MTS), not a tool and not a result. A category holds several tools, and a one-click result already contains the stages of the tools beneath it, so a grant per tool would split a workflow; results are produced continuously, so a grant per result would never be current. Categories are registered in `backend/app/categories.py` of excel-tools; a registered category with no tool is not served, and a tool whose category is not registered, such as the retired four-step tools, resolves through an explicit legacy map or not at all.

### Stable references

```text
exceltools:<sourceCode>:<categoryKey>
exceltools:<sourceCode>:<categoryKey>/<resultId>
```

The category reference is the durable catalog key and the access-control `ManagedResource.externalRef`; grants name the resource's surrogate id, so a renamed category keeps every grant. The 64-character, audit-token bounds are BI's. excel-tools names one step of a one-click result `<id>~<stage>`; `~` is outside the reference alphabet, so the provider's own id spells the separator `.` and translates only when it builds a path, and it refuses any id that does not match `[0-9a-f]{32}(.[a-z0-9-]+)?`.

<a id="excel-tools-gateway"></a>
## The excel-tools gateway

excel-tools gains `/api/gateway`, read-only and fixed:

| Operation | Route |
|---|---|
| List categories that hold at least one tool | `GET /categories` |
| List a category's results, newest first | `GET /categories/{key}/results` |
| Place a result in its category, without reading figures | `GET /results/{id}/placement` |
| Describe a result: columns with meaning, dashboard dimensions, today's date, the category's rules | `GET /results/{id}` |
| Free-form aggregation over whitelisted columns | `POST /results/{id}/aggregate` |
| Ready-made dashboards, detail rows, candidate values, supply-demand views | `POST …/insights/{widget}`, `POST …/query`, `GET …/facets/{field}`, `GET …/balance*` |

The gateway accepts only `Authorization: Bearer <token>` and never the login cookie; tokens are created on an administrator page, stored as SHA-256 hashes, shown once, and revocable, or set by environment variable. Every response carries its `category`. Status codes keep four meanings apart: `404` the result does not exist, `409` the result exists and has no such view, `400` the question is wrong, `413` the answer is over the byte bound. Bounds on items and bytes are environment settings, and an answer over the byte bound is refused rather than truncated.

`aggregate` is what makes the model's questions open-ended without opening SQL: a metric (`sum`, `count`, `distinct`), up to two group columns from the result's own column whitelist, a date grain, filters, an order, and a limit. The existing dashboards stay for the computations a model should not re-derive, such as the overdue, this-week, and next-N-weeks buckets that are relative to today.

## Teaching the model the business

The model knows general supply-chain vocabulary; it does not know this company's rules. The meaning travels with the data, owned by excel-tools and served by its `describe`:

- Every result column carries a `description` written where the column is declared, so the dictionary cannot drift from the schema.
- Each category has a Markdown glossary, `backend/app/glossary/<key>.md`, covering the stages of a result, the three meanings of "gap" (net gap, remaining gap, the balance view's gap), the date rules including the 2030-12-31 placeholder and the adjusted requirement date, supplier and brand mapping, and the allocation order.
- `gmo_describe_result` returns both, and the prompt section tells the model to describe a result before choosing a column and to treat the written rules as authoritative.

Because the rules arrive as tool results, a new category needs no Runner release: excel-tools gains the category, a glossary, and column descriptions, and an administrator enables it. The prompt section stays short and fixed, which keeps the request prefix stable.

### What the model sees

Five tools, none visible while the scope is `off`: `gmo_list_results`, `gmo_describe_result`, `gmo_aggregate`, `gmo_overview` (the dashboards), and `gmo_rows`. None takes a category: the category is the conversation's, and a result reference outside it is refused locally as well as on the Control Plane. A missing view (`409`) is returned as an answer that says so, and the model is told not to compute it another way; a refused question names `gmo_describe_result` as where the column keys are. An aggregation renders as a table under its overall total so the model quotes shares from the total instead of adding rows.

### Session scope state

`SessionEventMap` gains `gmo/scope`, a whole-value replace where the last event wins:

```text
{ version: 1, mode: "off" }
{ version: 1, mode: "selected", category: { ref: GmoCategoryRef, displayName: string } }
```

The display name is recorded beside the reference because the prompt names the category and a model-visible name has to come from the log. The event is `same-version` under the persistence rules and is acknowledged by a persistence-change record.

## Control Plane API

### Administration API

| Method and path | Permission | Behavior |
|---|---|---|
| `GET /team/api/gmo-categories` | `gmo.catalog.read` | The durable catalog, effective enablement, source health, and last sync state |
| `POST /team/api/gmo-categories/sync` | `gmo.catalog.manage` | One serialized full synchronization; concurrent callers join it |
| `PATCH /team/api/gmo-categories/:categoryRef` | `gmo.catalog.manage` | Administrator enablement of one category |
| `POST /team/api/roles/:roleId/gmo-categories` | `role.grant.manage` | Replace the role's `gmo.query` grants with `none`, `all`, or a selected set |

The permission catalog gains `gmo_category` with `gmo.query`, `gmo.catalog.read`, and `gmo.catalog.manage`, shipped on the same terms as BI's. The audit catalog gains `gmo.results`, `gmo.describe`, `gmo.ask`, and `gmo.catalog.sync`, with metadata limited to the kind of question, an item count, and a closed failure label.

### Runner API

`POST /team/gmo/catalog`, `/results`, `/describe`, and `/ask`, each carrying `protocolVersion` and referencing only governed references. The question is parsed by a reader in the domain package that the Runner's tools and the Control Plane both use; a key the vocabulary does not define is refused rather than ignored, because a Runner that believes a filter applied and a Control Plane that dropped it would produce a confident wrong number.

## Failure semantics

A closed set of reasons, BI's with the chart words replaced and three added: `result-unavailable`, `unsupported` (the result has no such view), `invalid-query` (the source refused a column, filter, or value), and `too-large`. `unsupported` is an answer, not a fault, in the tools. A refused or revoked token reads as `upstream-unavailable` at the member's seat and as `failing` health on the source.

## Delivery plan

Dependent changes, each with focused checks:

1. **excel-tools gateway**: the category registry, tokens and their administrator page, `describe`, `aggregate`, field descriptions and the glossary; its own test suite, plus a run against a copy of the production database reproducing the statistics page's figures.
2. **Domain, permissions, and Session vocabulary**: the `gmo` package, the three permissions, audit actions, the `gmo/scope` event with its persistence record and SDK projections.
3. **Provider and governed catalog**: `gmo-source`, `gmo-excel-tools`, `gmo-gateway`, `gmo-gateway-sqlite`.
4. **Control Plane HTTP and administration**: `gmo-gateway-http`, the administration routes, the console page, the role dialog, the `team-control-plane` rows.
5. **Runner provider, tools, and the prompt**: `gmo-team`, `tool-gmo`, the `team` rows, the desktop deployment row.
6. **Browser Remote and the control**: `api/gmo-controller`, `ui-gmo`, an assembled browser test.

## Alternatives considered

**A second BI source.** Make excel-tools a `biSource` whose "projects" are categories and whose "charts" are preset views. Rejected: `ctx.biSource` is a singleton the gateway injects, so two sources need a registry first; saved charts run as saved, which cannot answer "only Hungo, next week"; and BI's non-goal of no filters is the opposite of what a planner asks. One capability with a vocabulary of its own costs a package group and buys questions that are not fixed in advance.

**Authorize per tool.** The tool is what excel-tools' code calls a unit, but a one-click result already contains the stages of three tools and the legacy tools share results, so the boundary would not match the data. Rejected for the category.

**Authorize per result.** Results are created on every run; a grant would never be current.

**Embed excel-tools' statistics page in the member UI.** Rejected: the page depends on cookies and the whole `/api`, so embedding it means either exposing that API through the Control Plane or bridging sessions, which gives up the fixed-endpoint rule. A native panel over the gateway is possible later.

**Let the model write SQL or pass a statement.** Rejected: that is a different authorization decision, and the whitelisted columns and fixed metrics cover the questions the page itself answers.

**Put the business rules in the prompt section.** Rejected: the prompt would grow with every category and need a Runner release per category, and the rules would not be in the Session log as a model-visible input. Tool results are logged and owned by the data's owner.

**Enter the token in the console.** Rejected as BI rejected a key field: `credentialRef` plus the credential store is the existing path.

**Share one catalog helper across knowledge, BI, and GMO before adding GMO.** The three catalogs now duplicate reconciliation and authorization code. Extracting it first would touch shipped knowledge and BI code that no recorded-session test covers; the duplication is documented in the package Dev Notes and is the first follow-up.

## Acceptance criteria

- A Team Runner starts with the GMO tools and the composer control built in, with no excel-tools address, token, or plugin to configure on the member computer.
- A new work conversation starts at `off`, none of the five tools is in the model's tool list, and no GMO request leaves the computer until the member picks a category.
- After a pick, the system prompt names exactly the category recorded in the Session log; a later rename in excel-tools does not alter that conversation's prompt.
- A member of a role granted a category can list, describe, and ask every result in it; a member of a role without it is refused with `not-allowed` and never learns whether the category exists; a category the source newly serves reaches no member until an administrator enables it.
- A result reference whose category the source disagrees with is refused before any figure is read, and an answer attributed to another category is dropped.
- The figures a question returns equal the statistics page's for the same result and filters: the total remaining gap, the overdue and next-N-week buckets, and a ranking by material.
- Revoking the grant, disabling the category, suspending the member, revoking the device, or revoking the gateway token refuses the next operation without a new login.
- Every Runner-facing GMO route refuses an unsupported protocol version with `426` before decoding any other field, and refuses a question key the vocabulary does not define.
- No captured Runner configuration, request, tool result, or browser state contains an excel-tools address, token, or result identifier beyond a governed reference.
- Only a principal holding `gmo.catalog.read` reads the catalog page; every mutating route enforces its permission, same-origin, and CSRF checks independently.
- A real-model session answers a set of questions whose figures are known from the statistics page, naming the result and the measure, and treats a missing view as an answer.

## Risks

- A category grant exposes every supplier, material, and quantity in its results to every member of the role. There is no row-level control in excel-tools, and the console must say so where the grant is made.
- The model may choose the wrong measure or mix the three meanings of "gap". The glossary and the stated-basis rule reduce it; only a real-model run with known answers measures it, and the repository has no keyless snapshot lane for Team capabilities.
- Column descriptions and the glossary are written by hand from the documented rules, and a rule changed in the processing code without a matching edit leaves the model reading a stale rule. The category's owner must keep them with the code that implements the rule.
- A result is a snapshot of one processing run; a question across periods needs two answers the model combines itself, and no comparison tool exists in the first delivery.
- The gateway token's reach is excel-tools' whole read surface. It cannot write or export, but it can read every category, so the Control Plane's per-category authorization is the only separation between categories; the token must not leave the Control Plane.
- A deployment must state `sourceCode`, `baseUrl`, and `credentialRef` before the Control Plane starts, as BI does; a Control Plane upgraded without them fails to load the row.
- The stack adds a package group with README, subsystem-page, and per-file coverage obligations, and a third copy of catalog reconciliation.
