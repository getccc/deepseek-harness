---
description: "受治理知识网关接缝（ctx.knowledgeGateway）：管理员维护的持久化目录，以及 Runner 访问的已授权目录与检索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-gateway

[English](README.md) | 中文

## 概述

`dsh-knowledge-gateway`（`ctx.knowledgeGateway`）是站在成员 Runner 与知识源之间的 Control Plane 服务——唯一判定主体可以访问哪些知识库的一方。它由同一个所有者服务两类受众：管理员读取并维护持久化目录，Runner 读取已授权目录并在其中检索。两者都经由这里，因为目录与授权判定必须一致；一个展示了检索会拒绝的知识库的目录，比两者中任何一个单独出错都更糟。为编写网关提供方、或从 HTTP 适配器与管理路由消费网关时引入它。

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

Control Plane 组合挂载一个提供方，由它注册本服务；面向 Runner 的 HTTP 适配器和管理 API 随后调用它。

### 何时选用

在编写网关提供方或消费网关时引入它。Control Plane 之外没有任何东西挂载它：Runner 通过 `ctx.knowledge` 访问知识，其提供方经 HTTP 转发到一个对每个操作做授权判定的网关。

### 最小配置

接缝没有配置。随部署变化的东西由提供方配置项提供：

```yaml
- name: '@deepseek-ai/dsh-knowledge-gateway-sqlite'
  config:
    path: /var/lib/dsh/control-plane/knowledge.sqlite
```

### 两类受众

管理方法——`sync`、`catalogView`、`setEnabled`——接受一个组织，因为调用它们的路由已经对管理员做过授权。面向成员的方法——`directory`、`search`——接受一个从已验证 Access Token 恢复出的 `KnowledgePrincipal`，并在每次调用时逐知识库自行判定。能在请求体里指名自己主体的调用方，等于在给自己授权。

授权绝不随 Token 缓存，因此撤销授权、停用知识库、停用成员和撤销设备都在下一次调用生效。

### 一个资源类型，两种含义

`KNOWLEDGE_CATALOG_RESOURCE` 是代表目录本身的受治理资源，因此管理它的授权是对目录的授权，而不是对每个知识库的授权。它与知识库共用 `KNOWLEDGE_RESOURCE_TYPE`，这带来一个每个实现都必须应对的后果：`knowledge.search` 上的 `all` 模式类型授权会连它一起放行。因此每条面向成员的路径都枚举持久化目录并与受治理资源做 join，绝不枚举该类型的资源。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

两个面向成员的方法都不返回部分答案。无法完成授权的目录和范围被拒的检索都会抛出，因为对读到它的模型而言，被悄悄收窄的结果与正确结果无法区分。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `KnowledgeGateway` Service Definition、目录与主体词汇，以及两个受治理资源常量 |

### 数据模型

`KnowledgeCatalogEntry` 携带 `adminEnabled`，因为它是同步不得覆盖的策略选择；目录只保留数据源仍在列出的条目，因此不再有第二个位来表示知识库是否还在。`effectiveEnabled` 是该选择与受治理资源自身状态的合取，因此中断的写入读作已停用，而不是可用。携带 `embeddingModelId` 是因为跨不共享同一模型的知识库的检索会被拒绝，而管理员否则看不到原因。

<a id="further-exploration"></a>
## 延伸阅读

- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 本网关所治理的词汇。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 每个操作为何在这里做授权判定。

<a id="model-experience"></a>
## 模型体验

无，因为本接缝运行在 Control Plane，而 Control Plane 不挂载 agent 也不挂载工具注册表，模型永远到不了它。

#### KV Cache 影响

这里不会改变任何请求前缀；受治理结果在 Runner 侧的消费方拥有会改变前缀的那些变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本接缝自身在何处不完整。它们是当前的包约束。

- **一个网关一个数据源** —— 接缝不指名数据源，因此一个 Control Plane 治理一个。多个数据源会需要在目录和每个操作中加入数据源选择。
- **没有文档阅读** —— 目录与检索就是面向成员的全部接口面；在阅读文档全文交付之前 `knowledge.read` 保持不被授予。
- **退役条目会带走它的授权** —— 一次成功列表不再指名的条目会被删除，而 `deleteResource` 会删除所有指名它的授权。因此数据源返回不完整列表时会撤销访问权，需要管理员重新授予；没有撤销操作，也没有宽限期。
- **管理方法在这里不做授权** —— 它们接受一个组织并信任调用方，因此忘记权限检查的路由能够到达它们。该检查位于路由中，而它的缺失是本接缝无法捕捉的路由缺陷。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
