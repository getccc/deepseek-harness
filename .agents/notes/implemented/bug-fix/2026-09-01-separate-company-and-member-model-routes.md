# Agent Note: separate company and member model routes

Status: implemented

English | [中文](2026-09-01-separate-company-and-member-model-routes.zh.md)

## Problem

The Team transport supplied the model catalog for `deepseek-official`, replacing the adapter's configured DeepSeek catalog. A Control Plane model such as `testModel` therefore appeared under the DeepSeek heading, and a member who stored a DeepSeek API key could not see or select the models that key served.

The provider id also chooses the invocation path. Moving rows only in the browser would make the headings look correct while both groups still submitted `deepseek-official`, leaving the runtime unable to decide whether to use the member credential or the company transport.

## Decision

**Company and member models use different provider routes.** `deepseek-official` keeps the member-configured catalog, endpoint, and credential. When an LLM HTTP transport is mounted, the same DeepSeek protocol adapter also registers `built-in`; that route reads the transport catalog and sends invocation through the transport without resolving the member's DeepSeek key. The Team profile waits for the transport before loading the adapter and uses `built-in` as its default provider.

**The model catalog carries an optional product category.** The LLM registry preserves `category: 'built-in'` in provider metadata, and `session/modelCatalog` projects it into the provider group. Browser clients localize the category heading while provider and model ids remain the selection identity. Ordinary providers continue to render the adapter-owned name.

**Only member routes are configurable.** The configurable-provider directory continues to expose `deepseek-official` and its Models settings card. `built-in` is supplied by deployment policy and never appears as a credential-bearing provider a member can edit.

**A missing company transport fails closed.** Catalog and invocation requests for `built-in` fail with `TRANSPORT` when the mounted transport is unavailable. They never fall back to the member endpoint or resolve the member's DeepSeek key.

This route split complements the existing decisions that [a Runner names a model and nothing else](../architecture/2026-08-30-a-runner-names-a-model-and-nothing-else.md) and that [Control Plane policy governs the resident Runner](../architecture/2026-08-31-control-plane-policy-governs-the-resident-runner.md). Those notes retain independent authority over request isolation, authorization, and policy ownership.

## Alternatives considered

**Regroup only in the browser.** Rejected because provider ids drive invocation. Two visual groups submitting the same provider id cannot select two different credential and transport paths.

**Merge both catalogs under DeepSeek.** Rejected because a company model is not evidence that DeepSeek serves it, and a merged route cannot decide whether an arbitrary model id should use the member credential or the company transport.

**Create a second protocol adapter package for company models.** Rejected because the company request intentionally reuses the Runner's provider serialization and response parsing. A route-specific transport choice preserves one protocol implementation without conflating route ownership.

## Consequences

The model selector and Subagent authorization card can show `DeepSeek` and the locale-owned `Built-in Models` or `内置模型` headings at the same time. A member's DeepSeek settings continue to affect `deepseek-official`, while Control Plane discovery updates only `built-in`.

Persisted company selections use provider `built-in`. This pre-release change does not infer whether an old `deepseek-official` model id belonged to the member or the company; an existing ambiguous selection must be selected again.

The shared provider and catalog types gain one optional literal category. Consumers that do not render headings may ignore it, while presentation clients can localize built-in groups without matching a provider name.
