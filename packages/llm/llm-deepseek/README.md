---
description: "The DeepSeek chat-completions adapter for users and maintainers configuring the deepseek-official route, thinking, and image input."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-deepseek

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-llm-deepseek` is the DeepSeek chat-completions adapter for the harness LLM service: it owns the member-configured `deepseek-official` provider route and translates DeepSeek's wire format into the harness stream-chunk protocol. That route is registered only while its API-key reference resolves, so a keyless composition advertises no DeepSeek models and the route appears the moment a key is stored. Without an LLM HTTP transport it calls the configured provider directly. With one mounted, it also owns a `built-in` route whose model discovery and chat invocation use that transport, which is how the Team Runner keeps the company endpoint, credential, and model authorization on the Control Plane without replacing the member's DeepSeek route. It is one of two structurally different adapters for DeepSeek: the pi-ai twin serves its own route names through a library and additional providers, and both can be mounted side by side.

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

Mount this plugin when a composition streams DeepSeek models through the harness LLM service. It declares the `deepseek-official` route as configurable at load, registers it while its API key resolves, and resolves connection facts per request, so a composition entry plus an optional user settings section drive the whole adapter.

### When to choose it

Choose this adapter when the deployment targets DeepSeek's official API, optionally behind an OpenAI-compatible gateway named by `baseURL`. Choose `dsh-llm-pi-ai` when the same composition also routes other providers or hand-declared gateways through pi-ai's catalogs; the two adapters can be mounted together because their route names do not collide. Registering any other adapter for `deepseek-official` fails with `DUPLICATE_ADAPTER`.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY  # credential reference, resolved per request
    baseURL: https://api.deepseek.com # optional; $DEEPSEEK_BASE_URL then this default
    reasoningEffort: high        # optional; off | low | high | max
    maxTokens: 256000            # optional per-request output cap
    maxRequestFilesBytes: 134217728
    maxInlineRequestImageBytes: 20971520
    maxImagesPerRequest: 600
    filesApiTimeoutMs: 60000
```

A request selects the route with `provider: deepseek-official`; the model id passes through to the wire, so new DeepSeek models need no re-registration. Omitted `models` advertises the text- and image-capable `deepseek-flash` and `deepseek-v4-flash-vision-exp` alongside the text-only `deepseek-v4-flash` and `deepseek-v4-pro`, each with a 1,000,000-token context window. An explicit list replaces those defaults, and unlisted model ids still pass through as text-only routes. Clients, including model discovery tools, can read the advisory entries through `ctx.llm.listModels('deepseek-official')`. Image-capable entries may set `imagePixelBudget` to a positive integer or `low`, and may set `imageMaxBytes`.

When `ctx.llmHttpTransport` is present, its `listModels()` supplies the `built-in` route and each serialized request selected through that route goes through its `send()` method. The `deepseek-official` route keeps its local advisory list and configured API key, and is absent while that key is unconfigured. A Team transport supplies the role-filtered built-in catalog and routes those invocations through the Control Plane gateway under the Runner's current device access token. On that route the transport's catalog, not the local `models` list, says what each model accepts: an entry declaring `image` takes images, serialized inline as base64 under `maxInlineRequestImageBytes` rather than through the Files API, which needs a key the Runner does not hold; an entry without it refuses them before anything leaves the Runner. The catalog is re-read on every model resolution, so an administrator's change reaches the next request, and the last listing prices images for the token meter.

| Field | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference resolved per request through the credentials seam, then the environment |
| `baseURL` | `https://api.deepseek.com` | Endpoint base; `$DEEPSEEK_BASE_URL` wins when set |
| `thinking` | `enabled` | Deployment policy; `disabled` locks every request to `off` |
| `reasoningEffort` | `high` | Default effort: `off`, `low`, `high`, or `max` |
| `maxTokens` | `256,000` | Per-request output cap; a model's own cap and explicit request values win |
| `defaultContextWindow` | `1,000,000` | Capacity fallback for models without an exact value |
| `models` | V41 Flash + V4 Flash + V4 Pro + V4 Flash Vision Exp | Advisory catalog shown by discovery consumers |
| `streamIdleTimeoutMs` | `300,000` | Maximum provider idle time per outstanding stream read |
| `maxRequestFilesBytes` | `128 MiB` | High watermark for retained request-image bytes before oldest-first offload |
| `maxInlineRequestImageBytes` | `20 MiB` | Independent base64 fallback high watermark |
| `maxImagesPerRequest` | `600` | High watermark for retained request-image count |
| `imageOffloadByteQuantum` | `64 MiB` | Files-mode oldest-prefix removal quantum |
| `inlineImageOffloadByteQuantum` | `10 MiB` | Inline-mode oldest-prefix removal quantum |
| `imageOffloadCountQuantum` | `20` | Count-overflow removal quantum |
| `filesApiTimeoutMs` | `60,000` | Per-image Files resolution deadline |
| `fileExpiresAfterSeconds` | `604,800` | Requested uploaded-image lifetime |
| `fileRefreshMarginSeconds` | `3,600` | Remaining lifetime below which an id is replaced |
| `fileQuotaCleanupBatch` | `100` | Oldest harness-owned files removed before one quota retry |
| `retryPolicy` | normal, 5 retries | Provider-owned retry policy executed by `dsh-llm-retry` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-llm-deepseek) is the exhaustive source for every accepted field and its JSDoc.

