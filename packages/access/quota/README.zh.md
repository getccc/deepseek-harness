---
description: "配额 Service Definition：在上游调用之前持有对组织预算的一份主张，事后只结算一次、按实际发生的情况。"
kind: "package-reference"
---

# @deepseek-ai/dsh-quota

[English](README.md) | 中文

## 概述

`dsh-quota` 是公司模型调用的预算账本。调用方在调用上游 Provider 之前预留，事后结算一次，而整个设计都取决于一个事实：一个请求可能以某种方式失败，使得没有任何人知道 Provider 是否生成过 Token。因此预留就是一个请求所能花费的上限，结算被它封顶，而三种结算类型把"Provider 报告了这个数"、"这是估算的"和"这从未被收费"区分开来。请与 [`quota-sqlite`](../quota-sqlite/README.zh.md) 这样的后端搭配使用。

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
import '@deepseek-ai/dsh-quota'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId

const held = await ctx.quota.reserve({
  orgId, period: '2026-08', principalId,
  modelRef: 'deepseek-v4', inputTokens: 1_200, maxOutputTokens: 4_000,
})

// …call the upstream provider, then settle exactly once.
await ctx.quota.settle(held.id, { kind: 'reported', inputTokens: 1_200, outputTokens: 830 })
```

对同一个 Reservation 再次结算，返回的是既有记录且不改变任何余额，因此在结算后崩溃的调用方可以重试。

### 该发哪一种结算

| 结果 | 结算 |
|---|---|
| Provider 报告了 Usage | 用那些数字的 `reported` |
| Provider 表示它没有接受该请求 | `released` |
| 被取消、完成但没有 Usage 字段、或传输失败 | 用现有最佳数字的 `estimated` |

`released` 是唯一会整份归还预留的结果，而它需要上游拒绝了该请求的证据。一次完全没有响应的传输失败不是那种证据——Provider 可能已经生成了没人看到的 Token。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 预留就是上限

它持有输入加上该请求可能产生的最多输出，因此每一次结算都被它封顶。Provider 报告的数量超过该请求被允许产生的量，或者估算值超出，都按实际持有的数额计费——没有这个封顶，估算就是凭空发明。

### 没有限额就没有上限

一个管理员没有设限的组织不会被悄悄限制为零：`limitTokens` 和 `availableTokens` 是缺席而不是零，因此调用方不会把"无限"误当成"已耗尽"。

### 周期由调用方命名

接缝不知道"一个月"是什么。由部署为自己的周期命名，并询问某个请求所属的那一个，这让日历、时区和账期都留在了一个唯一职责是做算术的账本之外。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务、它的失败，以及 `ctx.quota` |
| [`src/vocabulary.ts`](src/vocabulary.ts) | 拒绝原因与结算类型词表 |
| [`src/brand.ts`](src/brand.ts) | 每次结算据以幂等的那个 Reservation 身份 |
| [`src/types.ts`](src/types.ts) | 请求、预留、结算与用量的结构，仅类型 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`quota-sqlite`](../quota-sqlite/README.zh.md) —— 随产品提供的后端及其 Reconciler。
- [配额子系统](../../../docs/subsystems/quota.zh.md) —— 完整的结算规则。
- [`access-control`](../access-control/README.zh.md) —— 谁可以使用某个模型，这不由本包决定。

<a id="model-experience"></a>
## 模型体验

无，因为账本只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **计的是 Token，不是钱** —— 按价格加权需要模型目录所拥有的价格元数据，而一个凭空猜出换算关系的账本，会以货币为单位地出错。
- **每个组织每个周期只有一个限额** —— 按角色和按成员的上限是账本尚未承载的第二个维度。
- **这里没有任何东西调度 Reconciler** —— `reconcile` 是一个由调用方运行的方法；何时运行、多久一次是网关的决定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

`released` 不是"估算为零"。它是"什么也没花"这个陈述，把两者合并会丢掉账单对账所需要的那个区别——这也正是过期的 Reservation 被结算而不是被释放的原因。

</details>

**运行时不变量：**不发布伴随文件：本包只声明抽象服务与两个静态词表，不挂载任何东西；每次预留一次结算且不超出持有量这一关系，属于持有账本的 provider 及其测试。
