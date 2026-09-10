---
description: "上游知识源接缝（ctx.knowledgeSource）：列出数据源持有的知识库，并检索一个显式且已授权的知识库集合。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-source

[English](README.md) | 中文

## 概述

`dsh-knowledge-source`（`ctx.knowledgeSource`）是受治理的知识网关用来与上游知识产品对话的接缝。它有两个操作——列出数据源持有的内容、检索其中一个显式的知识库集合——而且两者都以上游术语表达：用上游 id 而非 `KnowledgeRef`，因为两者之间的映射是目录的职责。它只挂载在 Control Plane，绝不挂载在 Runner。为某个知识产品编写提供方、或从网关消费提供方时引入它。本接缝没有任何操作接受 URL、调用方自选请求头或任意上游路径，因此它前面的网关无法被诱导去执行权限目录未治理的操作。

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

Control Plane 组合挂载一个提供方，由它注册本服务；受治理网关随后调用 `ctx.knowledgeSource.list()` 与 `ctx.knowledgeSource.search()`。

### 何时选用

在为某个知识产品编写提供方、或消费一个提供方时引入它。Runner 绝不挂载它：这个拆分的全部意义就在于，持有成员会话的进程不持有任何知识凭据。

### 最小配置

接缝没有配置。随部署变化的东西由提供方配置项提供：

```yaml
- name: '@deepseek-ai/dsh-knowledge-weknora'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8080
    credentialRef: WEKNORA_API_KEY
```

### 提供方欠网关什么

`providerKind` 和 `sourceCode` 是目录从该数据源铸造的每个 `KnowledgeRef` 的前两个分段。类型是提供方的常量，因为它命名的是说这套协议的代码；数据源代码是配置，因为一家公司的 `prod` 是另一家的 `kb`。

`search` 收到一个显式的、已授权的上游 id 集合，绝不能扩大它。空集合不是「检索全部」的请求：把它当作全部的提供方会去检索自己配置所指向的任何东西，而这正是请求能够触及无人授权的知识库的唯一途径。

失败以 `KnowledgeError` 抛出，理由为 `upstream-unavailable` 或 `upstream-invalid`。提供方绝不抛出授权类理由——它不知道是谁在问，这正是要点。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

两个接缝而不是一个。面向 Runner 的 `ctx.knowledge` 命名成员想要什么；这一个命名数据源能做什么。把它们分开，才使夹在中间的网关成为唯一把受治理引用映射到上游 id 的一方，也是唯一判定它是否可以这样做的一方。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `KnowledgeSource` Service Definition 及其上游词汇 |

### 数据模型

`UpstreamKnowledgeBase` 携带管理员会读的计数，外加 `embeddingModelId`——目录记录它，是因为多库检索只对共享同一模型的知识库有定义。`UpstreamPassage` 携带产生它的上游 id，使网关能把每条命中映射回受治理引用，并证明它授权过该知识库。

<a id="further-exploration"></a>
## 延伸阅读

- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 本接缝供给的受治理词汇。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 凭据为何留在 Control Plane。

<a id="model-experience"></a>
## 模型体验

无，因为本接缝运行在 Control Plane，而 Control Plane 不挂载 agent 也不挂载工具注册表，模型永远到不了它。

#### KV Cache 影响

这里不会改变任何请求前缀；受治理结果在 Runner 侧的消费方拥有会改变前缀的那些变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本接缝自身在何处不完整。它们是当前的包约束。

- **没有文档阅读** —— 数据源可以被列出和检索，但没有任何东西返回文档全文。该操作随为其寻址的签名文档引用一起到来。
- **没有提供方注册表** —— 由一个提供方挂载本服务。一个 Control Plane 中的多个数据源会需要注册表和选择策略；`KnowledgeRef` 的数据源代码分段为此留了位置，但目前没有任何东西使用该位置。
- **没有录入或修改** —— 这里没有任何东西创建、上传、编辑或删除上游知识。
- **没有增量列表** —— `list()` 返回数据源持有的全部内容，没有分页也没有变更游标。持有成千上万个知识库的数据源会需要它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变量：**不发布伴随文件：该 seam 不拥有注册表，也不发布事件流；provider 自身的边界在每次调用时强制执行，被检索知识库的授权属于做出授权的 gateway。
