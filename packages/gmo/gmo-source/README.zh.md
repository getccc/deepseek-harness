---
description: "上游 GMO 数据源接缝（ctx.gmoSource）：以上游术语列出数据源的分类与某个分类的结果、定位并描述一份结果，以及向一份已授权的结果提问。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-source

[English](README.md) | 中文

## 概述

`dsh-gmo-source`（`ctx.gmoSource`）是受治理 GMO 网关用来与上游 GMO供应链服务对话的接缝。它的操作——列出数据源的分类、列出一个分类的结果、定位一份结果所属的分类、描述一份结果、向一份结果提问——都用上游 id 而非 `GmoCategoryRef` 表达，因为两者之间的映射是目录的职责。它只挂载在 Control Plane。没有任何操作接受 URL、header 或调用方自己的语句，因此位于其前的网关触及不到权限目录不治理的操作。

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

Control Plane 组合挂载一个提供方，由它注册本服务；受治理网关随后调用 `ctx.gmoSource.listCategories()`、`listResults()`、`placeResult()`、`describeResult()` 与 `ask()`。

### 何时选用

要为某个 GMO 数据源编写提供方，或消费一个提供方时导入它。Runner 永远不挂载它：拆分的意义就在于持有成员会话的进程不持有任何数据源凭据。

### 最小配置

接缝没有配置。部署会变化的内容由提供方的行提供：

```yaml
- name: '@deepseek-ai/dsh-gmo-excel-tools'
  config:
    sourceCode: gmo
    baseUrl: http://10.1.120.90:8700
    credentialRef: EXCEL_TOOLS_GATEWAY_TOKEN
```

### 提供方对网关的义务

`providerKind` 与 `sourceCode` 是目录从该数据源铸造的每个 `GmoCategoryRef` 的前两段。类型是提供方的常量，因为它命名说该协议的代码；数据源代码是配置，因为一家公司的 `prod` 是另一家的 `gmo`。

`listCategories` 只回答受治理引用语法接受的键，`listResults` 与每个描述只回答结果引用接受的结果 id，含有其他内容的行以 `upstream-invalid` 拒绝；这正是网关无需第二道防护就能铸造引用的原因。`placeResult` 廉价地回答数据源声明持有某份结果的分类，不读取任何数字，网关在提出任何问题之前先授权它。`describeResult` 与 `ask` 收到的是网关已授权、数据源也已认可的分类，每个答案都说明数据源把它归到哪个分类，让网关能再次核对。

失败以携带 `upstream-unavailable`、`upstream-invalid`、`result-unavailable`、`unsupported`、`invalid-query` 或 `too-large` 的 `GmoError` 抛出。提供方绝不抛出授权类原因——它不知道谁在问，这正是关键。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

两个接缝而非一个。面向 Runner 的 `ctx.gmo` 命名成员想要什么；这个接缝命名数据源能做什么。把它们分开，才能让两者之间的网关成为唯一把受治理引用映射到上游 id 的一方，也是唯一决定是否允许的一方。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `GmoSource` 服务定义及其上游词汇 |

### 数据模型

`UpstreamCategory` 携带数据源对分类的称呼，以及（若它说明）分类持有的结果数。`UpstreamResult` 携带一份结果的名称、工具、期间、行数、创建时间，以及多步结果的各个步骤，每一步都可单独寻址。`UpstreamDescription` 是不含受治理引用的域描述，加上上游 id。`UpstreamAnswer` 是数据源的有界 JSON，已去掉它自己的簿记字段，并带上它所指名的分类。

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——本接缝所供给的受治理词汇。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——凭据为何留在 Control Plane。

<a id="model-experience"></a>
## 模型体验

无，因为接缝运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了接缝何时单靠自身并不完整。它们是当前的包约束。

- **每次提问读两次**——`placeResult` 回答结果在哪，供网关授权；`ask` 再对该分类执行。两者各自正确，互不信任对方的副本。
- **没有提供方注册表**——一个提供方挂载本服务。一个 Control Plane 里的多个数据源需要注册表与选择策略；引用里的数据源代码段为此留有余地，但尚无消费者。
- **只接受封闭词汇的提问**——这里没有任何东西运行调用方自己的语句。
- **列表一次一页**——一个分类的结果由调用方翻页，数据源报告总数，没有变更游标。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：接缝不拥有注册表，也不发布事件流；提供方自己的上界在每次调用时施加，而对提问的授权属于网关，即做出授权的那一方。
