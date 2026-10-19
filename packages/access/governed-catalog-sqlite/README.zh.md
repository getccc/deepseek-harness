---
description: "受治理知识库、BI 与 GMO 网关背后的 SQLite 目录引擎：把数据源列表对账成受治理的 access-control 资源，逐操作判定访问，并记录审计行。"
kind: "package-library"
---

# @deepseek-ai/dsh-governed-catalog-sqlite

[English](README.md) | 中文

## 概述

`dsh-governed-catalog-sqlite` 让 Control Plane 网关保存一份持久目录，记录数据源所治理的内容。它对照一次列表同步目录，把每个条目作为受治理资源注册到 access control，在每个成员操作上重新向 access control 询问，并写入审计行。知识库、BI 与 GMO 网关共用它，所以对同步或授权的修复只需做一次。它不调用数据源，也不定义请求语法；这些以及网关自己存储的列由各网关提供。

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

### 何时使用

用在这样的网关里：数据源列出条目，管理员逐个启用，角色逐个获得授权。`dsh-knowledge-gateway-sqlite`、`dsh-bi-gateway-sqlite` 与 `dsh-gmo-gateway-sqlite` 引用它。只治理单个资源的网关（例如网页搜索）不需要目录，也不使用它。

### 入口

网关在构造函数里构造一个 `GovernedCatalog` 并委托给它：

```text
this.catalog = new GovernedCatalog(ctx, resolvedConfig, {
  name, table: 'gmo_category', sourceTable: 'gmo_source', refColumn: 'category_ref',
  resourceType, catalogResource, syncAction: 'gmo.catalog.sync', failureKey: 'gmoFailure',
  startsEnabled: false, listedColumns: ['result_count'],
  applySchema, source, describe, failureReason, unknownEntry, entry,
})
const row = await this.catalog.admit(principal, ref, 'gmo.query') // undefined when refused
```

`sync`、`view` 与 `setEnabled` 服务管理页；`admit` 与 `authorizedEntries` 服务成员操作；`record` 写一行审计。`applyCatalogSchema` 在打开时检查文件的 application id 与 schema 版本。网关需要提供的每个字段见 [`src/types.ts`](src/types.ts)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

两个数据库无法一起提交。access control 仍是角色、授权与资源的权威；目录记录条目是什么。因此同步是幂等且重复进行的：这一对写入中第一个之后失败的写入，会被下一次同步修复。

一次同步先列出数据源，在写入任何东西之前描述每个条目，撤下列表已丢弃条目的 access-control 资源，在一个事务里写入列表，再注册资源。失败的列表保留最近一次快照，并在数据源行上记录失败词。并发调用方加入正在进行的同步。新条目按网关的规定以启用或停用开始；已知条目保留管理员的选择。

`admit` 只在条目存在、已启用、且 access control 现在允许该操作时才返回行。未知、已停用和未授权的条目是同一种结果，所以什么都没被授予的成员无从得知条目是否存在。`authorizedEntries` 遍历目录行，从不遍历该类型的资源，因为目录管理资源与它们同一类型，类型级授权否则会把它当作条目放行。

表名与列名来自网关的常量并写入 SQL 文本，从不来自请求数据。

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `GovernedCatalog`：同步、启停、准入、列表与审计记录 |
| [`src/schema.ts`](src/schema.ts) | `applyCatalogSchema`：application id 与版本检查 |
| [`src/types.ts`](src/types.ts) | 网关提供的 spec、行与视图 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-gmo-gateway-sqlite`](../../gmo/gmo-gateway-sqlite/README.zh.md)——基于它构建的最小网关。
- [`dsh-knowledge-gateway-sqlite`](../../knowledge/knowledge-gateway-sqlite/README.zh.md)——最大的一个，在多个目录上做搜索。
- [访问控制子系统](../../../docs/subsystems/access-control.zh.md)——本引擎所询问的判定。
- [审计子系统](../../../docs/subsystems/audit.zh.md)——记录所对照的封闭词汇。

<a id="model-experience"></a>
## 模型体验

无，因为引擎运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它；目录内容只有在网关授权、Runner 侧工具渲染之后才对模型可见。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **两个存储无法一起提交**——目录与 access control 之间被中断的写入会留下一行，由下一次同步修复；在此之前，没有受治理资源的行在管理视图中被隐藏。
- **状态视图每个组织一个数据源**——数据源状态读取该组织的第一行数据源；第二个数据源需要按数据源各给一份状态。
- **没有迁移**——其他 schema 版本的数据库被拒绝；重建的代价是一次同步和管理员的启用选择。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

引擎取代了同步与授权代码的三份副本。三种能力在 Runner 侧的输入框控件与 Typert 控制器仍然彼此重复；它们的传输类型按名称区分是有意为之，所以留给各自的变更。

</details>

**运行时不变量：** 不发布伴随包：引擎除 SQLite 文件外不拥有任何状态，打开时检查该文件的 application id 与 schema 版本；目录与 access control 之间的关系由同步修复，而不是在运行时断言。
