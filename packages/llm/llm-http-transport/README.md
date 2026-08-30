---
description: "Provider HTTP transport Service Definition: how a model request reaches a provider, separated from what the request says."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-http-transport

English | [中文](README.zh.md)

## Summary

`dsh-llm-http-transport` separates how a model request travels from what it says. An LLM adapter keeps everything it already owns — serializing the request, parsing the stream, image and file semantics — and a transport replaces only the trip: a member's own key going straight to a provider, or a company model going through the Control Plane with a credential the Runner never holds. A request names an operation from a closed list and a model, never a URL.

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
import '@deepseek-ai/dsh-llm-http-transport'

declare const ctx: Context

const response = await ctx.llmHttpTransport.send({
  operation: 'chat.completions',
  modelRef: 'company-v4',
  body: { model: 'company-v4', messages: [{ role: 'user', content: 'hi' }] },
  inputTokens: 1_200,
})
```

The response body is a stream. A model response is long, and a transport that buffered it would hold a whole completion in memory per request.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The operation list is closed

`TRANSPORT_OPERATIONS` is registered in code. A transport that took an arbitrary path would be a transport a caller could point anywhere, which is the whole thing the seam exists to prevent — and it lets a Control Plane refuse an operation it has not agreed to carry.

### A failure is a word, not a message

`TransportFailedError` carries `refused`, `unreachable`, or `not-bound`, because a caller has to decide whether to retry and a sentence is not a decision. A provider that answered with an error status is not a transport failure: that is a response, and it is returned.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service, its failure, and `ctx.llmHttpTransport` |
| [`src/vocabulary.ts`](src/vocabulary.ts) | The closed operation list |
| [`src/types.ts`](src/types.ts) | What a transport carries and hands back, types only |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`llm-http-transport-team`](../llm-http-transport-team/README.md) — the company transport.
- [Model-gateway subsystem](../../../docs/subsystems/model-gateway.md) — what the Control Plane does with a request this carries.

<a id="model-experience"></a>
## Model Experience

None, as the seam declares how a request travels and registers no prompt section, tool, or request context.

#### KV Cache effect

A transport does not change the bytes an adapter built, so it has no request prefix and no cache effect of its own.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One operation** — `chat.completions`. The list exists so a second is an addition with a name rather than a path a caller supplies.
- **No direct provider yet** — a member's own BYOK route still goes through the adapter's existing path; moving it behind this seam is its own change.
- **`inputTokens` is the adapter's count** — the seam carries it rather than computing it, because the adapter is where the body is already built.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

There is no URL in a `TransportRequest` and that is the design, not an omission. Adding one would make every transport a place where a caller decides where a credential goes.

</details>
