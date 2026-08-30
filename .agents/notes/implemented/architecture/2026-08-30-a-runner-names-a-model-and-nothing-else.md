# Agent Note: a Runner names a model and nothing else

Status: implemented

English | [中文](2026-08-30-a-runner-names-a-model-and-nothing-else.zh.md)

## Problem

Company models are the reason the Control Plane holds credentials at all, and the credential must never reach the member's computer — a plugin sharing the Runner's process would otherwise be able to read a key that bills the whole organization.

The obvious shape is a proxy that forwards whatever the Runner sends and attaches the credential on the way out. It fails in a way that is easy to miss: if the Runner supplies any part of *where* the call goes, the credential goes there too. A URL, a host, a path override, a proxy setting, an upstream `Authorization` header — each is a way to point a company credential at somewhere the company did not choose.

There is a second version of the same problem inside the body. A Runner authorized for a cheap model can write an expensive model's name in the request body, and a proxy that forwards the body unchanged will faithfully bill the organization for the model nobody authorized.

## Decision

**A Runner names a model, and supplies nothing about where the call goes.** The endpoint, the upstream model name, and the credential reference all come from the catalog. There is nowhere in the request for a Runner to put an address, so there is nothing to strip and nothing to validate — those facts are simply not part of what a Runner sends.

That is what makes the credential isolation structural. It is not enforced by removing dangerous fields; the fields do not exist.

**The gateway overwrites the two body fields that decide what the call costs.** `model` becomes the catalog's upstream name, so a Runner that named one model and wrote another in the body reaches the one it was authorized for. `max_tokens` or `max_completion_tokens` is bounded by the reserved ceiling *when the body already carries one* — adding a limit the adapter did not send would change a request it meant to make.

Nothing else is touched. The Runner sends the body its own LLM adapter built, because reimplementing every provider's request format in the Control Plane would be a second adapter to keep correct, and the two would drift.

**The catalog holds a credential reference, never a credential.** The secret lives in the credential provider and is resolved at the moment of the call, so rotation changes nothing in the catalog and reading the catalog yields nothing anyone could spend.

**The stable ref is the identity.** `modelRef` is what a Runner asks for and what a grant names, and it never moves; the provider's own name lives beside it and may change under it. A provider renaming a model upstream changes a column rather than every grant.

**Registering a model governs it, in the same call.** A catalog entry access control does not know about is a model no grant can name and nobody can ever invoke, and an administrator who added one would have to know to do a second thing elsewhere for the first to mean anything. Retiring moves both, so a withdrawn model is refused whichever entry point a request arrives at.

**Three decisions, in this order.** Is there such a model — with absent and ungranted answered alike, so a refusal never tells a member which models an organization has. May this principal invoke it — asked on every invocation against the current policy revision, so a role change takes effect on the next request rather than when a token expires. Is there budget — last, so a refused request holds no reservation.

**The catalog's ceiling wins over the Runner's ask.** A Runner asking for more output than the model is configured to produce gets the configured amount, and the reservation is taken against that. A smaller ask is honoured, so a short request does not hold a long request's budget.

## Alternatives considered

**Forwarding the Runner's request unchanged and attaching a credential.** Rejected as described: the credential follows wherever the request points, and every field that could point it somewhere becomes a thing to remember to strip.

**Rebuilding the provider request in the Control Plane.** Rejected: it duplicates every adapter the harness already has — serialization, streaming, image and file semantics — in a second place that must stay in step with the first. Overwriting the two fields that decide which model and how much output is the smallest intervention that makes the authorization mean something.

**Validating the body against an allowlist of fields.** Rejected: a provider adds features faster than an allowlist can, and a gateway that dropped an unknown field would break a request the adapter meant to make. The fields that matter for authorization and cost are known and few; the rest is the adapter's business.

**Caching the authorization in the access token.** Rejected: a token outlives a role change, and a member removed from a role would keep invoking until it expired. Asking per invocation costs one lookup and makes revocation immediate.

**Letting a Runner pass its own maximum output.** Kept, but bounded. Honouring a smaller ask is useful — a short request should not hold a long request's budget — while a larger one is exactly the case the catalog ceiling exists for.

## Consequences

Nothing in these packages calls a provider. `authorize` produces a plan and `settle` closes it; performing the HTTP call, resolving the credential reference, counting input tokens, and streaming the response belong to the transport in front of it. That transport is where "the content of a company model call passes through the Control Plane" becomes true, and where the buffering and content-logging limits the design requires have to live.

`inputTokens` is supplied by the caller, so the gateway reserves against what it is told. A caller that under-reports would under-reserve. Counting belongs in the transport, where the body is already parsed.

`model` is the field name in the OpenAI-compatible request shape, which is the only format this build proxies. A provider that names it differently needs its own entry rather than a guess, and the constant is exported so a second format is an addition rather than an edit.

The catalog carries an output ceiling and no price, so the ledger counts tokens rather than money. Weighting by price needs rate metadata here, and adding it later changes what a settlement means without changing when one happens.
