# Agent Note: the first request uses the model the composer names

Status: implemented

English | [中文](2026-09-05-the-first-request-uses-the-model-the-composer-names.zh.md)

## Problem

A member of the Team Runner opened a blank conversation, read `Welinkin Model · High` in the composer's model seat, sent a message, and watched the turn fail with `API 密钥无效` while the seat now read `built-in/test-Qwen`. The request had gone to a model the member could not see and had not chosen.

Two readers of one deployment default disagreed. Since [the default follows the picker](../feature/2026-08-07-default-model-follows-the-picker.md), every accepted `session.selectModel` writes the picked model into the machine-wide `agent-default-model` settings section, so a machine on which someone once picked `test-Qwen` keeps naming it for every later blank Session and for every member who signs in there afterwards. The company route lists only what the signed-in member's roles grant, and when that catalog stops listing the stored default the composer names the first model it does list. `session.prompt`, though, read the stored default straight from `ctx.agentDefaultModel` and sent the request there; the Control Plane refused the ungranted model with `403 unknown-model`, which the adapter classifies as `AUTH` and the client words as an invalid key.

## Decision

**`session.prompt` binds a Session that has no selection of its own to the default the catalog offers.** `ApiSessionAgentController.settleDefaultSelection` runs before the route check: while a Session has neither a picked selection nor a logged `request/header`, it builds the same `ModelCatalog` the composer reads and installs its `default` as the value the default tier returns. That default is the deployment default whenever the catalog lists it, and only otherwise the first listed model, so the request uses exactly the model the seat names. The binding is re-read on every prompt until a request is logged, so a catalog or a stored default that moved between prompts reaches the Session, and it is process-local: `request/header` records what was used, which is the fact the log needs.

**A selection already made is not touched.** A picked selection or a logged header keeps its tier and its advisory-membership posture: a route may serve a model it has stopped advertising, and a member who chose it gets it. `session.prompt` still refuses with `model-unavailable` when no adapter serves the bound provider; that refusal now names a route the Session is bound to, never the deployment's stored default alone.

**What `selectModel` saves does not change.** The machine-wide section still follows the picker; a member whose roles cannot reach the model it names is served the catalog's default instead of being refused.

## Alternatives considered

**Make the client submit the substituted default through `selectModel` before its first prompt.** Rejected: `session.prompt` is the enforcement boundary the [default-follows-the-picker decision](../feature/2026-08-07-default-model-follows-the-picker.md) names, a client-side pin would race the prompt it precedes, and every other client would need the same pin. It would also save the substitution as the machine's default through `saveSelection`, turning a per-member catalog fact into a machine-wide preference.

**Record the binding as a `model/selection` event.** Rejected: that event is the log of a selection someone made for this Session, and it becomes `pending` in the projection, which the composer then presents as the member's own pick. The binding is what the Session falls back to, not a choice; `request/header` already records what was used.

**Resolve the catalog default inside the default tier of `selectionFor`.** Rejected: `installModelSelection` reads that tier synchronously at prompt assembly, and the catalog is an asynchronous read that reaches the Control Plane. Binding at `session.prompt` keeps the tier synchronous and the round trip at the one place a prompt is admitted.

**Save the deployment default per member instead of per machine.** Not done here: an administrator can still withdraw a grant after the member picked the model, so the request-time binding is needed either way. Keying the stored default by member remains open.

## Consequences

Every member signing in on any machine is offered the built-in models their roles grant, and the first request of a blank Session goes to the model the composer names. A stored default that a later member cannot discover no longer produces a refusal read as a key failure. The blank Session's first prompt pays one catalog build, on the company route one `GET /team/api/models` round trip, which the composer's own load already pays; a Session with a logged request pays nothing.

Direct entry points that bypass `session.prompt` (the SDK server, ACP, the webhook) keep reading the stored default, as they have no composer to agree with. The adapter still classifies a Control Plane `403 refused` as `AUTH`, so a grant withdrawn after a selection was made still reads as an invalid key; that wording is a separate defect.

The session-models Host tests pin the binding on an unlisted default, the live default while it is listed, a picked and a logged selection the catalog omits, and the refusal of a logged route no adapter serves. No keyless recorded-session scenario carries a stored default outside the replayed catalog, so the snapshots are unchanged.
