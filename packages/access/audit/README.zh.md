---
description: "审计 Service Definition 及其封闭词汇表：动作目录、Metadata Key 目录，以及把任务内容挡在记录之外的取值规则。"
kind: "package-reference"
---

# @deepseek-ai/dsh-audit

[English](README.md) | 中文

## 概述

`dsh-audit` 记录一个主体对公司资源做了什么、结果如何，好让管理员能够证明访问经过授权。它不是任何人工作的副本，而这是记录本身的属性，不是谁必须遵守的规定：列是固定的，动作和拒绝原因是封闭词表，唯一由调用方选择的值是 Metadata Key，其种类只接受一个计数、一个列出的词，或一个短 Token。Prompt、路径或 Diff 一个也满足不了。请与 [`audit-sqlite`](../audit-sqlite/README.zh.md) 这样的后端搭配使用。

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
import '@deepseek-ai/dsh-audit'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId
declare const deviceId: string

await ctx.audit.record({
  orgId, principalId, action: 'device.bind', outcome: 'allowed',
  deviceId, metadata: { platform: 'darwin', runnerVersion: '2.4.1' },
})

const denials = await ctx.audit.query({ orgId, outcome: 'denied', limit: 50 })
```

调用方指名一个动作，从不指名资源类型：类型来自 [`AUDIT_ACTIONS`](src/actions.ts)，因此一条记录无法把角色变更描述成设备事件。序号和时间由存储分配，因此一条条目既不能被回填时间，也不能被重新排序。

### 一条记录可以携带什么

`resourceId`、`deviceId` 和 `correlationId` 必须匹配 [`AUDIT_TOKEN`](src/metadata.ts)——最多 64 个字符，取自字母、数字和 `. _ : @ -`。Metadata Key 必须已注册**并且**被该动作声明，每个值还必须满足其 Key 的种类。

[`checkAuditRecord`](src/validate.ts) 返回问题而不是抛出它，于是 `record` 为异步的存储会用它来 reject，而不是越过调用方的 `catch` 抛出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 为什么没有自由文本字段

一个接受句子的字段最终会装上一句，而那句话会引用请求本身。删掉这个字段是这条规则唯一无需任何人记住就能成立的版本，这也是为什么一次拒绝携带的是一个 [`AuditReason`](src/vocabulary.ts) 词，而不是一条消息。

### 为什么 Metadata 目录既封闭又按动作划分

注册一个 Key 表明某个子系统会记录它；在某个动作上声明它则表明哪一项操作可以记录。少了后半截，任何 Key 都能搭上任何操作的便车，而"受限 Metadata"就只意味着这些 Key 曾在某处被命名过。

### 为什么词表是运行时数组

`AUDIT_OUTCOMES` 和 `AUDIT_REASONS` 是数组，其联合类型由它们派生，因为存储会从这些数组播种列约束。这份清单只在这里存在一次，SQL 只能通过读取本模块来重述它。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务与 `ctx.audit` |
| [`src/actions.ts`](src/actions.ts) | 封闭动作目录：每项操作的资源类型与所声明的 Metadata |
| [`src/metadata.ts`](src/metadata.ts) | Metadata Key 目录、取值种类与 Token 规则 |
| [`src/vocabulary.ts`](src/vocabulary.ts) | Outcome 与拒绝原因词表 |
| [`src/validate.ts`](src/validate.ts) | 记录检查及其指出的失败 |
| [`src/types.ts`](src/types.ts) | Record、Event 与 Query 的结构，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`audit-sqlite`](../audit-sqlite/README.zh.md) —— 随产品提供的后端。
- [审计子系统](../../../docs/subsystems/audit.zh.md) —— 完整的词汇表与存储规则。
- [`access-control`](../access-control/README.zh.md) —— 其决定的原因正是前三个 `AuditReason` 词所对应的。

<a id="model-experience"></a>
## 模型体验

无，因为审计只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **目录只覆盖账户、Session、设备、Credential 和策略操作** —— 公司资源类动作随着执行它们的那些 Gateway 一起到来，因为没有任何东西会记录的动作，是没有读者能够信任的条目。
- **没有布尔类 Metadata 种类** —— 目前没有调用方需要它，而没有 Key 的种类是一个没人看着的洞。
- **这里没有保留期与导出** —— 服务只追加和读取；删除过期记录与只追加的存储相冲突，需要它自己的设计。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

新增一项动作意味着新增它的条目，若它携带一项新事实，还要新增一个带种类的 Metadata Key。两者都会被存储的 Schema 播种读取，因此新条目会在下一次启动时到达已有数据库，不需要提升 Schema 版本；退役一项则会让它的行继续引用一条留在原地的目录行。

</details>
