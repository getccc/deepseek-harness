---
description: "Web GUI 的 /knowledge 选择器与 composer Chip：选择本次对话可检索的私有知识库；供使用私有知识库的成员与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-knowledge

[English](README.md) | 中文

## 概述

成员用这个包选择本次对话可以检索什么：`/knowledge` 列出其角色已授权的知识库，成员勾选本次对话要用的那些，再用一个控件一次性应用。选择是一条会话事件，因此 composer Chip、模型的提示词章节和一次回放读到的是同一个事实。默认不选任何知识库——新对话在有人明确选择之前不检索任何私有知识——而没有私有知识的构建根本不挂载这个插件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Team 装配中挂载本插件，宿主侧同时挂载 `api-knowledge-controller`；`/knowledge` 指令随即出现在 composer 的指令菜单中，Chip 出现在其工具行里。Team bundle 会挂载两者。

### 选择知识库

键入 `/knowledge` 打开多选选择器。勾选本身不改变任何东西：成员按下「应用」（或 ⌘/Ctrl+回车）时整组勾选才生效，只为本次对话记录一次选择。不勾选任何一项并应用即关闭私有知识，这也是每次对话的起点。

第一行**全部已授权知识库**不能与逐项勾选并存：它表示每次检索时该成员角色所授权的范围，包含之后新授权的知识库；而具名选择就是那几个知识库。其余行是 Control Plane 此刻答复的目录，因此被收回的授权会离开选择器，但不会改写对话已经记录的选择。

### 当已选知识库不再可用

目录中不再存在的已选知识库仍会列出，不勾选，并标注为已不可用。应用这组勾选会移除它——这是成员的明确动作，绝不是静默缩小。在此之前记录的选择保持不变，指名它的检索会失败，而不是悄悄返回更少的内容。

### composer Chip

Chip 读取本次对话的范围，显示`知识库：关闭`、`知识库：全部`或所选名称。它只报告不动作：`/knowledge` 是做出选择的唯一入口。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本插件自行挂载仅 Team 的 `knowledge` 远程命名空间，而不经由共享的 Client 装配，因为只有 Team 宿主提供它——否则没有私有知识的构建会多出一个每次调用都失败的命名空间。`src/client/scope.ts` 拥有勾选与记录范围之间的全部映射：`optionsOf` 依据 `knowledge.scope` 绘制行，`choiceOf` 把一组勾选读作 `off`、`all` 或具名选择，再由 `knowledge.choose` 记录。`/knowledge` 是注册在 `ctx.commandUi` 上的 `popupMultiSelect` 贡献项，其互斥首行就是「全部」选择背后的外壳机制。Chip 占据 composer 的 `conversation.input.left` 区域，经标准套件的 `useProjection` 读取宿主计算的 `knowledge` 投影；它不在客户端保存选择的副本。失败文案按错误面策略保持英文，并带上远程自己的 code。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

选择器不够用时阅读这些页面。它们从这个界面走向成员正在选择的知识本身。

- [dsh-tool-knowledge](../../knowledge/tool-knowledge/README.zh.md) —— 检索工具、提示词章节，以及本 Chip 读取的投影。
- [dsh-api-knowledge-controller](../../api/knowledge-controller/README.zh.md) —— 提供已授权目录并记录选择的远程命名空间。
- [ui-commands](../ui-commands/README.zh.md) —— 拥有多选弹窗外壳，以及本贡献项注册进去的指令表面。
- [知识包地图](../../knowledge/README.zh.md) —— 从选择器到上游知识来源的接缝。
- [客户端包地图](../README.zh.md) —— 相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由选择器写入的 `knowledge/scope` 事件：`dsh-tool-knowledge` 把该事件变成列出所选知识库的提示词章节，以及 `knowledge_search` 工具是否存在。本包没有任何文本进入请求。

#### KV 缓存影响

应用一次选择会改变 `knowledge:scope` 系统提示词章节以及检索工具是否注册，因此下一次请求的前缀与上一次不同，提供方前缀从该章节起失效。打开选择器与勾选行在按下「应用」前没有任何代价。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前的选择器。它们是当前的包约束，不是知识产品对比，也不是任务待办。

- **选择只存在于一次对话中** —— 没有跨对话记住的默认值，因此每次新对话都从关闭私有知识开始。
- **选择器不接受查询** —— `/knowledge` 只选择范围；检索是模型经 `knowledge_search` 完成的。
- **Chip 不能打开选择器** —— 它报告范围；更改要经指令行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景——点击展开</summary>

无。

</details>
