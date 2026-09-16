---
description: "面向成员的知识面板：两个左侧导航行、已授权知识库列表，以及成员不经模型自行运行的检索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-panels

[English](README.md) | 中文

## 概述

`dsh-client-ui-knowledge-panels` 是会话之外的私有知识：侧边栏新工作任务条目下方的两个行、成员角色已授权的知识库列表，以及成员自行运行并按排名阅读的检索。这里的检索不启动模型轮次、不消耗 token；到达模型的只有成员主动要的那一步——选中某条结果会打开一个以该文档所属知识库为范围的会话，并把命中段落放进输入框。面板只在 Team 浏览器组合中挂载，与共享同一个 Remote 命名空间的 `/knowledge` 选择器并列。

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

把它挂载在已经挂载 `@deepseek-ai/dsh-client-ui-knowledge` 的组合中——后者的浏览器半边挂载了这些面板调用的 `knowledge` Remote 命名空间。

### 最小配置

本插件没有配置项。

```yaml
- name: '@deepseek-ai/dsh-api-knowledge-controller'
- name: '@deepseek-ai/dsh-client-ui-knowledge'
- name: '@deepseek-ai/dsh-client-ui-knowledge-panels'
```

### 成员能进入什么

| 行 | 面板 | 作用 |
|---|---|---|
| 知识库 | `knowledge` | 列出已授权的知识库，每条带描述和一个检索该知识库的操作 |
| 知识库检索 | `knowledge-search` | 在所选知识库上运行一次检索，并把段落按所属文档分组排名 |

两个行都注册到侧边栏的 `sidebar.panellist` 座位，并指向同名 id 的 `main` 面板，因此行归侧边栏所有，本包只拥有图标和面板。

### 面板持有什么

两次读取之间什么都不持有。目录在每次挂载时重新读取，因此被撤销的授权会缩小列表、被停用的知识库会从中消失；检索答案属于发起它的那次查询。跨两个面板的唯一值，是列表面板请求检索面板从哪个知识库开始，而检索面板只在自己的目录读取仍然包含该知识库时保留它。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

成员自行运行的检索有意不是会话事件。"模型可见的输入必须能从会话日志重建"这条规则，是范围选择得以持久化的原因；模型看不到的检索对日志不负任何义务，而记录它等于把成员的浏览行为写进一段对话的历史。发生改变的时刻是结果打开的那场讨论，它通过与 `/knowledge` 相同的 Remote 记录同一个 `knowledge/scope` 事件。

排名是提供方的。面板把段落按所属文档分组，并原样展示得分，既不重排也不归一化：这个数字只在一次答案内部可比，而在这里给出第二种意见，会让它看起来像成员可以跨查询比较的东西。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 两个行、两个面板，以及它们背后的 Remote 调用 |
| [`src/client/KnowledgeBasesPanel.tsx`](src/client/KnowledgeBasesPanel.tsx) | 已授权知识库列表 |
| [`src/client/KnowledgeSearchPanel.tsx`](src/client/KnowledgeSearchPanel.tsx) | 范围 chip、查询框和排名结果 |
| [`src/client/results.ts`](src/client/results.ts) | 把段落按文档分组，以及得分如何书写 |

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-client-ui-knowledge](../ui-knowledge/README.zh.md) —— `/knowledge` 选择器与输入框 chip，以及这些面板等待的命名空间挂载。
- [dsh-api-knowledge-controller](../../api/knowledge-controller/README.zh.md) —— 面板调用的 Remote 方法。
- [成员知识浏览 Agent Note](../../../.agents/notes/proposed/feature/2026-09-16-member-knowledge-browsing-and-retrieval.zh.md) —— 为什么面板是全局的，以及后续阶段新增什么。

<a id="model-experience"></a>
## 模型体验

间接影响，经由 `dsh-tool-knowledge`：在这两个面板中运行的检索不到达模型，而选中结果所记录的范围，正是它的提示词段落说出并据以开放搜索工具的那个范围。

#### KV 缓存影响

没有直接失效。讨论会打开新会话，因此没有可失效的前缀；它记录的范围属于该会话的第一次请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了面板自身何时不完整。它们是当前的包级约束。

- **知识库只是一个名字，不是它的内容** —— 列表面板展示成员可以检索什么，到此为止。列出其中的文档需要一个尚不存在的 Control Plane 操作。
- **文档打不开** —— 结果会说出文档名并引用一段原文；在文档内容能力交付之前，没有可点进去的东西。
- **文档以标题标识** —— 段落尚未携带文档引用，因此同一知识库中标题相同的两份文档会合并为同一条结果。
- **讨论以知识库为范围，而不是以文档为范围** —— 会话范围还没有文档级形态，因此从结果打开的会话也可能检索到该知识库的其余部分。
- **没有变更通知** —— 一直开着的面板不会得知授权发生了变化；它会在下次打开时看到收窄后的目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

`knowledge` Remote 命名空间每个 Client 只挂载一次，由 `dsh-client-ui-knowledge` 挂载。本插件注入 `remote.knowledge` 且从不挂载它：第二次挂载会因命名空间冲突被拒绝，而竞争失败的那个插件会因此下线。

</details>

**运行时不变量：** 不发布伴随包：本包拥有的每条关系都在同名 id 的行与面板之间，而槽注册表本就不允许破坏它；面板也不持有任何第二次观察可能与之不一致的状态。
