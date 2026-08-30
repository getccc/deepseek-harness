# Model gateway

English | [中文](model-gateway.zh.md)

The model gateway is what a company model call goes through. The subsystem is one seam — [`dsh-model-gateway`](../../packages/llm/model-gateway) (`ctx.modelGateway`) with the [`dsh-model-gateway-sqlite`](../../packages/llm/model-gateway-sqlite) backend — and it is server-side only: the Control Plane composes it, no Runner mounts it, and models never see it. Design record: [model gateway Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-a-runner-names-a-model-and-nothing-else.md).

## A Runner names a model and nothing else

The endpoint, the upstream model name, and the credential all come from the catalog. A Runner sends a model ref and a request body; it gets back a call it could not have constructed itself.

That is what makes "the company credential never reaches the Runner" a property of the design rather than a promise. There is nowhere in the request for a Runner to put a URL, a host, a path, or an upstream `Authorization` header, so there is nothing to strip and nothing to validate — those facts simply are not part of what a Runner sends.

## The catalog holds a reference, never a secret

A model row carries a credential *reference*. The secret lives in the credential provider and is resolved at the moment of the call, so rotating it changes nothing in the catalog and reading the catalog yields nothing anyone could spend.

## The stable ref is the identity

`modelRef` is what a Runner asks for and what a grant names, and it never moves. The provider's own name for the model lives beside it and may change under it — a provider that renames a model upstream, or a credential that rotates, changes a column without disturbing any grant.

## Registering a model governs it

Adding a catalog entry registers the same model as a governed resource in [access control](access-control.md), in the same call. A catalog entry access control does not know about is a model no grant can name and nobody can ever invoke, and an administrator who added one would have to know to do a second thing elsewhere for the first to mean anything.

Retiring works the same way in reverse: the catalog status and the governed resource move together, so a withdrawn model is refused whichever entry point a request arrives at.

## Three decisions, in this order

1. **Is there such a model?** A model that does not exist and one this principal may not invoke are answered alike — `unknown-model` — so a refusal never tells a member which models an organization has.
2. **May this principal invoke it?** Asked on every invocation against the current policy revision, so a role change takes effect on the next request rather than when a token happens to expire.
3. **Is there budget?** A [reservation](quota.md) is taken only once the request is certain to be attempted, so a refused request holds nothing.

## What reaches the provider

The Runner's body is the one its own LLM adapter built — reimplementing every provider's request format in the Control Plane would be a second adapter to keep correct. Two fields are overwritten before it goes upstream:

- **`model`** becomes the catalog's upstream name, so a Runner that named one model and wrote another in the body reaches the one it was authorized for.
- **`max_tokens` / `max_completion_tokens`**, when the body already carries one, is bounded by the reserved ceiling, so the response cannot exceed the budget that was held. A field the body did not carry is not added, because adding one would change a request the adapter meant to send.

## The catalog's ceiling wins

A Runner asking for more output than the model is configured to produce gets the configured amount, and the reservation is taken against that rather than against the ask. A smaller ask is honoured, so a short request does not hold a long request's budget.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxllmhttptransport--llmhttptransport-abstract-seam"></a>

### `ctx.llmHttpTransport` — `LlmHttpTransport` (abstract seam)

How a model request reaches a provider. A provider mounts this service; LLM adapters inject `llmHttpTransport`.

A request names an operation the code registers and a model, never a URL. A direct transport resolves both from the member's own configuration; a team transport sends them to the Control Plane, which resolves them from the company catalog. Neither lets a caller decide where bytes go.

```ts cordis-catalog
/**
 * Carry one request to a provider and hand back its response.
 * @param request - the operation, the model, and the body an adapter built.
 * @returns the provider's status, headers, and body stream.
 * @throws {TransportFailedError} when the request could not be carried at all.
 */
abstract send(request: TransportRequest): Promise<TransportResponse>
```

Source: [`packages/llm/llm-http-transport/src/index.ts`](../../packages/llm/llm-http-transport/src/index.ts)

<a id="ctxmodelgateway--modelgateway-abstract-seam"></a>

### `ctx.modelGateway` — `ModelGateway` (abstract seam)

The company model catalog and the decision in front of it. A provider mounts this service; consumers inject `modelGateway`.

Authorization is asked on every invocation rather than cached with a token, so a role change takes effect on the next request instead of when a credential happens to expire.

```ts cordis-catalog
/**
 * Put a model in the catalog, or update the one already there.
 *
 * Idempotent on `(orgId, modelRef)`: the stable ref is the identity, so a
 * provider renaming its model upstream, or a credential rotating, changes
 * this row without disturbing any grant that names it.
 * @param input - the model's stable ref and everything the upstream call needs.
 * @returns the stored entry.
 * @throws {MalformedCatalogEntryError} when a field names something no call could use.
 */
abstract register(input: RegisterModel): Promise<ModelEntry>

/**
 * Withdraw a model from service, or return it.
 * @param orgId - the organization the model belongs to.
 * @param modelRef - the model to change.
 * @param status - whether it may be invoked.
 */
abstract setStatus(orgId: OrgId, modelRef: string, status: ModelStatus): Promise<void>

/**
 * Every model in an organization's catalog, in registration order.
 *
 * This is the administrator's view and is not filtered by any principal's
 * grants; a member's list is {@link discover}.
 * @param orgId - the organization to list.
 * @returns the catalog, retired models included.
 */
abstract list(orgId: OrgId): Promise<ModelEntry[]>

/**
 * The models one principal may see, with nothing an upstream call needs.
 *
 * A Runner is told the stable ref and the display name and no more: the
 * endpoint, the upstream name, and the credential reference are the
 * gateway's, and a member's model list is not the place to publish them.
 * @param orgId - the organization to list.
 * @param principalId - the account asking.
 * @returns the active models this principal holds `model.discover` on.
 */
abstract discover(orgId: OrgId, principalId: string): Promise< { readonly modelRef: string; readonly displayName: string }[] >

/**
 * Decide one invocation and hold the budget for it.
 *
 * The order is deliberate: a model nobody may discover is refused as
 * unknown, an authorized model with no budget is refused after the
 * authorization it passed, and a reservation is only taken once the request
 * is certain to be attempted.
 * @param request - who is asking, for which model, and how much it may cost.
 * @returns the approved call, including the reservation to settle afterwards.
 * @throws {InvocationRefusedError} with the word for why it may not proceed.
 */
abstract authorize(request: InvocationRequest): Promise<CallPlan>

/**
 * Settle the reservation an approved call held.
 *
 * A pass-through to the ledger, so a caller that holds a plan does not also
 * need the quota service, and so every settlement for a gateway call goes
 * through one place.
 * @param reservationId - the reservation the plan named.
 * @param settlement - what the provider reported, what is estimated, or a release.
 */
abstract settle(reservationId: ReservationId, settlement: Settlement): Promise<void>
```

Types: [OrgId](account.md) · [ReservationId](quota.md) · [Settlement](quota.md)

Source: [`packages/llm/model-gateway/src/index.ts`](../../packages/llm/model-gateway/src/index.ts)
<!-- END GENERATED cordis-surface -->
