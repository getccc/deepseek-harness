---
description: "BI 分析服务（ctx.bi）：稳定的项目与图表引用、已授权项目目录、已保存图表的列表与执行词汇、会话 BI 范围，以及封闭的失败分类。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bi

[English](README.md) | 中文

## 概述

`dsh-bi`（`ctx.bi`）是 Team Runner 用来获取已登录成员可分析的 BI 项目的接缝。它定义三个操作——读取已授权项目目录、列出一个项目的已保存图表、执行一张已保存图表——外加两个受治理引用、`bi/scope` Session 事件和封闭的失败集合。它不发起任何网络调用：挂载的提供方才会，而在 Team Edition 中该提供方转发给对每个操作做授权的 Control Plane。没有任何操作命名数据源、传递上游 id 或携带调用方自己的查询，因此这个服务本身触达不了任何东西。

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

需要 BI 分析的组合挂载一个提供方，由它注册本服务；插件与工具作者随后调用 `ctx.bi.catalog()`、`ctx.bi.charts()` 和 `ctx.bi.query()`。任何调用都不接受数据源、地址或凭据，因为它们都不由调用方选择。

### 何时选用

要构建 BI 提供方、面向模型的 BI 工具，或任何必须读取会话 BI 范围的东西时导入它。只想要随附行为的部署改由 Team profile 获得。本服务不注册面向模型的工具，也不贡献自己的提示词：没有挂载提供方时，每个操作都是缺失而非为空。

### 最小配置

本服务没有配置——它是一个抽象接缝。提供方的行提供部署会变化的一切：

```yaml
- name: '@deepseek-ai/dsh-bi-team'
  config:
    controlPlaneUrl: https://dsh.example.com
```

### 命名一个项目

`BiProjectRef` 是 `<providerKind>:<sourceCode>:<upstreamId>`，是唯一会离开 Control Plane 的项目标识符。用 `formatBiProjectRef` 构造，用 `parseBiProjectRef` 读回；后者返回 `undefined` 而不抛出，因为它的调用方是在决定是否接受一个值，而不是在诊断它。

引用以审计 token 字符集限制在 64 个字符内，这正是 `formatBiProjectRef` 拒绝超过 19 个字符的数据源代码的原因。这不是风格上的上限：审计存储的 `resource_id` 遵循同一条规则，所以更长的引用是任何操作都永远无法记录的引用。数据源代码的上界是私有知识推导出的那一个，两边保持相等，让一个部署的数据源代码同时服务两个目录。

### 命名一张图表

`BiChartRef` 是 `<BiProjectRef>/<upstreamChartId>`，用 `formatBiChartRef` 构造，用 `parseBiChartRef` 读回；`projectRefOf` 与 `upstreamChartIdOf` 无需再次解析就能拆开一个已证明的引用。它是独立的品牌而不是更长的 `BiProjectRef`，因为两者受不同的东西约束：项目引用必须装进审计 token，而图表从不是审计资源——对图表的操作所记录的是它所属的项目，那也正是授权所命名的对象。

图表 id 以同一套字符集限制在 64 个字符内，因此任何操作都无法解析的引用在构造处就被拒绝，而不是在调用之后。

### 读取会话范围

`foldBiScope(events)` 从会话日志恢复当前范围，其 `end` 参数折叠一个前缀，让 rewind 和 fork 读到日志在那一点所说的内容。没有 `bi/scope` 事件的日志折叠为 `off`，这是每个会话的起点。`projectOf` 回答记录的项目，`off` 时回答 `undefined`，这样调用方不会构造没人要的请求。

范围命名一个项目或不命名。没有表示“全部项目”的分支：不同项目的图表回答互不相关的问题，一个对话分析一个项目。

### 失败

每个失败都是携带一个 `BiFailureReason` 的 `BiError`。产品界面按 `reason` 分支并提供自己的本地化文案；任何上游响应正文都到不了两者。`not-allowed` 有意同时覆盖未知项目与未授权项目，这样拒绝永远不会向一无所有的主体证实项目存在。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

