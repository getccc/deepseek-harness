---
description: "公司模型网关 Service Definition：一个组织所提供的模型目录，以及把模型名变成一次已授权上游调用的判定。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-gateway

[English](README.md) | 中文

## 概述

`dsh-model-gateway` 是公司模型调用所经过的地方。Runner 指名一个模型并发送一个请求体；它拿回的是一个自己构造不出来的调用，因为 Endpoint、上游模型名和凭据全都来自目录。正是这一点让"公司凭据从不到达 Runner"成为设计的属性而不是一句承诺——请求里根本没有让 Runner 放进它的地方。请与 [`model-gateway-sqlite`](../model-gateway-sqlite/README.zh.md) 这样的后端搭配使用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import { applyPlanToBody } from '@deepseek-ai/dsh-model-gateway'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId
declare const body: Record<string, unknown>

const plan = await ctx.modelGateway.authorize({
  orgId, principalId, modelRef: 'company-v4', period: '2026-08', inputTokens: 1_200,
})

// plan.endpoint, plan.upstreamModel, and plan.credentialRef came from the
// catalog; the Runner supplied none of them.
const upstream = applyPlanToBody(body, plan)

await ctx.modelGateway.settle(plan.reservationId, { kind: 'reported', inputTokens: 1_200, outputTokens: 830 })
```

`authorize` 用一个词拒绝：`unknown-model`、`model-retired`、`not-allowed`、`quota-exceeded` 或 `malformed`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 不存在与无授权被同样地回答

一个不存在的模型和一个这个主体不可调用的模型都是 `unknown-model`，因此一次拒绝永远不会告诉成员某个组织有哪些模型。`not-allowed` 留给访问控制认识、但出于其他原因拒绝的主体。

### 两个请求体字段，且只有两个

[`applyPlanToBody`](src/body.ts) 用目录里的上游名覆盖 `model`，并在**请求体已经携带**时对 `max_tokens` 或 `max_completion_tokens` 封顶。添加一个 Adapter 没有发送的上限，会改变它本意要发的请求。调用去往何处根本不在请求体里，因此没有别的可剥除。

### 是引用，不是键

`credentialRef` 是凭据提供者能解析的一个名字，例如 `COMPANY_DEEPSEEK_KEY`——而不是 `scope/id` 形式的凭据键，后者寻址的是另一样东西，解析结果什么也不是。[`register`](src/index.ts) 拒绝不是引用的取值，因此这个错误在管理员犯下之处失败，而不是在每一次调用一个目录读作 active 的模型时失败。

### 目录声明请求可以携带什么

条目上的 `inputModalities` 是写下一个模型接受何种输入的唯一地方：`text`，或 `text` 加 `image`。`discover` 把它连同引用与显示名一起交给成员的 Runner，Runner 对没有列出 `image` 的模型在发送任何内容之前就拒绝图片，因为它不持有任何可供试探的提供方凭据。词表是传输接缝的 `MODEL_INPUT_MODALITIES`，在这里重新导出，因此存储声明的目录与读取它的 Adapter 指名同一个封闭集合。

### 目录的上限说了算

一个索取超过该模型配置产出量的 Runner，得到的是配置的数额，而预留按那个数额取走。更小的索取会被尊重，因此一个短请求不会占住一个长请求的预算。

### 停用与删除是两件不同的事

`setStatus` 让一个模型退出服务、又把它放回来：记录和所有指名它的授权都保持原样。`remove` 把记录连同那些授权一起取走，因此之后以同一个 Ref 注册的模型从零授权开始。两者遇到目录里没有的 Ref 都不会失败，而且 `remove` 只解除 `register` 所治理的东西：另一个子系统在模型类型下治理的资源会被原样保留，即使它恰好带着被请求的那个 Ref。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务、它的拒绝，以及 `ctx.modelGateway` |
| [`src/body.ts`](src/body.ts) | 请求体上行之前网关覆盖了什么 |
| [`src/vocabulary.ts`](src/vocabulary.ts) | 状态与拒绝原因词表 |
| [`src/types.ts`](src/types.ts) | 目录记录、请求与调用计划的结构，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`model-gateway-sqlite`](../model-gateway-sqlite/README.zh.md) —— 随产品提供的后端。
- [模型网关子系统](../../../docs/subsystems/model-gateway.zh.md) —— 三个判定，以及什么会到达 Provider。
- [`quota`](../../access/quota/README.zh.md) —— 一份计划的预留所在的那个账本。

<a id="model-experience"></a>
## 模型体验

无，因为网关只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

网关不构造请求前缀；它改写的是 Adapter 已经构造好的请求中的两个字段。覆盖 `model` 会改变上游请求，因此一个在两个映射到同一上游模型的目录 Ref 之间切换的 Runner，产生的字节依然相同，Provider 的缓存得以保留。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **这里没有任何东西调用 Provider** —— `authorize` 产出一份计划，`settle` 关闭它；执行 HTTP 调用、解析凭据、流式转发响应，属于它前面的那个 Transport。
- **只有一种请求体格式** —— `model` 是 OpenAI 兼容请求形态里的字段名，而那是本构建唯一代理的一种。命名不同的 Provider 需要它自己的条目，而不是一个猜测。
- **没有 Files API** —— 公司文件上传需要它自己的归属映射，而本目录不承载它。
- **`inputTokens` 由调用方提供** —— 网关按被告知的数额预留，少报的调用方会少预留。统计它属于 Transport，那里请求体已经被解析过了。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

Runner 发送的是它自己的 LLM Adapter 构造的请求体。在 Control Plane 里重新实现每个 Provider 的请求格式，等于多出第二个需要维护正确性的 Adapter，而两者最终会漂移；覆盖那些决定*哪个模型*和*多少输出*的字段，是让授权真正有意义的最小干预。

</details>
