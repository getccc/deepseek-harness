# Agent Note: Control Plane calls stay on HTTP/1.1

Status: implemented

English | [中文](2026-09-15-control-plane-calls-stay-on-http1.zh.md)

## Problem

A packaged WeWork Runner answered every new turn with `transport failed: unreachable (fetch failed)` and showed the raw default model id instead of the company catalog, while web-search calls from the same process kept succeeding. The Control Plane's access log showed model calls from that Runner until one streamed invoke ended with `499` (the client cancelled it), and none after. Undici diagnostics captured inside the running Runner showed every catalog request failing at once with `ERR_HTTP2_INVALID_SESSION: The session has been destroyed`. Undici 8 negotiates HTTP/2 by default, and after that cancelled stream the model transport's pinned-trust agent kept the destroyed session pooled, so each later call reused it. Only a Runner restart replaced the agent; the web-search client has its own agent and was unaffected.

## Decision

`controlPlaneFetch` constructs its pinned-trust agents — the direct `Agent` and the per-proxy `ProxyAgent` — with `allowH2: false`. Control Plane calls from the account client, the model transport, knowledge, and web search then use HTTP/1.1 connection pools, which discard a closed socket and open a new one. Streaming responses are unaffected, because the Control Plane streams server-sent events over HTTP/1.1 as well.

## Alternatives considered

- **Recreate the agent after an unreachable failure.** Rejected as the fix: the failed call is still lost, the rule would need care to avoid discarding healthy pools on real network outages, and the root cause would remain in every other call path.
- **Disable HTTP/2 on the process-wide dispatcher.** Rejected here: that dispatcher serves every outbound request, the failure was observed only on the pinned Control Plane agents, and a deployment change of that reach needs its own evidence.

## Consequences

A Control Plane call opens more TCP connections than HTTP/2 multiplexing would under concurrent streams; the Control Plane's nginx front already accepts HTTP/1.1. A deployment without `controlPlaneCa` still rides the process-wide dispatcher, which allows HTTP/2. `transport.spec.ts` pins `allowH2: false` on the direct and the proxied agent.
