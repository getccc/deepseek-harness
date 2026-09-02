---
description: "基于 SQLite 的受治理知识网关：持久化目录、针对上游数据源的同步、逐资源授权判定和审计。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-gateway-sqlite

[English](README.md) | 中文

## 概述

`dsh-knowledge-gateway-sqlite` 在一个 SQLite 目录之上提供 `ctx.knowledgeGateway`。它为每个上游知识库铸造稳定的 `KnowledgeRef`，针对数据源对账目录，把每个知识库注册为受治理资源，在每次面向成员的调用上逐知识库判定访问，并记录发生了什么。它只在 Control Plane 运行。目录记录知识库**是什么**，不记录任何人问过它什么：没有查询、段落、文件名或凭据的列。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `team-control-plane` 组合中，于访问控制、审计和一个知识源之后挂载。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-knowledge-gateway-sqlite'
  config:
    path: /var/lib/dsh/control-plane/knowledge.sqlite
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `path` | — | 目录数据库所在位置 |
| `defaultMaxResults` | `10` | 调用方未指定上界时一次检索最多返回的段落数 |

### 同步

一次成功的完整列表在单个事务中应用，随后与访问控制对账。新的上游 id 创建一行并注册一个已启用的受治理资源。已知 id 更新显示元数据，不改变引用、资源 id 或任何授权。在成功列表中缺失的 id 变为不存在，其资源被停用——该行及其授权保留，因为临时移除不得静默替换身份，而删除资源会删除所有指名它的授权。重新出现的 id 会被恢复，且只有在管理员自己的开关仍然打开时才重新启用。

不应答的数据源会保留最后一次成功快照并记录该失败。一次故障不得停用一个组织治理的全部知识库。

并发调用方加入已在进行中的对账，而不是让两次对账在同一批行上竞争。

### 授权

每次面向成员的调用都逐知识库、重新判定 `knowledge.search`。`all` 展开为主体当前持有的范围；`selected` 对每个具名引用做判定，并在第一个失败处拒绝整个请求。未知引用与未授权引用产生相同的拒绝，因此持有零权限的成员无法得知某个知识库存在。

成员不共享同一 embedding 模型的多库范围，会在调用数据源**之前**以 `scope-incompatible` 被拒。跨知识库检索只对共享同一模型的知识库有定义，而数据源没有为不满足该条件的集合声明任何错误——因此这类调用的行为是未定义的，而未定义的上游行为不得变成静默的产品行为。

<a id="understand-the-implementation"></a>
## 理解实现

### 两个无法一起提交的数据库

访问控制仍是角色、授权和资源的权威；本目录记录知识库是什么。因此对账是幂等且反复进行的：在这一对写入的第一个之后失败的写入，由下一次同步发现并修复，而不是留作永久的不一致。在这期间，没有受治理资源的目录行会被隐藏而不是展示，因为向角色编辑器提供一个没有授权能够指名的 id，比晚一步显示某个条目更糟。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/schema.ts`](src/schema.ts) | 两张表、它们的约束，以及 application id 和 schema 版本 |
| [`src/index.ts`](src/index.ts) | 同步、授权、检索和审计 |

### 一次检索记录什么

检索覆盖的每个知识库一条审计行，携带身份、受治理资源、结果、有界结果数和关联信息。上游失败携带封闭 label，而不是新的审计理由。查询及其返回的段落无处可落。

<a id="further-exploration"></a>
## 延伸阅读

- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 受治理词汇。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 对账规则，以及缺失为何是停用而不是删除。

<a id="model-experience"></a>
## 模型体验

无，因为网关运行在 Control Plane，而 Control Plane 不挂载 agent 也不挂载工具注册表，模型永远到不了它。

#### KV Cache 影响

这里不会改变任何请求前缀。段落只有在 Runner 侧工具渲染之后才成为模型可见内容，前缀开销落在那里。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本提供方自身在何处不完整。它们是当前的包约束。

- **只支持单个活动实例** —— 一个 SQLite 文件支持一个具有持久存储与备份的活动 Control Plane 进程。横向副本需要共享数据库设计，而不是复制这个文件。
- **授权是逐个进行的** —— 目录和 `all` 模式检索每个知识库判定一次。这对完整列表部署可接受；批量访问控制操作必须保留逐资源判定和策略修订语义，而不能一次授权后执行多个。
- **对账以一次列表为单位全有或全无** —— 无法铸造引用的条目会回滚整批列表，因此一个畸形的上游 id 会阻塞其余条目，直到数据源被修复。
- **退役不可撤销** —— 一次成功列表不再指名的知识库会连同其受治理资源与其上的全部授权一起删除。因此数据源只列出自己所持内容的一部分时，管理员会失去已经做出的授权。
- **这里不调度同步** —— `sync` 在调用方请求时运行。启动期与周期性对账属于知道本 Control Plane 服务哪个组织的那个组合，而本包并不知道。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