接缝命名产品操作，绝不命名上游操作。透明转发会让调用方选择权限目录和审计词汇不治理的操作，因此操作集合固定且小，每个操作都是 Control Plane 能按当前状态授权的。已保存图表按保存时的样子执行：执行只接受行数上限，别无其他，因此调用方自己的筛选、参数、排序或 SQL 都到不了数据仓库。

范围存在于会话日志中，且仅存在于日志中。它两次抵达模型——作为点名所选项目的提示词文本，以及作为 BI 工具是否存在——因此把它记录在别处会让日志不足以重建模型看到过什么。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/brand.ts`](src/brand.ts) | `BiProjectRef`、`BiChartRef`、它们的语法，以及塑造它们的审计 token 上界 |
| [`src/types.ts`](src/types.ts) | 目录、图表列表、图表执行、范围与失败词汇 |
| [`src/error.ts`](src/error.ts) | `BiError`，BI 操作抛出的唯一失败 |
| [`src/scope.ts`](src/scope.ts) | `bi/scope` Session 事件、其折叠与其验证器 |
| [`src/index.ts`](src/index.ts) | `Bi` 服务定义 |

### 数据模型

`BiProjectEntry` 是主体可分析的项目，为读者命名。`BiChartSummary` 是其中一个项目里的一张已保存图表，携带受治理引用、所在空间、描述和 `BiChartKind`——数据源自己对图形的称呼，封闭以便工具 schema 能枚举，此构建不认识的类型记为 `other`。`BiQueryResult` 是一次执行的回答：按行顺序排列的字段、作为一行文本的已保存筛选、作为原始单元格的行、数据源报告的行数，以及行或单元格是否被截断。单元格是原始值而非数据源的格式化文本，因为模型要对数字作图和比较，格式化字符串还得解析回去。`BiScope` 是带版本的可辨识联合；其 `selected` 分支在项目引用旁记录显示名，于选择那一刻快照，因为模型可见的名称必须能从日志重建。

<a id="further-exploration"></a>
## 延伸阅读

- [BI 子系统](../../../docs/subsystems/bi.zh.md)——目录、图表列表、图表执行、范围与失败契约的完整版本。
- [Team BI 分析 Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)——BI 为何留在 Control Plane 之后，以及第一阶段不做什么。

<a id="model-experience"></a>
## 模型体验

间接地，经由 BI 工具包：它向模型渲染图表列表与行数据，并贡献范围提示词段落。本服务不贡献提示词，也不注册 schema。

#### KV Cache 影响

无直接失效。范围选择引起的请求前缀变化由上述消费方负责，且它是真实的：改变范围会同时改变一个提示词段落和工具列表，因此接下来的请求会重新读取其前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了接缝何时单靠自身并不完整。它们是当前的包约束。

- **尚无提供方**——此构建中接缝没有 Service Provider、面向模型的工具、浏览器 Remote 或 Control Plane 网关；它们随 [Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md) 排定的各阶段交付到来。在此之前，什么都不挂载则每个操作都缺失。
- **仅限已保存图表**——这里没有任何东西运行调用方自己的查询、读取仪表盘，或覆盖图表的筛选、参数或排序。每一项都是权限目录尚未承载的独立授权决定。
- **每个范围一个项目**——范围命名一个项目或不命名，需要另一个项目的对话改变其范围而不是扩大它。
- **没有提供方注册表**——一个提供方挂载本服务，没有选择策略、可用性查询或提供方变更事件。第二种提供方类型需要这些，而 `BiProjectRef` 的语法为它留有余地。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：接缝不拥有注册表，也不观察自己的事件流；范围是对会话日志的折叠，`dsh-session` 已经维护该日志，而这项能力依赖的每个授权关系都在 Control Plane 而不在本进程中。
