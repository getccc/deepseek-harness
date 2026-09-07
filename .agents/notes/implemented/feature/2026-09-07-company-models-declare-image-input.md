# Agent Note: company models declare image input

Status: implemented

English | [中文](2026-09-07-company-models-declare-image-input.zh.md)

## Problem

On 2026-09-07 the AMEC Control Plane's `AMEC Model` entry was switched to the upstream `deepseek-v4-flash-vision-exp`, and every member Runner still refused an image on the `built-in` route. Two gates refused it, and neither could read the catalog. The composer gate in `session-controller` asks the LLM service for the selected model's `inputModalities`, and the DeepSeek adapter answered that question from its local `models` list for every route, `built-in` included; the Control Plane catalog carried no modality field, so a company model was text-only unless each Runner's own profile declared otherwise, and that declaration sat under the settings user layer, which replaces arrays wholesale. Behind that gate the adapter refused any image-bearing request over a transport outright, because its image path uploads through the DeepSeek Files API with the member's own key and a transport route holds none.

## Decision

**The catalog declares what a request may carry.** `ModelEntry` and `RegisterModel` in [`model-gateway`](../../../../packages/llm/model-gateway/src/types.ts) carry `inputModalities`, a non-empty list drawn from `MODEL_INPUT_MODALITIES` (`text`, `image`). The list is owned by [`llm-http-transport`](../../../../packages/llm/llm-http-transport/src/vocabulary.ts) and re-exported by the gateway, because the value crosses that seam from the catalog to an adapter and both sides must name one closed set. `discover` returns it with the ref and the display name, `/team/model/catalog` publishes it, and the Team transport refuses at the wire a catalog whose list is missing, empty, or names a word this Runner does not carry.

**SQLite stores it as a JSON array at schema version 2.** [`model-gateway-sqlite`](../../../../packages/llm/model-gateway-sqlite/src/schema.ts) adds `input_modalities TEXT NOT NULL` with a CHECK for a valid, non-empty JSON array, and `applySchema` refuses a file at any `user_version` other than 0 or 2. The pre-release stance rejects old on-disk formats rather than migrating them, so a deployment on version 1 recreates the catalog and registers its models again.

**The administration API defaults an omitted list to `text`.** `POST /models` in [`team-admin-api`](../../../../packages/team/team-admin-api/src/index.ts) reads an optional `inputModalities`; absent means `text`, and an empty, repetitive, or unknown list answers 400 with reason `modalities`. `WireModel` carries the list, and the console's model form gains one checkbox, 接受图片输入, which becomes `['text', 'image']` or `['text']`; the table marks image-capable rows with a tag.

**A transport route takes its model facts from the transport catalog and sends images inline.** [`DeepSeekAdapter`](../../../../packages/llm/llm-deepseek/src/adapter.ts) resolves a route's catalog entry through `remoteCatalog`: a route with a transport that owns discovery re-reads `listModels()` on every `resolveModel`, `prepareCall`, and `stream`, so an administrator's change reaches the next request rather than the next restart, and the last listing is remembered only for the synchronous `imageRequestPricing` path, which cannot wait for one. `modelInfoFor`, the image gate in `streamWithConnection`, and the request serializer all read that one entry. A transport route never holds a key, so `request` serializes every image as a base64 `image_url` under `maxInlineRequestImageBytes` and never enters the Files API branch; the refusal that named "Files API image references" is gone, and a company model whose entry lacks `image` is refused with the same `UNSUPPORTED_CONTENT` message a direct route's text-only model gets. Image budgets for a remote entry are the adapter's defaults, because the catalog carries no per-model image policy.

**The Control Plane reads 32 MiB bodies by default.** [`model-gateway-http`](../../../../packages/llm/model-gateway-http/src/index.ts) raises `maxRequestBodyBytes` from 4 MiB to 32 MiB, and the `team-control-plane` bundle writes the same value: inline images make the adapter's 20 MiB inline budget, after base64 encoding, the size of a request the endpoint must accept.

## Alternatives considered

**Declare modalities in each Runner's profile catalog.** This is what the interim workaround did on the dev Mac, and it failed twice: the settings user layer's `llm-deepseek.models: []` replaced the profile's list wholesale, and a declaration per machine cannot follow a change an administrator makes on the Control Plane. Rejected.

**Carry Files API uploads through the Control Plane.** A proxied files endpoint would keep the adapter's preferred representation, but it needs a file ownership mapping across members under one company key, which the gateway README lists as deliberately absent. Deferred; inline base64 needs nothing the gateway does not already carry.

**Migrate schema version 1 to 2 with `ALTER TABLE`.** Rejected under the pre-release stance: backends reject old on-disk formats until the first tagged release, and the catalog is small enough to recreate.

**Cache the remote catalog with a time-to-live.** Rejected: the interval would be a hidden tunable, and a stale entry would let an image through to a model an administrator had just switched away from. One catalog read per model resolution is the cost of reading the current declaration.

**A separate modality vocabulary in `model-gateway`.** Rejected: two lists for one wire value would drift, and the transport seam already owns the closed operation list both sides read.

## Consequences

Every model resolution on a transport route costs one `GET /team/model/catalog`: once per prepared call and once more when a message carries an image. The catalog is a per-row access-control decision over a handful of models, and the same Runner already lists it whenever the composer opens.

The AMEC deployment recreates `models.sqlite`, registers its two models again, and marks `AMEC Model` as accepting images; the packaged administration console gains the checkbox on its next build. Image token estimates on the `built-in` route come from the last listing, so a route that has never listed prices an image as text until the first prepared call.

Unit suites cover the catalog column and version refusal, the endpoint's catalog body, the transport's wire validation, the administration API's default and refusals, and the adapter's remote resolution, inline serialization, refusal, and pricing. No keyless recorded-session snapshot covers the Team transport, because the snapshot harness composes no Control Plane; the image path was verified end to end on the AMEC deployment from a source-launched Runner.
