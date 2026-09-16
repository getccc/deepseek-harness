---
description: "面向成员的知识面板：两个左侧导航行、已授权知识库列表，以及成员不经模型自行运行的检索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge-panels

[English](README.md) | 中文

## 概述

`dsh-client-ui-knowledge-panels` 是会话之外的私有知识：侧边栏新工作任务条目下方的两个行、已授权的知识库及其文档以及成员打开的那一份，还有成员自行运行并按排名阅读的检索。这里的检索不启动模型轮次、不消耗 token；到达模型的只有成员主动要的那一步——选中某条结果会打开一个收窄到该文档的会话，并把命中段落放进输入框。面板只在 Team 浏览器组合中挂载，与共享同一个 Remote 命名空间的 `/knowledge` 选择器并列。

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
| 知识库 | `knowledge` | 以卡片展示已授权的知识库（卡片带文档数量与创建日期）、成员打开的那一个之中的文档，以及在列表旁抽屉里展示的那一份文档 |
| 知识检索 | `knowledge-search` | 显示所选范围内的文档，在该范围上运行一次检索并按文档排名，并就成员选中的文档打开一次对话 |

两个行都注册到侧边栏的 `sidebar.panellist` 座位，并指向同名 id 的 `main` 面板，因此行归侧边栏所有，本包只拥有图标和面板。

### 成员如何在其中移动

是两个层级，不是分栏：先是卡片，再是该知识库的文档。上方的面包屑给出路径——路径止于知识库——其中较早的一段就是回到上一层的控件；回退会丢掉文档列表并关闭抽屉，因为两者都属于刚刚打开的那个知识库。一份文档在面板右侧的抽屉中打开，可通过它自己的控件、点击旁边的区域，或按 Escape 关闭。

文档卡片底部给出类型、大小与日期。状态只在不是常态时出现——解析中或不可检索——因为可检索的文档没什么要说的，而不可检索的文档若不标出，就与一次检索只是没把它排上来无从区分。

分页器固定在面板右下角。有总数时，它给出总数和至多七个页码位：首页、末页、当前页及其前后各一页，中间省去的部分用省略号表示；靠近两端时窗口滑向那一端，让分页器保持同一宽度。没有总数时，它只给出当前页，并在本页已满时提供下一页。

检索面板是一个搜索页：一个标题、一个带范围菜单与发送控件的查询框，以及它下方的内容。检索之前，下方是范围内的文档——每个知识库的第一页，跨知识库按最新在前排列，至多 30 份，每份带文件类型、知识源的摘要和所属知识库——因此没有问题的成员也能挑一份文档。列表读取失败的知识库会被略去；只有范围内每个列表都失败时才会提示。回车即检索（Shift+回车换行，输入法仍在组词时回车归它所有），答案替换文档：每份文档一张卡片，排在其最佳段落的名次上，前三名突出显示，段落里按空白分隔的查询词被标出，得分按提供方给出的值保留两位有效数字。更换范围会重新检索；清空查询会回到文档。

选中任何卡片——文档或结果——都会打开一个按标题收窄到这份文档的聊天，文档显示在空的 composer 上方。只显示提供方融合后的那一个得分：知识源没有单独返回可并列显示的词项或向量得分。

### 面板持有什么

两次读取之间什么都不持有，两个面板之间也不传递任何东西。目录在每次挂载时重新读取，文档列表按知识库和页码逐次读取，文档内容则按打开的每一份文档逐次读取，因此被撤销的授权会缩小成员看到的内容、被停用的知识库会从中消失；检索答案属于发起它的那次查询。

卡片上的数量与创建日期是 Control Plane 上次对账时记录的，不是实时读数：目录是一个授权答案，不会触及知识源。两者都不上报的部署会直接省掉卡片底部那一行，而不是显示 0 —— 比这两个字段更早的 Control Plane 就是这种情况。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

成员自行运行的检索有意不是会话事件。"模型可见的输入必须能从会话日志重建"这条规则，是范围选择得以持久化的原因；模型看不到的检索对日志不负任何义务，而记录它等于把成员的浏览行为写进一段对话的历史。发生改变的时刻是结果打开的那场讨论，它通过与 `/knowledge` 相同的 Remote 记录同一个 `knowledge/scope` 事件。

