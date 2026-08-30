---
description: "SQLite 配额账本：预留、幂等结算，以及负责关闭无人结算者的 Reconciler。"
kind: "package-reference"
---

# @deepseek-ai/dsh-quota-sqlite

[English](README.md) | 中文

## 概述

`dsh-quota-sqlite` 把[配额账本](../quota/README.zh.md)保存在一个 SQLite 数据库中：预算、持有主张的 Reservation、应答它们的结算，以及负责结算那些无人结算者的 Reconciler。"每个 Reservation 只有一条结算"是一个主键，而不是代码里的一条规定，因此没有任何东西——无论是不是服务——能把一个请求计费两次。

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

```yaml
plugins:
  '@deepseek-ai/dsh-quota-sqlite':
    path: ./quota.sqlite
    reservationTtlMs: 900000
```

`reservationTtlMs` 限定一个崩溃的请求最长能占住多久预算。它应当高于部署所预期的最慢一次完成，且不能贴着它：过低会让一个慢但活着的请求在仍在运行时就被按上限计费，过高则会让一个已崩溃的请求占住预算那么久。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 幂等性就是 Schema

`settlement.reservation_id` 是主键。同一个 Reservation 的第二条结算插不进去，因此崩溃后重试的调用方与并行运行的 Reconciler 不可能同时给同一个请求计费。`settle` 读出既有记录并返回它，而不是写入。

### 余额是推导出来的，从不存储

已结算 Token 是各笔结算之和；已预留 Token 是尚无人应答的各笔 Reservation 之和。一个存储的运行总额会成为真相的第二处住所，而两者最终会以只有审计才能发现的方式彼此不一致。

### Reconciler 计费，并标记它这么做了

一个过期的 Reservation 按其全额、以 `kind: 'estimated'` 和 `reconciled: true` 结算。释放会让崩溃循环在不留记录的情况下花费；而这个标记正是让日后的读者能区分"没人报告过的一笔计费"和"有人报告过的一笔"、并让账单对账退回差额的东西。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | reserve、settle、reconcile，以及推导出的账面状况 |
| [`src/schema.ts`](src/schema.ts) | 表、约束与 pragma 守卫 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`quota`](../quota/README.zh.md) —— Service Definition 与结算词汇表。
- [配额子系统](../../../docs/subsystems/quota.zh.md) —— 完整的结算规则。
- [`audit-sqlite`](../audit-sqlite/README.zh.md) —— 同组存储，Schema 版本与 Application ID 的处理方式相同。

<a id="model-experience"></a>
## 模型体验

无，因为账本只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **没有任何东西清理已结算的 Reservation** —— 这些行正是"预算曾被持有、以及什么应答了它"的证据，因此保留期处理需要它自己的设计，而不是一句 `DELETE`。
- **`reconcile` 按过期时间扫描，何时运行由调用方决定** —— 这里没有调度，这里的任何东西都不会自行运行。
- **一笔经 Reconciler 的结算按整份预留计费** —— 对于一个确实很早就失败了的请求，这是多收了；`estimated` 标记正是让它可被找到的东西，而这个账本刻意不去纠正它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试开第二条连接写裸 SQL，理由与审计存储的测试相同：被测的主张不是"服务不肯结算两次"，而是"数据库不肯"。

</details>