### Streaming with thinking and images

An image-capable route resolves each durable reference into a deterministic request version under its pixel and byte budgets. `imagePixelBudget` accepts a positive integer or `low`; omission uses 640,000 total pixels, `low` uses 512×512 total pixels, and `imageMaxBytes` defaults to 1 MiB. Alpha images use WebP effort 0 and opaque images use JPEG on the 85/75/60 quality ladder, keeping the smallest output when every candidate exceeds the target. Every retained image is preceded by text naming its complete attachment id and actual request dimensions. When the current filesystem maps the attachment provider's host object, that text also carries a read-only execution-world path and the extension for a writable copy. Text-only and unlisted routes receive stable attachment placeholders while durable history keeps the image references.

The adapter normally uploads those exact request bytes through the DeepSeek Files API and sends file-id blocks. A failed or timed-out file resolution rebuilds the whole chat request with the same request versions as base64 data URLs; one request never mixes file ids and inline images. Cached ids are scoped by endpoint and API key, refreshed before expiry, invalidated from provider stale-file errors, and resolved through singleflight with waiter-local cancellation. Quota failure deletes one configured batch of the oldest harness-owned files before one upload retry.

Files mode bounds retained request versions by `maxRequestFilesBytes` and `maxImagesPerRequest`; inline fallback has its own base64 budget. Both remove an oldest prefix in configured byte or count quanta. Each omitted image gets its own model-visible placeholder with its display name or attachment id and, when available, normalized dimensions, media type, and current read-only path. The stepped high-watermark policy avoids rewriting an old request prefix after every new image.

`reasoningEffort` selects the advertised default. Exact-model metadata exposes ordered `off`, `low`, `high`, and `max` efforts with selection guidance when deployment policy permits thinking. `low`, `high`, and `max` enable thinking and serialize as `reasoning_effort`, while adapter-owned `off` sends `thinking.type: disabled` instead. An unsupported value fails with `UNSUPPORTED_REASONING_EFFORT` before network I/O, and `thinking: disabled` rejects any non-`off` effort at plugin load. Requests with `purpose: 'session-title'` force thinking off to reserve output for visible title text.

### Dynamic configuration

Connection facts are re-read once per operation through the optional settings and credentials seams. A `llm-deepseek:` section in the user settings document overrides any field without a restart; a snapshot that fails a beyond-schema bound keeps the last good facts and logs the failure. For a `deepseek-official` request, the API key resolves per stream call from the same snapshot that supplies the endpoint, image and Files policies, and idle budget. The route's registration follows the same reference: the plugin re-judges it on every `credentials/reference-updated` commit for that reference, on a settings change, and when the credentials seam attaches or detaches; without the seam the launching environment alone decides, and only at load, because environment changes are not observable. A `built-in` request uses the mounted transport instead, so it resolves no local provider key; if that transport is unavailable, the route fails instead of falling back to the member endpoint. Image requests resolve the attachment service at request time, so load order does not freeze image availability.

### Provider-specific request fields

When `ctx.deepseekLlmApiExtensions` is present, the adapter prepares its registered top-level fields from the exact serialized base request before the HTTP call. Preparation or field collisions fail before HTTP; after a 2xx response, the adapter accepts every captured contribution before consuming SSE. Transport and non-2xx failures do not accept them. Shipped compositions use this for the optional incremental `dsh_session_log` field and the default-on active `dsh_plugin_packages` inventory; both stay outside model input.

### Failures and recovery

