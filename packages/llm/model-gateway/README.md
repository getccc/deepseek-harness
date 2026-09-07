---
description: "The company model gateway Service Definition: the catalog of models an organization serves, and the decision that turns a model name into an approved upstream call."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-gateway

English | [中文](README.zh.md)

## Summary

`dsh-model-gateway` is what a company model call goes through. A Runner names a model and sends a body; it gets back a call it could not have constructed itself, because the endpoint, the upstream model name, and the credential all come from the catalog. That is what makes "the company credential never reaches the Runner" a property of the design rather than a promise — there is nowhere in the request for a Runner to put one. Pair it with a backend such as [`model-gateway-sqlite`](../model-gateway-sqlite/README.md).

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

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import { applyPlanToBody } from '@deepseek-ai/dsh-model-gateway'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId
declare const body: Record<string, unknown>

const plan = await ctx.modelGateway.authorize({
  orgId, principalId, modelRef: 'company-v4', period: '2026-08', inputTokens: 1_200,
})

// plan.endpoint, plan.upstreamModel, and plan.credentialRef came from the
// catalog; the Runner supplied none of them.
const upstream = applyPlanToBody(body, plan)

await ctx.modelGateway.settle(plan.reservationId, { kind: 'reported', inputTokens: 1_200, outputTokens: 830 })
```

`authorize` refuses with one word: `unknown-model`, `model-retired`, `not-allowed`, `quota-exceeded`, or `malformed`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Absent and ungranted answer alike

A model that does not exist and one this principal may not invoke are both `unknown-model`, so a refusal never tells a member which models an organization has. `not-allowed` is reserved for a principal access control knows and refuses for some other reason.

### Two body fields, and only two

[`applyPlanToBody`](src/body.ts) overwrites `model` with the catalog's upstream name, and bounds `max_tokens` or `max_completion_tokens` **when the body already carries one**. Adding a limit the adapter did not send would change a request it meant. Where the call goes is not in the body at all, so there is nothing else to strip.

### A reference, not a key

`credentialRef` is a name the credential provider resolves, such as `COMPANY_DEEPSEEK_KEY` — not a `scope/id` credential key, which addresses a different thing and resolves as nothing. [`register`](src/index.ts) refuses a value that is not a reference, so the mistake fails where an administrator makes it rather than on every call to a model the catalog reads as active.

### The catalog declares what a request may carry

`inputModalities` on an entry is the one place a model's accepted input is written down: `text`, or `text` and `image`. `discover` hands it to a member's Runner with the ref and the display name, and the Runner refuses an image for a model that does not list `image` before anything is sent, because it holds no provider credential with which to find out. The word list is the transport seam's `MODEL_INPUT_MODALITIES`, re-exported here, so the catalog that stores the declaration and the adapter that reads it name the same closed set.

### The catalog's ceiling wins

A Runner asking for more output than the model is configured to produce gets the configured amount, and the reservation is taken against that. A smaller ask is honoured, so a short request does not hold a long request's budget.

### Retiring and deleting are different acts

`setStatus` withdraws a model from service and returns it: the entry and every grant naming it stay as they were. `remove` takes the entry out along with those grants, so a model registered later under the same ref starts with no access. Neither fails on a ref the catalog does not hold, and `remove` ungoverns only what `register` governed: another subsystem's resource of the model type is left alone even when it carries the ref that was asked for.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service, its refusal, and `ctx.modelGateway` |
| [`src/body.ts`](src/body.ts) | What the gateway overwrites before a body goes upstream |
| [`src/vocabulary.ts`](src/vocabulary.ts) | The status and refusal word lists |
| [`src/types.ts`](src/types.ts) | Catalog entry, request, and call-plan shapes, types only |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`model-gateway-sqlite`](../model-gateway-sqlite/README.md) — the shipped backend.
- [Model-gateway subsystem](../../../docs/subsystems/model-gateway.md) — the three decisions and what reaches the provider.
- [`quota`](../../access/quota/README.md) — the ledger a plan's reservation is held in.

<a id="model-experience"></a>
## Model Experience

None, as the gateway is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

The gateway does not build a request prefix; it rewrites two fields of one an adapter already built. Overwriting `model` changes the upstream request, so a Runner that switches between two catalog refs mapping to the same upstream model still produces identical bytes and keeps the provider's cache.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **Nothing here calls a provider** — `authorize` produces a plan and `settle` closes it; performing the HTTP call, resolving the credential, and streaming the response belong to the transport in front of it.
- **One body format** — `model` is the field name in the OpenAI-compatible request shape, which is the only one this build proxies. A provider that names it differently needs its own entry, not a guess.
- **No Files API** — company file uploads need their own ownership mapping, which this catalog does not carry.
- **`inputTokens` is supplied by the caller** — the gateway reserves against what it is told, and a caller that under-reports would under-reserve. Counting them is the transport's, where the body is already parsed.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The Runner sends the body its own LLM adapter built. Reimplementing every provider's request format in the Control Plane would be a second adapter to keep correct, and the two would drift; overwriting the fields that decide *which model* and *how much output* is the smallest intervention that makes the authorization mean something.

</details>
