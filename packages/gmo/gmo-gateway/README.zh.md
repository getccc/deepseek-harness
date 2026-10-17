---
description: "受治理 GMO 网关接缝（ctx.gmoGateway）：持久的分类目录，以及位于上游数据源之前的已授权目录、结果列表、描述与提问。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-gateway

[English](README.md) | 中文

## 概述

`dsh-gmo-gateway`（`ctx.gmoGateway`）是站在成员 Runner 与 GMO 数据源之间的 Control Plane 服务，也是唯一决定主体可以触及哪些分类的一方。管理员读取并维护持久的分类目录；Runner 读取已授权目录、列出一个分类的结果、描述一份结果、向一份结果提问。授权在每个操作上询问，而不是随令牌缓存，因此撤销授权、停用分类、停用成员或吊销设备在下一次调用就生效。

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

Control Plane 组合挂载一个实现 `dsh-gmo-gateway-sqlite`，由它注册本服务；管理 API 调用 `sync`、`catalogView` 与 `setEnabled`，面向 Runner 的路由调用 `directory`、`results`、`describe` 与 `ask`。

### 本包导出什么

服务、资源类型 `gmo_category`、权限 `gmo.query`，以及代表目录本身的资源 `urn:dsh:admin:gmo-catalog`。目录与分类共用资源类型，所以每条面向成员的路径都枚举持久目录并按引用与受管资源关联，而不是列出该类型的资源：否则 `gmo.query` 上的"全部分类"授权会把目录资源当作一个分类放行。

### 谁在问

`GmoPrincipal` 携带组织、主体与设备，取自已验证的访问令牌，绝不取自请求体。每个面向成员的请求都扩展它。

### 新分类默认停用

`sync` 把数据源新列出的分类登记为停用。因此被授予"全部分类"的角色不会在数据源开始提供某条业务线的那一刻就自动获得它；管理员先启用，同步在任何方向上都不会覆盖这个选择。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

目录与决定只有一个所有者。目录展示了某个操作会拒绝的分类，或反过来，都比单独哪一个更糟，所以两者都放在这个服务之后。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `GmoGateway` 服务定义、目录与数据源状态类型，以及受治理的请求类型 |

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——网关用来回答的词汇。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——本服务执行的安全不变量。

<a id="model-experience"></a>
## 模型体验

无，因为网关运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了接缝何时单靠自身并不完整。它们是当前的包约束。

- **每个数据源一个目录**——目录与数据源状态假定只有一个已配置的数据源；多个数据源需要先在数据源接缝里有注册表。
- **仅逐分类授权**——被授予某分类的成员读取其中的全部结果；没有按结果或行级的决定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：服务不拥有注册表，也不发出事件；授权在每次调用时询问，实现的测试断言撤销会在下一次调用生效。