Non-2xx responses fail with stable codes: `AUTH` (401/403), `QUOTA`, `RATE_LIMIT`, `CONTEXT_WINDOW_EXCEEDED`, `INVALID_REQUEST`, `SERVER`, and `HTTP_<status>` otherwise; pre-response transport failures throw `TRANSPORT`, caller aborts throw `ABORTED`, and stream-idle expiry throws `TIMEOUT`. Request-extension preparation, field collision, or post-2xx acceptance fails with `REQUEST_EXTENSION`. A normalized-image rejection names every plausible attachment and its durable position when the provider does not identify a file id. Stale-file rejection invalidates the named mappings (or every mapping used by the attempt) and permits one replacement chat attempt. Protocol violations throw `STREAM_CLOSED` or `MALFORMED_RESPONSE`, and a terminal `stop` with no content blocks becomes `EMPTY_RESPONSE`, which the default retry policy retries. A request selecting the dormant member route fails with `NO_ADAPTER` naming the `llm-deepseek` settings section, a request whose key vanished after registration fails with `MISSING_CREDENTIAL`, and a malformed credential fails with `INVALID_CREDENTIAL` naming the reference to fix — never any part of the key.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design behind the adapter; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The plugin is built on one explicit resolve step and two registration facts. `resolveAdapterOptions()` is the single path from raw config to validated connection facts, and the adapter re-reads those facts through a thunk once per operation — base URL, catalog, request defaults, image and Files policies, and idle budget all take effect on the next request, while an in-flight stream keeps the facts it started with. The facts captured at registration are the route set and the retry policy: when either changes — a key stored or removed, a transport mounted, a policy edited — the plugin re-registers in place, in one synchronous registry section, so no request observes a gap. A first registration waits for some route to be on, and a later empty set keeps that registration alive through the dormant stretch.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, per-request resolution, settings and credential wiring |
| [`src/adapter.ts`](src/adapter.ts) | The `DeepSeekAdapter`: model resolution, image projection, Files fallback, streaming with idle timeout |
| [`src/file-store.ts`](src/file-store.ts) + [`src/files-api.ts`](src/files-api.ts) | Scoped upload caching, expiry, stale-id recovery, quota cleanup, and remote file operations |
| [`src/serialize.ts`](src/serialize.ts) | Wire serialization: thinking defaults, Files or inline image blocks, history rules |
| [`src/sse.ts`](src/sse.ts) | `eventsource-parser` framing for a direct or transported SSE response |
| [`src/translate.ts`](src/translate.ts) | SSE payload translation into harness `StreamChunk` values; tool-call `id` and `name` are identity, so a continuation delta repeating them empty or null leaves the established value alone |
| [`src/types.ts`](src/types.ts) | Wire-level types shared by the modules above |

### Wire flow

One `stream()` call serializes one chat request, prepares any registered top-level request extensions, and either fetches from the resolved `baseURL` or asks the mounted transport to carry the model ref and body. A direct image request resolves deterministic request versions and prefers Files ids; file-resolution failure makes the first chat inline, and a provider stale-file response permits one replacement attempt. The adapter accepts extension transactions after HTTP 2xx and translates either response SSE stream into the harness protocol. Reasoning history is serialized back when required, and cache accounting maps DeepSeek's cache-hit metrics into harness usage.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the service contract to the twin adapter, the retry executor, and the shared types.

- [dsh-llm service](../llm/README.md) — the provider-neutral service this adapter registers on.
- [llm-pi-ai adapter](../llm-pi-ai/README.md) — the library-backed twin serving other providers and gateways.
- [LLM streaming subsystem](../../../docs/subsystems/llm-streaming.md) — the `StreamChunk` protocol and adapter contract.
- [llm-retry](../llm-retry/README.md) — the retry executor that applies this adapter's `retryPolicy`.
- [DeepSeek request extensions](../deepseek-llm-api-extensions/README.md) — lifecycle and acceptance semantics for provider-specific top-level fields.
- [Session-log upload](../../session/session-log-deepseek/README.md) — the opt-in incremental `dsh_session_log` contribution.
- [Plugin package inventory](../plugin-package-inventory-deepseek/README.md) — the default-on `dsh_plugin_packages` contribution.
- [Twin LLM adapters](../../../.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md) — why DeepSeek ships two structurally different adapters.
- [Mandatory app attribution headers](../../../.agents/notes/implemented/architecture/2026-06-21-mandatory-app-attribution-headers.md) — the identity every provider request carries.

-----

<a id="model-experience"></a>
## Model Experience

