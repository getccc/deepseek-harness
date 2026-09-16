---
description: "The Team-only knowledge Remote: the authorized directory a browser reads, the Session scope choice it records, and the retrieval a member runs for themselves."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-knowledge-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-knowledge-controller` is the Host half of every browser surface for private knowledge: what a member may search, what they chose for one Session, and the retrievals they run outside a conversation. The browser cannot reach `ctx.knowledge` itself — the service lives on the Host and its provider holds the device token — so the picker and the panels ask here. It is its own package because knowledge is Team-only: a composition without it does not mount this, where a controller tolerating an absent service would report an empty directory, which reads as "you have access to nothing".

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

Mount it in a composition that already mounts a knowledge provider; it registers the `knowledge` Remote namespace.

### Minimal configuration

The controller needs no configuration. `searchDocuments` (default `10`) is how many distinct documents one panel retrieval ranks; a deployment that wants a longer ranking raises it here, and the provider's own document bound still applies.

```yaml
- name: '@deepseek-ai/dsh-knowledge-team'
  config:
    controlPlaneUrl: https://dsh.company.com
- name: '@deepseek-ai/dsh-api-knowledge-controller'
```

### The seven methods

| Method | Answers | Needs a Session |
|---|---|---|
| `scope(sessionId)` | What one Session may choose from, what it has chosen, and which selected references the directory no longer holds | Yes |
| `choose(sessionId, mode, knowledgeRefs?)` | Records `off`, `all`, or the knowledge bases selected, and answers the same view | Yes |
| `chooseDocuments(sessionId, documents)` | Narrows the Session to documents inside one authorized knowledge base, each recorded with the title it was chosen by, and answers the same view | Yes |
| `directory()` | The knowledge bases this member may search right now, each with the document count and creation time the Control Plane reports for it | No |
| `documents(knowledgeRef, page?)` | One page of one knowledge base's documents, each named by a governed reference | No |
| `documentContent(docRef)` | One document's original file as base64, or the parsed text standing in for it | No |
| `search(query, mode, knowledgeRefs?)` | The best passages of the `searchDocuments` most relevant documents, grouped by document, and the knowledge bases actually searched | No |

The directory is read on every call rather than cached: a grant revoked since the last look should narrow the picker, and a knowledge base an administrator switched off should leave it.

`directory`, `documents`, `documentContent`, and `search` touch no Session: they append no event, start no model turn, and need no conversation to be open. That is what makes them safe for a panel a member opens on their own — and it is why authorization is unchanged rather than relaxed, because the Control Plane evaluates every knowledge base the call names, on that call. A well-formed reference is passed through rather than checked against a directory read here: the answer that matters is the Control Plane's, and anticipating it would cost a directory read per query and could still disagree.

### Why a document carries the title it was chosen by

`chooseDocuments` records each title the browser sends rather than looking one up. There is no governed operation that describes a single document, and adding one would put a Control Plane round trip in front of opening a conversation for a label. The title is not an authorization fact — the knowledge base holding the document is, and that is authorized against the directory on this call — so it is folded to one line of at most 200 characters, because it reaches the prompt, and recorded as the member saw it.

### Why a choice carries names

The scope event records a display name beside each reference, because the prompt names the chosen knowledge bases and a model-visible name has to be reconstructable from the Session log. The names come from the directory as it stands at the moment of choice.

That is also why a reference the directory does not hold is refused rather than recorded. The Control Plane would refuse it at search time anyway, and recording it would put a name in the log that no search can honour.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Nothing here authorizes. The directory this controller offers is one the Control Plane already narrowed to what the member holds, and a search over the recorded choice is authorized again on its own. What this owns is the difference between a member's intent and what the log says — which is why a stale selection is reported rather than silently shrunk.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The `knowledge` Remote namespace, its request validation, the scope projection, the document listing and read, and the member-run retrieval |

<a id="further-exploration"></a>
## Further Exploration

- [dsh-client-ui-knowledge](../../client/ui-knowledge/README.md) — the picker and chip this namespace answers.
- [dsh-client-ui-knowledge-panels](../../client/ui-knowledge-panels/README.md) — the panels that read the directory and run retrievals.
- [Knowledge subsystem](../../../docs/subsystems/knowledge.md) — the scope value this records.
- [Team private knowledge Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — why the scope lives in the Session log.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-knowledge`: the scope this records is what its prompt section names and what decides whether its tool is offered. This controller contributes no prompt and registers no schema. A retrieval run through `search`, and a listing or read run through `documents` and `documentContent`, reach no model at all — what they answer goes to the browser and ends there.

#### KV Cache effect

No direct invalidation, but a recorded choice causes one: the named consumer's prompt section and tool list both change, so the following request re-reads its prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the controller is incomplete on its own. They are current package constraints.

- **A choice needs a live Session** — `scope` and `choose` resolve an agent by Session id and refuse when none is open, so a scope cannot be set for a conversation that is not running. `directory` and `search` need no Session.
- **A member-run retrieval is not recorded anywhere** — `search` appends no Session event, and what the Control Plane audits is the retrieval, not which browser surface asked for it.
- **A file crosses the boundary base64** — `documentContent` answers one whole file as text in JSON, which costs about a third again in transfer. The Control Plane's byte bound is what keeps that affordable; nothing here streams or caches.
- **No change notification** — a browser that has the picker open does not learn that a grant changed; it sees the narrowed directory the next time it opens.
- **No per-choice audit** — recording a scope writes only the Session event. Which knowledge bases a member searched is audited by the Control Plane at search time, which is where the decision is.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

A method declares only the parameters a caller sets. The generated Remote client counts *declared* parameters, so a browser call that omits a trailing optional is refused before it reaches the wire (`expected 3 argument(s), got 2`). A bound nobody passes therefore has to be a Control Plane setting rather than an unused optional here; that is why paging size and the byte and result maxima are not on this surface. `apps/web/tests/knowledge-panels.e2e.ts` is the only tier that would catch a regression, because it runs the generated client.

</details>

**Runtime invariant:** No companion is published: the controller holds nothing between calls and owns no registry; that a recorded scope names only knowledge bases the member could search when they chose is enforced inside `choose` against a directory read in the same call, and asserted by the package's tests.
