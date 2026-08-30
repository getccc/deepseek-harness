# 模型网关

[English](model-gateway.md) | 中文

模型网关是公司模型调用所经过的地方。本子系统是一个接缝——[`dsh-model-gateway`](../../packages/llm/model-gateway)（`ctx.modelGateway`）配合 [`dsh-model-gateway-sqlite`](../../packages/llm/model-gateway-sqlite) 后端——且只存在于服务端：由 Control Plane 组合，任何 Runner 都不挂载它，模型也永远看不到它。设计记录：[模型网关 Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-a-runner-names-a-model-and-nothing-else.zh.md)。

## Runner 只指名一个模型，别无其他

Endpoint、上游模型名和凭据全都来自目录。Runner 发送一个 Model Ref 和一个请求体；它拿回的是一个它自己构造不出来的调用。

正是这一点让"公司凭据从不到达 Runner"成为设计的属性而不是一句承诺。请求里根本没有让 Runner 塞进 URL、Host、Path 或上游 `Authorization` 头的地方，因此没有什么要剥除、也没有什么要校验——那些事实压根不属于 Runner 所发送的内容。

## 目录持有的是引用，不是密钥

一行模型携带的是一个凭据*引用*。密钥存放在 Credential Provider 中，并在调用发生的那一刻被解析，因此轮换它不改变目录中的任何东西，读取目录也得不到任何人能花掉的东西。

## 稳定 Ref 就是身份

`modelRef` 是 Runner 所索取的、也是授权所指名的，而它永不移动。Provider 自己对该模型的称呼放在它旁边，并可以在它之下改变——Provider 在上游重命名一个模型、或者凭据轮换，改的是一列，不会惊动任何一条授权。

## 注册一个模型即纳入治理

添加一条目录记录会在同一次调用中，把同一个模型注册为[访问控制](access-control.zh.md)中的受治理资源。一条访问控制不知道的目录记录，是一个没有授权能指名、也没有人能调用的模型；而添加了它的管理员将必须知道要去别处再做第二件事，第一件才有意义。

退役以同样的方式反向进行：目录状态与受治理资源一同变动，因此一个被撤下的模型无论请求从哪个入口到达都会被拒绝。

## 三个判定，按这个顺序

1. **有这个模型吗？** "不存在的模型"和"这个主体不可调用的模型"被同样地回答——`unknown-model`——因此一次拒绝永远不会告诉成员某个组织有哪些模型。
2. **这个主体可以调用它吗？** 在每一次调用上、对照当前策略修订号询问，因此角色变更在下一次请求就生效，而不是等某个 Token 恰好过期。
3. **还有预算吗？** [预留](quota.zh.md)只在请求确定会被尝试之后才被取走，因此一个被拒绝的请求什么也不占。

## 什么会到达 Provider

Runner 的请求体是它自己的 LLM Adapter 构造的——在 Control Plane 里重新实现每个 Provider 的请求格式，等于多出第二个需要维护正确性的 Adapter。在它上行之前有两个字段被覆盖：

- **`model`** 变成目录里的上游名，因此一个"指名了一个模型、却在请求体里写了另一个"的 Runner，到达的是它被授权的那一个。
- **`max_tokens` / `max_completion_tokens`**，在请求体已经携带它时，被预留上限封顶，因此响应无法超出实际持有的预算。请求体没有携带的字段不会被添加，因为添加它会改变 Adapter 本意要发送的请求。

## 目录的上限说了算

一个索取超过该模型配置产出量的 Runner，得到的是配置的数额，而预留是按那个数额、而不是按索取额取走的。更小的索取会被尊重，因此一个短请求不会占住一个长请求的预算。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [OrgId](account.zh.md) · [ReservationId](quota.zh.md) · [Settlement](quota.zh.md)

Source: [`packages/llm/model-gateway/src/index.ts`](../../packages/llm/model-gateway/src/index.ts)
<!-- END GENERATED cordis-surface -->
