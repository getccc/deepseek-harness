---
description: "The GMO supply-chain service (ctx.gmo): the stable category and result references, the authorized category directory, result listing, description, and question vocabulary, the Session GMO scope, and the closed failure taxonomy."
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo

English | [中文](README.zh.md)

## Summary

`dsh-gmo` (`ctx.gmo`) is the service a Team Runner asks for the GMO supply-chain categories its signed-in member may analyze. It defines four operations — read the authorized category directory, list one category's results, describe one result, ask one result a question — plus the two governed references, the `gmo/scope` Session event, the question vocabulary, and the closed failure set. It makes no network call: a mounted provider does, and in Team Edition that provider forwards to a Control Plane that authorizes every operation.

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

A composition that needs GMO analysis mounts a provider, which registers this service; plugin and tool authors then call `ctx.gmo.catalog()`, `ctx.gmo.results()`, `ctx.gmo.describe()`, and `ctx.gmo.ask()`. No call takes a source, an address, or a credential, because none is the caller's to choose.

### When to choose it

Import it to build a GMO provider, a model-facing GMO tool, or anything that must read the Session's GMO scope. A deployment that only wants the shipped behavior gets it through the Team profile instead. The service registers no tool and contributes no prompt of its own: without a mounted provider, every operation is absent rather than empty.

### Minimal configuration

The service has no configuration — it is an abstract service. A provider row supplies whatever a deployment varies:

```yaml
- name: '@deepseek-ai/dsh-gmo-team'
  config:
    controlPlaneUrl: https://dsh.example.com
```

### Naming a category and a result

`GmoCategoryRef` is `<providerKind>:<sourceCode>:<upstreamId>` and is the only category identifier that leaves the Control Plane. `GmoResultRef` is `<GmoCategoryRef>/<upstreamResultId>`. Build them with `formatGmoCategoryRef` and `formatGmoResultRef`, read them back with the `parse` functions, which return `undefined` rather than throwing because their callers are deciding whether to accept a value rather than diagnosing one. A category reference is bounded at 64 characters over the audit token alphabet and its source code at 19; a result id is bounded at 64 characters over the same alphabet without the colon and the slash, so a step of a multi-step result is spelled `<id>.<stage>`.

### Asking a question

`GmoQuery` is a closed vocabulary with three kinds: `aggregate` (a sum, a row count, or a distinct count over up to two group columns, with a date grain, an order, and a limit), `overview` (one of the source's ready-made dashboards), and `rows` (a page of detail). `readGmoQuery`, `readGmoFilters`, and `readGmoCount` prove an unknown value is one: the Runner's tools use them before anything is sent and the Control Plane uses them on arrival. A key the vocabulary does not define is refused rather than ignored.

### Reading the Session scope

`foldGmoScope(events)` recovers the current scope from a Session log, and its `end` argument folds a prefix so rewind and fork read what the log said at that point. A log with no `gmo/scope` event folds to `off`. `categoryOf` answers the recorded category, or `undefined` for `off`. The scope names one category or none; there is no arm meaning every category.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The service is small because every operation it names has to be one the Control Plane can authorize against a current account, a current device, and current grants. A question is a vocabulary rather than a statement for the same reason: the Control Plane can say what is asked, record its kind, and refuse what it does not define.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `Gmo` service definition and the package's exports |
| [`src/brand.ts`](src/brand.ts) | The two governed references, their grammar, and their bounds |
| [`src/types.ts`](src/types.ts) | The directory, listing, description, question, answer, scope, and failure types |
| [`src/query.ts`](src/query.ts) | The readers that prove a value is a question, a filter set, or a count |
| [`src/scope.ts`](src/scope.ts) | The `gmo/scope` Session event, its fold, and its validator |
| [`src/error.ts`](src/error.ts) | `GmoError`, which carries one closed reason |

### Data model

A description carries what a reader needs to ask good questions: each column's key, type, filter kind, and the business meaning its owner wrote; the dashboard's measure and dimensions; the source's current date; and the category's written rules in Markdown. An answer is the source's own bounded JSON beside the references it answers for, because the figures are the source's to compute and nothing here re-derives them.

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the shared vocabulary and failure taxonomy.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — why the category is the authorization unit and why the business rules travel with the data.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the GMO tool package, which renders result listings, descriptions, and answers to the model and contributes the scope prompt section. This service contributes no prompt and registers no schema.

#### KV Cache effect

No direct invalidation. The named consumer owns the request-prefix change a scope choice causes, which is real: changing scope changes both a prompt section and the tool list, so the following request re-reads its prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **No several categories in one Session** — the scope names one category or none, so a question across business lines is two conversations.
- **No statement of the caller's own** — a question is one of three kinds; nothing here runs a statement, joins results, or compares two periods.
- **Failures are one closed set** — a source refusal reads as `invalid-query`, `unsupported`, or `too-large` without the source's own words, so a caller cannot show a member why a column was refused beyond pointing at the description.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the service owns no registry and emits no events; the fold that recovers the scope is asserted by the package's tests against a Session log.
