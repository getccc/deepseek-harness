---
description: "仅 Team 的知识 Remote：浏览器读取的已授权目录，以及它记录的会话范围选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-knowledge-controller

[English](README.md) | 中文

## 概述

`dsh-api-knowledge-controller` 是 `/knowledge` 选择器的 Host 那一半：它回答成员可以检索什么，并记录他们选了什么。浏览器自己够不到 `ctx.knowledge`——该服务位于 Host，而持有设备 Token 的是它的提供方——因此选择器来问这里。它是独立的包而不是 session controller 上的更多接口面，因为知识只属于 Team：没有知识的组合不挂载它；而一个容忍服务缺席的 controller 只能报告空目录，那读起来像「你什么权限都没有」。

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

在已挂载知识提供方的组合中挂载它；它注册 `knowledge` Remote 命名空间。

### 最小配置

本 controller 没有配置。

```yaml
- name: '@deepseek-ai/dsh-knowledge-team'
  config:
    controlPlaneUrl: https://dsh.company.com
- name: '@deepseek-ai/dsh-api-knowledge-controller'
```

### 两个方法

`scope(sessionId)` 回答某个会话可以从什么中选择、它选了什么，以及它已选引用中哪些已不在已授权目录里。`choose(sessionId, mode, knowledgeRefs?)` 记录选择并回答同样的视图。

目录在每次调用时重新读取而不缓存：上次查看之后被撤销的授权应当让选择器变窄，管理员停用的知识库应当从中消失。

### 选择为何携带名字

范围事件在每个引用旁记录一个显示名称，因为提示词会写出所选知识库，而模型可见的名字必须能从会话日志重建。名字取自做出选择那一刻的目录。

这也是目录中不存在的引用被拒绝而不是被记录的原因。Control Plane 在检索时本来也会拒绝它，而记录它等于在日志里放进一个任何检索都无法兑现的名字。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

这里不做任何授权。本 controller 提供的目录，是 Control Plane 已经按成员持有的权限收窄过的；而基于已记录选择的检索会被再次单独授权。它拥有的是成员意图与日志所述之间的差异——这正是陈旧选择被报告而不是被静默收窄的原因。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `knowledge` Remote 命名空间、其请求校验和范围投影 |

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-client-ui-knowledge](../../client/ui-knowledge/README.zh.md) —— 本命名空间服务的选择器与 Chip。
- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 本包记录的范围值。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 范围为何存在于会话日志中。

<a id="model-experience"></a>
## 模型体验

间接影响，通过 `dsh-tool-knowledge`：本包记录的范围决定它的提示词章节写出什么，也决定它的工具是否被提供。本 controller 不贡献提示词，也不注册 schema。

#### KV Cache 影响

无直接失效，但一次已记录的选择会造成失效：具名消费方的提示词章节和工具列表都会改变，因此随后的请求会重读其前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本 controller 自身在何处不完整。它们是当前的包约束。

- **选择需要一个活跃会话** —— 两个方法都按会话 id 解析 agent，没有活跃 agent 时拒绝，因此无法为一个没在运行的会话设置范围。
- **没有变更通知** —— 已打开选择器的浏览器不会得知授权发生了变化；它在下次打开时看到收窄后的目录。
- **没有逐次选择的审计** —— 记录范围只写会话事件。成员检索了哪些知识库由 Control Plane 在检索时审计，判定发生在那里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变量：**不发布伴随文件：controller 在调用之间不持有任何状态，也不拥有注册表；记录的范围只引用成员选择时可检索的知识库，这一点在 `choose` 内对同一次调用读取的目录强制执行，并由本包测试断言。
