---
description: "私有知识服务（ctx.knowledge）：稳定知识引用、已授权目录与段落检索词汇、会话知识范围，以及封闭失败分类。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge

[English](README.md) | 中文

## 概述

`dsh-knowledge`（`ctx.knowledge`）是 Team Runner 向其索取已登录成员可触达的私有公司知识的接缝。它定义两个操作——读取经授权的目录、在其中搜索段落——外加 `KnowledgeRef`、`knowledge/scope` Session 事件与封闭的 `KnowledgeFailureReason` 集合。它不发起任何网络调用：由挂载的提供方发起，而在 Team Edition 中该提供方转发给对每个操作进行授权的 Control Plane。没有命名源或传递上游 id 的操作，因此持有该服务的插件仍然只能经由别处做出的决定触达知识源。

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

需要私有知识的组合挂载一个提供方，由它注册本服务；插件和工具作者随后调用 `ctx.knowledge.catalog()` 与 `ctx.knowledge.search()`。两个调用都不接受数据源、地址或凭据，因为这些都不由调用方选择。

### 何时选用

在实现知识提供方、面向模型的知识工具，或任何需要读取会话知识范围的东西时引入它。只想要既有行为的部署通过 Team profile 获得它即可。本服务不注册面向模型的工具，也不贡献自己的提示词：没有挂载提供方时，两个操作是不存在，而不是返回空。

### 最小配置

本服务没有配置——它是抽象接缝。随部署变化的东西由提供方配置项提供：

```yaml
- name: '@deepseek-ai/dsh-knowledge-team'
  config:
    controlPlaneUrl: https://dsh.example.com
```

### 命名一个知识库

`KnowledgeRef` 是 `<providerKind>:<sourceCode>:<upstreamId>`，也是唯一会离开 Control Plane 的知识标识符。用 `formatKnowledgeRef` 构造，用 `parseKnowledgeRef` 读回；后者返回 `undefined` 而不抛出，因为它的调用方是在决定是否接受一个值，而不是在诊断它。

该引用被限制为审计 token 字符集下的 64 个字符，这也是 `formatKnowledgeRef` 拒绝超过 19 个字符的数据源代码的原因。这不是风格上的上限：审计存储的 `resource_id` 遵循同一条规则，因此更长的引用会是任何操作都无法记录的引用。该失败因此落在构造引用的地方。

### 读取会话范围

`foldKnowledgeScope(events)` 从会话日志恢复当前范围，其 `end` 参数折叠一个前缀，使 rewind 和 fork 读到日志当时所说的内容。没有 `knowledge/scope` 事件的日志折叠为 `off`，也就是每个会话的起点。`selectionOf` 把范围转换成一次操作所携带的选择，对 `off` 返回 `undefined`，使调用方不去构造没人要的请求。

`all` 一路到 Control Plane 都保持为一个模式，而不是展开后的列表，因为展开它是一次授权行为：只有 Control Plane 知道主体当前持有什么。

### 失败

每个失败都是携带一个 `KnowledgeFailureReason` 的 `KnowledgeError`。产品界面在 `reason` 上分支并提供自己的本地化文本；任何上游响应体都不会到达其中任何一侧。`not-allowed` 有意同时覆盖未知引用与未授权引用，因此拒绝绝不向持有零权限的主体确认某个知识库存在。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

接缝命名产品操作，绝不命名上游操作。透传代理会让调用方选择权限目录和审计词汇未治理的操作，因此操作集合是固定且很小的，而且每个操作都是 Control Plane 能够依据当前状态授权的操作。

范围只存在于会话日志中。它两次到达模型——作为写出所选知识库的提示词文本，以及决定检索工具是否存在——因此把它记录在别处会使日志不足以重建模型看到过什么。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/brand.ts`](src/brand.ts) | `KnowledgeRef`、其语法，以及塑造它的审计 token 上界 |
| [`src/types.ts`](src/types.ts) | 目录、检索、范围和失败词汇 |
| [`src/scope.ts`](src/scope.ts) | `knowledge/scope` 会话事件、其折叠和其验证器 |
| [`src/index.ts`](src/index.ts) | `Knowledge` Service Definition |

### 数据模型

`KnowledgeBaseEntry` 是主体可以检索的东西，以可读方式命名。`KnowledgePassage` 携带产生它的引用，因此转录可以在不做第二次查找的情况下标注出处。`KnowledgeScope` 是版本化的可区分联合；其 `selected` 分支在每个引用旁记录一个显示名称，在选择的那一刻快照下来，因为模型可见的名字必须能从日志重建。

<a id="further-exploration"></a>
## 延伸阅读

- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 目录、检索、范围和失败契约的完整说明。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 知识为何始终经由 Control Plane，以及第一阶段不做什么。

<a id="model-experience"></a>
## 模型体验

间接影响，通过知识工具包：它向模型渲染段落并贡献范围提示词章节。本服务不贡献提示词，也不注册 schema。

#### KV Cache 影响

无直接失效。范围选择造成的请求前缀变化由具名消费方拥有，而这个变化是真实存在的：改变范围会同时改变一个提示词章节和工具列表，因此随后的请求会重读其前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本接缝自身在何处不完整。它们是当前的包约束。

- **没有文档全文阅读** —— 接缝只有目录和检索，没有任何返回文档正文的东西。阅读连同为其寻址的签名文档引用一起延后，权限目录在那之前保持 `knowledge.read` 不被授予（[Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md)）。
- **没有提供方注册表** —— 由一个提供方挂载本服务，不存在选择策略、可用性查询或提供方变更事件。第二种提供方类型会需要这些，而 `KnowledgeRef` 语法为此留了位置。
- **没有录入或修改** —— 这里没有任何东西创建、上传、编辑或删除知识。这些操作需要权限目录尚未承载的授权与审计决策。
- **范围无法表达排除** —— 范围要么收窄到具名知识库，要么是全部，没有「除某某之外」的分支，因为授权没有可与之组合的拒绝规则。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变量：**不发布伴随文件：该 seam 不拥有注册表，也不观察自己的事件流；范围是对 Session 日志的折叠，`dsh-session` 已经保证其一致，而本能力依赖的所有授权关系都在 Control Plane 而非本进程中。
