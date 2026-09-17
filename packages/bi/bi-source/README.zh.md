---
description: "上游 BI 数据源接缝（ctx.biSource）：以上游术语列出数据源的项目与某个项目的已保存图表、定位图表所属项目，以及执行一张已授权的图表。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-source

[English](README.md) | 中文

## 概述

`dsh-bi-source`（`ctx.biSource`）是受治理 BI 网关用来与上游 BI 产品对话的接缝。它的操作——列出数据源的项目、列出一个项目的已保存图表、定位一张图表所属的项目、按保存时的样子执行一张图表——都用上游 id 而非 `BiProjectRef` 表达，因为两者之间的映射是目录的职责。它只挂载在 Control Plane。没有任何操作接受 URL、header、筛选、参数或调用方自己的查询，因此位于其前的网关触及不到权限目录不治理的操作。

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

Control Plane 组合挂载一个提供方，由它注册本服务；受治理网关随后调用 `ctx.biSource.listProjects()`、`ctx.biSource.listCharts()`、`ctx.biSource.describeChart()` 与 `ctx.biSource.runChart()`。

### 何时选用

要为某个 BI 产品编写提供方，或消费一个提供方时导入它。Runner 永远不挂载它：拆分的全部意义就在于持有成员会话的进程不持有任何 BI 凭据。

### 最小配置

接缝没有配置。提供方的行提供部署会变化的一切：

```yaml
- name: '@deepseek-ai/dsh-bi-webi'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8100
    credentialRef: WEBI_API_KEY
```

### 提供方对网关的义务

`providerKind` 与 `sourceCode` 是目录从该数据源铸造的每个 `BiProjectRef` 的前两段。类型是提供方的常量，因为它命名说该协议的代码；数据源代码是配置，因为一家公司的 `prod` 是另一家的 `bi`。

`listProjects` 只回答受治理引用语法接受的 id，`listCharts` 只回答图表引用接受的图表 id——在 `BI_CHART_ID_MAX_LENGTH` 之内、在引用字符集之上——含有其他内容的行以 `upstream-invalid` 拒绝。这正是网关能直接从它们铸造引用而无需第二道防护的原因。图表列表是整体而非分页，因为成员用来收窄的关键词由网关在数据源不索引的名称上施加；提供方会说明自己的上界是否截短了列表。

`describeChart` 回答数据源声明持有该图表的项目，网关在执行任何东西之前先授权它。`runChart` 收到的是网关已授权、数据源也已认可的项目，并按保存时的样子执行图表：它只接受行数上限，别无其他。

失败以携带 `upstream-unavailable`、`upstream-invalid`、`chart-unavailable` 或 `query-failed` 的 `BiError` 抛出。提供方绝不抛出授权类原因——它不知道谁在问，这正是关键。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

两个接缝而非一个。面向 Runner 的 `ctx.bi` 命名成员想要什么；这个接缝命名数据源能做什么。把它们分开，才能让两者之间的网关成为唯一把受治理引用映射到上游 id 的一方，也是唯一决定是否允许的一方。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `BiSource` 服务定义及其上游词汇 |

### 数据模型

`UpstreamProject` 携带数据源自己对项目类型与仓库的称呼，目录为管理员记录它们。`UpstreamChart` 以封闭的 `BiChartKind` 词汇携带图表所绘图形的类型，让列表与执行对此一致。`UpstreamRun` 已经是网关原样转发的形式——按行顺序的字段、文本形式的已保存筛选、原始单元格和两个截断位——因为执行结果没有任何部分需要网关重新解读。

<a id="further-exploration"></a>
## 延伸阅读

- [BI 子系统](../../../docs/subsystems/bi.zh.md)——本接缝所供给的受治理词汇。
- [Team BI 分析 Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)——凭据为何留在 Control Plane。

<a id="model-experience"></a>
## 模型体验

无，因为接缝运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了接缝何时单靠自身并不完整。它们是当前的包约束。

- **每次执行读两次记录**——`describeChart` 回答图表在哪，供网关授权；`runChart` 再对该项目发起执行。两者各自正确，互不信任对方的副本；在意第二次调用的部署得改为把图表记录跨接缝传递。
- **没有提供方注册表**——一个提供方挂载本服务。一个 Control Plane 里的多个数据源需要注册表与选择策略；`BiProjectRef` 的数据源代码段为此留有余地，但尚无消费者。
- **仅限已保存图表**——这里没有任何东西运行调用方自己的查询、读取仪表盘，或覆盖图表的筛选、参数或排序。
- **没有增量列表**——`listProjects()` 返回数据源持有的每个项目，`listCharts()` 返回一个项目在提供方上界之内的每张图表，没有分页或变更游标。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：接缝不拥有注册表，也不发布事件流；提供方自己的上界在每次调用时施加，而对所执行项目的授权属于网关，即做出授权的那一方。
