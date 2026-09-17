---
description: "受治理 BI 网关接缝（ctx.biGateway）：管理员维护的持久项目目录，以及 Runner 触达的已授权目录、图表列表与图表执行。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-gateway

[English](README.md) | 中文

## 概述

`dsh-bi-gateway`（`ctx.biGateway`）是位于成员 Runner 与 BI 数据源之间的 Control Plane 服务——唯一决定主体可以触达哪些项目的一方。它由一个所有者服务两类受众：管理员读取并维护持久项目目录，Runner 读取已授权目录、列出一个项目的已保存图表并执行其中一张。两者都经由这里，因为目录与授权判定必须一致；一个展示了执行会拒绝的项目的目录，比两者单独存在更糟。导入它来编写网关提供方或消费一个。

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

Control Plane 组合挂载一个提供方，由它注册本服务；面向 Runner 的 HTTP 适配器与管理 API 随后调用它。

### 何时选用

导入它来编写网关提供方或消费一个。Control Plane 之外没有任何东西挂载它：Runner 经由 `ctx.bi` 触达 BI，其提供方通过 HTTP 转发给对每个操作做授权的网关。

### 最小配置

接缝没有配置。提供方的行提供部署会变化的一切：

```yaml
- name: '@deepseek-ai/dsh-bi-gateway-sqlite'
  config:
    path: /var/lib/dsh/control-plane/bi.sqlite
```

### 两类受众

管理方法——`sync`、`catalogView`、`setEnabled`——接受一个组织，因为调用它们的路由已经授权了管理员。面向成员的方法——`directory`、`charts`、`query`——接受从已校验访问令牌恢复的 `BiPrincipal`，并在每次调用时按项目自行授权。能在请求体里指名自己主体的调用方，等于在给自己授权。

授权从不随令牌缓存，因此撤销授权、停用项目、停用成员或吊销设备都在下一次调用时生效。

### 一种资源类型，两种含义

`BI_CATALOG_RESOURCE` 是代表目录本身的受治理资源，因此管理它的授权是对目录的授权，而不是对每个项目的授权。它与各项目共享 `BI_RESOURCE_TYPE`，这带来每个实现都必须处理的后果：`bi.query` 上的 `all` 模式类型授权也会准入它。因此每条面向成员的路径都枚举持久目录并关联到受管资源，永不枚举该类型的资源。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

没有任何面向成员的方法返回部分答案。无法授权的目录、被拒绝项目上的列表、项目之外图表的执行都会抛出，因为悄然收窄的结果对读取它的模型而言与正确结果无法区分。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `BiGateway` 服务定义、目录与主体词汇，以及受治理资源常量 |

### 数据模型

`BiCatalogEntry` 携带 `adminEnabled`，因为它是同步不得覆盖的策略选择；目录只保存数据源仍然列出的内容，因此没有第二个位表示项目是否还在。`effectiveEnabled` 是该选择与受治理资源自身状态的合取，因此被中断的写入读作已停用而非可用。`GovernedChartsRequest` 携带关键词与页码，因为收窄是网关的事，作用于数据源不索引的名称；`GovernedQueryRequest` 只携带行数上限，因为已保存图表按保存时的样子执行。

<a id="further-exploration"></a>
## 延伸阅读

- [BI 子系统](../../../docs/subsystems/bi.zh.md)——本网关所治理的词汇。
- [Team BI 分析 Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)——为何每个操作都在这里授权。

<a id="model-experience"></a>
## 模型体验

无，因为接缝运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了接缝何时单靠自身并不完整。它们是当前的包约束。

- **每个网关一个数据源**——接缝不命名数据源，因此一个 Control Plane 治理一个。多个数据源需要在目录和每个操作里加入数据源选择。
- **每个面向成员的操作都按执行评估**——`bi.query` 同时准入目录与列表，这是产品决定，而非因为这些操作相同。想把它们分开的部署需要授予第二个权限，并拆分提供方的动作常量。
- **退役的条目带走其授权**——成功列表不再命名的条目会被删除，而 `deleteResource` 会删除指名它的每条授权。因此答复部分列表的数据源会撤销管理员必须重新授予的访问；没有撤销操作，也没有宽限期。
- **管理方法在这里不做授权**——它们接受一个组织并信任调用方，因此忘了权限检查的路由也能到达它们。检查在路由里，其缺失是本接缝无法捕获的路由缺陷。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：接缝不拥有注册表，也不发布事件流；"所执行项目已为执行它的主体授权"这一事实位于提供方，即做出授权的那一方。
