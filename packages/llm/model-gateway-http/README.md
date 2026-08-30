---
description: "The Control Plane's company model endpoint: authorize, attach the credential, stream the provider's answer, and settle from what it reported."
kind: "package-reference"
---

# @deepseek-ai/dsh-model-gateway-http

English | [中文](README.zh.md)

## Summary

`dsh-model-gateway-http` is where the content of a company model call actually passes through the Control Plane, and the one place a provider credential is attached. Everything it does is arranged around two facts: the request must not be able to say where it goes, and the response must not be held in memory. It verifies the device access token, asks the [gateway](../model-gateway/README.md), resolves the credential for the length of one call, streams the provider's answer back, and settles the reservation from what the provider said it cost.

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

```yaml
plugins:
  '@deepseek-ai/dsh-model-gateway-http':
    maxRequestBodyBytes: 4194304
    upstreamTimeoutMs: 600000
```

`upstreamTimeoutMs` belongs above the longest completion a deployment expects. A request cut off here is charged its ceiling, because a provider that stopped answering may still have generated tokens.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### One answer for every bad token

An unknown token, a lapsed one, and one whose device was revoked all answer 401. Which it was is exactly what an attacker holding a stale token wants to learn.

### The credential exists for one call

It is resolved here and written nowhere — not into the plan, not into the catalog, not into a log. A catalog entry naming a reference nobody configured, or something that is not a credential reference at all, answers 500 and charges nothing: that is this deployment's problem rather than the member's.

### Usage is read by watching, not by holding

[`UsageScanner`](src/usage.ts) keeps one line and one usage object as the response goes past. Both response shapes work through the same scanner: a non-streaming body is one JSON document, and a stream is `data:` frames whose last ones carry the usage.

### What each outcome settles

| Outcome | Settlement |
|---|---|
| The provider reported usage | `reported`, whatever the status — those tokens were generated |
| A status ≥ 400 with no usage | `released` — the provider said it did not accept the request |
| A success with no usage field | `estimated` at the ceiling — it may still have produced tokens |
| No response at all | `estimated` at the ceiling — no response is not evidence of refusal |

### A settlement failure is not the member's problem

If settling throws, the response the member already received stands and the [reconciler](../../access/quota/README.md) closes the reservation later. Throwing here would replace a working answer with an error about bookkeeping.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The endpoint, the proxy, and the settlement decision |
| [`src/usage.ts`](src/usage.ts) | Reading a provider's usage out of a response nobody buffers |
| [`src/protocol.ts`](src/protocol.ts) | The path and the body both sides import |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Model-gateway subsystem](../../../docs/subsystems/model-gateway.md) — the whole decision in prose.
- [`llm-http-transport-team`](../llm-http-transport-team/README.md) — the Runner side that calls this.
- [`quota`](../../access/quota/README.md) — where a settlement lands.

<a id="model-experience"></a>
## Model Experience

None, as the endpoint carries a request an adapter built and registers no prompt section, tool, or request context.

#### KV Cache effect

The endpoint rewrites the model field before the call goes upstream, so two catalog refs mapping to the same upstream model produce identical bytes and keep the provider's cache. Nothing else in the body is touched.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One upstream path** — `/v1/chat/completions`, matching the one operation the transport carries. A second operation needs its own path mapping rather than a caller-supplied one.
- **No audit record** — the design calls for one on every company model allow and deny; the record needs the correlation and the device this endpoint already has, and adding it is a small change this one did not make.
- **No content-log suppression beyond not logging** — the endpoint writes nothing about a body, but it does not configure the surrounding process, and a deployment that enabled request logging elsewhere would defeat that.
- **The response is streamed but not bounded** — a provider that never stops sending is cut off by `upstreamTimeoutMs` rather than by a byte limit.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests run a real HTTP provider that records what arrived, because the two facts worth proving are about the bytes it receives — that the credential is attached and that the model field is the catalog's — and a mock would only report whatever the test told it to expect.

</details>