### DeepSeek request

#### What the model sees

The selected DeepSeek model receives the harness system prompt, message history, tool schemas, stop sequences, and call config (`maxTokens`, `reasoningEffort`, `temperature`) without adapter-authored prompt prose. Provider-specific request-extension fields remain outside model input. The vision model normally receives retained user and tool-result images as Files API references beside attachment handles and request-preview dimensions. It also receives a normalized-object path when the current execution filesystem maps the attachment provider's host object; the descriptor marks this copy read-only and warns that normalization may have resized or re-encoded the upload. A Files resolution failure sends all retained images as inline data URLs instead, and an over-budget older image keeps the access resolved for that request in its placeholder. Reasoning content from a prior assistant turn is passed back verbatim, whether or not that turn called a tool.

#### Token effect

Provider tokenization governs exact text and image-token input. The adapter declares per-route `imageRequestPricing`: it reproduces oldest-first image offload from durable byte lengths and prices each retained image at its projected dimensions with the published v4 vision accounting (14px patch grid, 3:1 downsampling, 384-token cap, worst-case alignment pad). This lets the token meter price image pressure before a request; reported usage remains authoritative. Reasoning passback carries every reasoned turn's chain of thought into later requests, while dropping over-budget images avoids paying those tokens again. Cache-read usage is reported when available. `totalTokens` is the exact `prompt_tokens + completion_tokens` aggregate and is omitted if a supplied `total_tokens` disagrees.

#### KV Cache effect

An unchanged assembled prefix is eligible for DeepSeek cache reuse, which this adapter reports in usage. Deterministic request-image bytes do not make the full prefix immutable: a changed execution-world path rewrites historical descriptor text, a refreshed upload can replace a `file_id`, and Files-to-base64 fallback changes the image representation. Any of these, or a model-route, prompt, schema, history, or image-budget change, may prevent reuse from the first affected token; reasoning passback appends on every reasoned turn.

### DeepSeek response

#### What the model sees

Reasoning, text, and raw-string tool arguments are translated into harness chunks for the loop to log and assemble.

#### Token effect

Generated tokens follow the request's logged reasoning effort and `maxTokens`; only loop-retained blocks affect later input.

#### KV Cache effect

Loop-retained response blocks append to the next request and preserve its earlier reusable prefix; dropped blocks have no later cache effect. Changing the provider or model selects a different cache domain.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where the adapter stops and future work begins. They are current package constraints, not a general DeepSeek comparison or a task backlog.

- **A settings `models` list replaces the composition list wholesale** — settings-layer merging is per-field, and arrays are one field; per-entry catalog merging would need a keyed shape.
- **An ambient-only key is judged at load** — process-environment changes are not observable, so a key exported after boot activates the route only on the next settings change or credentials-seam attach; the managed credential store is the live path.
- **`tool_choice` is not mapped** — not part of the core vocabulary (shared with the pi-ai twin).
- **Direct requests use raw `fetch`, not `@cordisjs/plugin-http`** — no shared proxy or interception configuration; Team requests use the mounted transport.
- **Plugin-added content block types are skipped** — core text and supported image blocks are serialized, and empty tool output crosses the wire as the literal `(no output)`.
- **Images are input-only durable attachments** — direct external URLs and assistant image output are not supported; DeepSeek input normally uses the Files API and uses inline base64 only for per-request recovery.
- **Mounted transports are text-only** — the transport request has no DeepSeek Files API upload operation, so an image request is refused before credential or network access.
- The default catalog pre-registers `deepseek-flash` and its text/image capabilities without probing gateway availability; the shipped default model stays `deepseek-v4-flash` until the gateway enables the id. Requests can fail with `INVALID_REQUEST` until then. With `DEEPSEEK_API_KEY` and a supporting gateway configured, `DEEPSEEK_FLASH_E2E=1` enables the Chat Completions check in [this package's e2e suite](tests/adapter.e2e.ts).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is non-authoritative working context: undecided directions and notes for maintainers. Shipped behavior and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

- OpenRouter-specific app attribution headers are deferred to a future explicit OpenRouter adapter or mode; OpenAI-compatible gateway requests carry only the shared attribution baseline.
- The `off` reasoning effort never crosses the wire as `reasoning_effort: 'off'`; it serializes as `thinking: { type: 'disabled' }` and omits the field, which keeps the wire spelling valid for gateways that reject unknown effort values.

</details>

**Runtime invariant:** No companion is published. This package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam.
