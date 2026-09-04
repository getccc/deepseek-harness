---
description: "Web GUI 的产出文件与可点击文件引用：已完成轮次末尾的文档卡片与标签行、其他插件用来教会一个工具的服务，以及收尾正文中的行内代码链接；供产出物体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deliverables

[English](README.md) | 中文

## 概述

本包渲染已完成轮次末尾的产出物——本轮交回的每份文档各一张卡片，修改工具创建或修改的其他文件排成一行标签——并把收尾正文中匹配的行内代码引用转为链接，让被点名的文件经工作区打开器打开。词表来自修改工具自身的参数，以及其他插件通过 `ctx.deliverables` 教会它的工具，而非收尾正文——无论模型是否记得点名，产出文件都会被列出。正式提供的组合中只有 Web patch 加载本包；删除其 cordis.yml 条目会同时移除指引、卡片、标签、服务与正文链接。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与 `ui-conversation` 一起挂载本插件；已完成轮次随即以产出文件收尾，位于收尾消息正文与其动作页脚之间。每张卡片和每个标签项都经 `ctx.workspaces.openPath`——浏览器唯一的文件打开入口——打开文件，相对路径按会话 cwd 解析；包装了该入口的侧栏插件会在自己的预览中展示文件，而不是交给 Host。标签行首次显示时会查询 `session.canOpenWorkspacePath()`，只有页面为 loopback 且查询成功返回 `true` 时，**在文件夹中显示**动作才会打开会话工作区。

### 文档卡片

本轮产出的 `.md`、`.docx`、`.xlsx`、`.csv`、`.pptx` 或 `.pdf` 文件是一张卡片：以扩展名标出文档类别的色块、文件名与路径。卡片叠放在标签行上方，因为读者扫视的是文档名；只产出文档的轮次根本不显示标签行。

### 该行

该行列出其余每个产出文件，并展示能放下的最大前缀——至多六个标签项，文本为文件名、完整路径作为 `title`——并为本地化后的精确 `+ N 个文件` 宽度预留空间，因此剩余计数始终可见，既不换行也不横向滚动。

### 教会该行一个工具

若插件的工具在 `write`、`edit` 与 `str_replace_editor` 之外写文件，它调用 `ctx.deliverables.recognize({ tool, path })`：`tool` 是线上工具名，`path` 从一次调用已解析的参数中读出产出路径，或回答 null。此后每次成功调用都会像第一方 `write` 一样列出该路径，进行中的对话会带着刚学会的工具重新折叠，返回的 disposer 则让它遗忘。一个工具只教一次——第一方集合与已教会的工具都拒绝第二位教师。`dsh-client-ui-office` 教会它 `univer_export`，其 `output` 指明办公工具交回的文档。

### 行内代码链接

收尾正文承载同一份词表：行内代码 token 按精确路径解析，或当它恰好等于某条产出路径的 basename 且该路径唯一时解析——两条路径共享同一 basename 时保持惰性而不猜测，因此提及绝不打开错误的文件。解析成功的提及保留代码标签，并采用 Markdown 样式表的链接样式，完整路径作为其 `title`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Node 半部注册静态 `ui:deliverable-file-references` 系统提示词段，要求模型点名成功创建或修改的主要文件，并把这些文件以及正文中提到的其他本轮变更文件写成 Markdown 行内代码。浏览器半部把 `ProducedFiles` 以 `TURN_TAIL_PRIORITY`（`-10`）注册进 chat 视图的 `conversation.chat.turnTail` 洞，低于默认序，也低于侧栏插件以 `-1` 注册的同款行，因此成员看到的是卡片，而每次点击仍经由该插件包装的工作区打开器离开。`createDeliverablesDefinition(recognizers)` 根据 `write`、`edit` 和有修改作用的 `str_replace_editor` 命令中经过校验的原始参数，以及被教会工具的识别器，把每个轮次成功的修改调用折叠进 `DeliverablesTurnData`；识别器集合一变化，插件就重新注册该 Definition，从而重建任何进行中的装配。读取、删除、未教会的工具、格式错误的调用、空白路径和失败结果不贡献任何条目。`documentKind` 按扩展名决定哪些路径成为卡片。本包还提供 chat 视图按收尾消息查询的 `chatFileMentions` 服务与 `deliverables` 服务；把插件组合出去会移除全部表面，视图的空链以零成本留下。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当产出物面不够用时阅读以下页面。它们从该行进入 turn-tail 洞与词表背后的决策。

- [ui-conversation](../ui-conversation/README.zh.md)——声明 `conversation.chat.turnTail` 洞并渲染收尾正文。
- [工作区文件链接](../../../.agents/notes/implemented/feature/2026-07-31-web-workspace-file-links.zh.md)——产出文件行与宿主打开路径背后的决策。
- [产出物卡片在侧栏中打开](../../../.agents/notes/implemented/feature/2026-09-04-deliverable-cards-open-in-the-sidebar.zh.md)——文档卡片、被教会的工具与唯一文件打开入口背后的决策。
- [行内文件提及](../../../.agents/notes/implemented/feature/2026-08-07-web-inline-file-mentions.zh.md)——收尾正文可点击提及背后的决策。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

### 可点击文件引用指引

#### 模型看到的内容

一段固定提示词要求模型在最终回复中点名成功创建或修改的主要文件，并将这些文件以及正文中提到的其他本轮变更文件写成采用精确路径或唯一 basename 的 Markdown 行内代码，例如 `out/report.html`。

#### Token 影响

加载本包时增加一段固定提示词；不增加工具 schema、工具结果或按轮次变化的上下文。

#### KV Cache 影响

该段落在本包挂载期间始终以 first-party 顺序 9000 保持静态，因此留在可复用的提示词前缀中，不会随轮次改变。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前产出物词表。它们是当前包约束，不是通用文件链接对比或任务积压。

- **提及匹配只认精确路径或唯一 basename**——后缀式提及保持惰性；等真实的收尾消息形态产生需求后再放宽匹配规则。
- **终端命令间接创建的文件仍不在匹配词表内**——除非某个成功修改位置也记录了该路径，否则在行内代码中点名这类文件不会使其可点击。
- **被教会工具的每次成功调用都会列出其文件**——模型为验证而做的往返探针导出会与它验证的交付物并列，直到模型删除它，因为词表读取的是参数而非收尾正文。
- **卡片按扩展名选取**——以其他名字写出的文档，以及每个 `.html` 页面，都保持为标签。
- **原生文件夹交接以 Host 桌面为目标**——经非 loopback authority 访问的浏览器会省略该动作，报告没有原生打开器的部署也一样；若 SSH 转发让远端 Host 看似 loopback 本地，部署必须为 Session Controller 设置 `nativeOpen: false`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