排名是提供方的。面板把段落按所属文档分组，并原样展示得分，既不重排也不归一化：这个数字只在一次答案内部可比，而在这里给出第二种意见，会让它看起来像成员可以跨查询比较的东西。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 两个行、两个面板，以及它们背后的 Remote 调用 |
| [`src/client/KnowledgeBasesPanel.tsx`](src/client/KnowledgeBasesPanel.tsx) | 知识库卡片、面包屑、文档卡片，以及抽屉 |
| [`src/client/DocumentPreview.tsx`](src/client/DocumentPreview.tsx) | 一份文档，按 Control Plane 所提供的内容绘制 |
| [`src/client/KnowledgeSearchPanel.tsx`](src/client/KnowledgeSearchPanel.tsx) | 查询框与范围菜单、检索前的文档，以及排名后的答案 |
| [`src/client/results.ts`](src/client/results.ts) | 把段落按文档分组、得分如何书写，以及查询标出哪些文本 |
| [`src/client/documents.ts`](src/client/documents.ts) | 文档如何命名与标注日期，以及多个列表如何合成一个信息流 |
| [`src/client/Pager.tsx`](src/client/Pager.tsx) | 文档列表的分页器 |
| [`src/client/paging.ts`](src/client/paging.ts) | 总数跨多少页，以及分页器给出哪些页码 |

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-client-ui-knowledge](../ui-knowledge/README.zh.md) —— `/knowledge` 选择器与输入框 chip，以及这些面板等待的命名空间挂载。
- [dsh-api-knowledge-controller](../../api/knowledge-controller/README.zh.md) —— 面板调用的 Remote 方法。
- [成员知识浏览 Agent Note](../../../.agents/notes/proposed/feature/2026-09-16-member-knowledge-browsing-and-retrieval.zh.md) —— 为什么面板是全局的，以及后续阶段新增什么。

<a id="model-experience"></a>
## 模型体验

间接影响，经由 `dsh-tool-knowledge`：在这两个面板中运行的检索不到达模型，而选中结果所记录的收窄到文档的范围，正是它的提示词段落说出并据以开放搜索工具的那个范围。

#### KV 缓存影响

没有直接失效。讨论会打开新会话，因此没有可失效的前缀；它记录的范围属于该会话的第一次请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了面板自身何时不完整。它们是当前的包级约束。

- **Office 文件不在这里绘制** —— 抽屉绘制的是浏览器仅凭字节就能绘制的东西：PDF、图片、任何属于文本的内容，以及 Control Plane 回落到的解析文本。`.docx`、`.xlsx` 或 `.pptx` 会以字节到达，并显示为「这里还不能显示」，因为这些格式的渲染器位于右侧 Sidebar 那个按会话划分的文档槽之后，而这个面板没有会话。
- **文档列表一次一页** —— 知识库内没有搜索、没有排序、也没有文件夹树，因此要在成千上万份文档里找到一份，只能一页页翻过去。
- **预览每次重新读取，从不保留** —— 同一份文档打开两次就读取两次，面板之间和刷新之间都不缓存。对一份每次调用都要重新判定授权的文件，这是有意为之。
- **文档以标题标识** —— 段落尚未携带文档引用，因此同一知识库中标题相同的两份文档会合并为同一条结果。
- **没有说出文档的结果只能以知识库为范围讨论** —— 本次构建无法为其寻址来源的段落，只能把会话收窄到它的知识库，这也是这类结果所支持的最窄范围。
- **没有变更通知** —— 一直开着的面板不会得知授权发生了变化；它会在下次打开时看到收窄后的目录。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

`knowledge` Remote 命名空间每个 Client 只挂载一次，由 `dsh-client-ui-knowledge` 挂载。本插件注入 `remote.knowledge` 且从不挂载它：第二次挂载会因命名空间冲突被拒绝，而竞争失败的那个插件会因此下线。

</details>

**运行时不变量：** 不发布伴随包：本包拥有的每条关系都在同名 id 的行与面板之间，而槽注册表本就不允许破坏它；面板也不持有任何第二次观察可能与之不一致的状态。
