---
description: "The team transport: a company model request going out through the Control Plane, with no address and no credential of its own."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-http-transport-team

English | [中文](README.zh.md)

## Summary

`dsh-llm-http-transport-team` is how a company model request leaves a member's computer. It sends an operation, a model ref, and the body an adapter built. What it does not send — and could not, because the request has no place for it — is an address or an upstream credential, so the company key stays where a plugin sharing this process cannot reach it.

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
  '@deepseek-ai/dsh-llm-http-transport-team':
    controlPlaneUrl: https://dsh.company.com
```

It injects `teamAccountClient`, so this computer must be bound before a company model call can leave it. A call made from an unbound computer fails with `not-bound`, which is a different thing to tell a member than `refused`: one is "connect this computer", the other is "ask an administrator".

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The access token is read per call

The account client refreshes it, so a cached copy here would be the stale one. That is the same reason the credential itself never comes to this computer at all.

### The budget period is the UTC month

Two members in different time zones spend the same organization's month. A month rather than a configurable window because the ledger only needs both sides to name periods the same way.

### The answer is streamed, not buffered

An adapter parses a completion as it arrives, and holding one here would undo that. A provider refusal is passed through with its status rather than translated: the adapter that built the request is the one that can read the answer.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The transport, the token read, and the period |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`llm-http-transport`](../llm-http-transport/README.md) — the seam this implements.
- [`model-gateway-http`](../model-gateway-http/README.md) — the endpoint it calls.
- [`team-account-client`](../../team/team-account-client/README.md) — where the access token comes from.

<a id="model-experience"></a>
## Model Experience

None, as the transport carries a request an adapter built and registers no prompt section, tool, or request context.

#### KV Cache effect

The transport does not change the bytes an adapter built, so it has no request prefix of its own. The Control Plane overwrites the model field before the call goes upstream, which is where a cache effect would come from.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **The period is not configurable** — a deployment billing on something other than a UTC month needs both sides changed, not just this one.
- **No retry** — a `TransportFailedError` is reported rather than retried, because whether to retry depends on the agent step, which `llm-retry` owns.
- **No streaming request bodies** — the body is serialized in full before the call, which is what every provider format this build carries expects.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests assert what leaves the Runner by reading the recorded request, including that the wire carries no `http`, no endpoint, and no key. That assertion is the package's whole reason to exist, and it would pass vacuously against a mock that never saw a real request.

</details>
