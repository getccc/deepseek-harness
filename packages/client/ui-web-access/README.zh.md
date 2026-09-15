---
description: "Web GUI 的联网开关：为单个对话开启或关闭网页检索与抓取的 composer 控件；供聊天组装的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-access

[English](README.md) | 中文

## 概述

本包在 Web GUI 中渲染联网开关：composer 工具行左侧的「联网」徽章，显示本对话的 agent 是否被提供 `web_search` 与 `web_fetch`，并可一键切换。徽章只出现在 agent preset 挂载了该开关的对话中（随附的 `chat` preset，默认关闭），并读取宿主计算的 `webAccess` 投影，因此重新加载、第二个浏览器与模型三方一致。开关本身、`/web` 命令与已记录的 `web/access` 状态归 `dsh-tool-web` 所有；本包只发送用户同样可以手敲的内容。

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

在聊天 preset 以 `sessionSwitch` 挂载 `dsh-tool-web` 的部署中，与 `ui-conversation` 一起挂载本插件；徽章随即占据 composer 左侧区域，位于知识与 office 徽章之前。点击它为当前对话开启或关闭联网；同样的变更也可从 composer 的 `+` Command 菜单以 `/web on` 与 `/web off` 完成。

### 徽章显示什么

徽章是一个按下式开关：联网关闭时不着色，显示地球图标与文字；开启时着色；无障碍名称为「联网已开启，按下关闭」或「联网已关闭，按下开启」。点击会发送相反的值并禁用徽章直至命令落定；投影确认后显示新状态。组装未提供开关的对话（例如标准 preset 上的工作会话）完全不显示徽章。composer 窄于 460px 时文字折叠为图标。

### 失败

被拒绝的切换（宿主未准入的命令、业务错误或传输故障）显示一行内联的「切换联网失败」，其提示携带原因；徽章保持投影状态并接受下一次点击。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

徽章以 order 50 加入 conversation 声明的 `conversation.input.left` 列表；node 半部是空 apply（roster 行）。读取经标准工具包 `useProjection` 走通用投影对：`webAccess` 的值为 `{ enabled: boolean | null }`，`null` 表示组装未挂载开关，此时不渲染任何内容。条目的注入面携带一个动词 `setEnabled`，经 `ctx.remote.commands.execute` 执行 `/web on` 或 `/web off`，并把 RPC 失败、未匹配的命令或命令自身的错误结果映射为徽章内联显示的失败行。浏览器端不保存任何开关状态。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当徽章不够用时阅读以下页面。它们从控件进入其驱动的开关与承载它的 composer。

- [dsh-tool-web](../../web/tool-web/README.zh.md)——拥有 `sessionSwitch` 配置、`/web` 命令、`webAccess` 投影与按会话的工具限制。
- [dsh-agent-presets](../../preset/agent-presets/README.zh.md)——随附的 `chat` preset，默认以关闭状态挂载该开关。
- [ui-conversation](../ui-conversation/README.zh.md)——声明 composer 的 `conversation.input.left` 区域。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过徽章派发的 `/web on` 或 `/web off` 命令行：`dsh-tool-web` 拥有该命令行驱动的模型可见工具 schema、指引与已记录状态。

#### KV Cache 影响

开启或关闭联网会在下一次请求中加入或移除 `web_search`/`web_fetch` 的 schema 及其指引段，因此改变一次请求前缀；徽章本身不添加任何提示词内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前的开关徽章。它们是当前包约束，不是任务积压。

- **徽章属于默认 composer**——plan 评审等待处理的整 composer 交互会临时替换 InputBar 及其徽章。
- **每个对话一个开关**——徽章同时切换两个网页工具；只要检索不要抓取的部署应配置 `dsh-tool-web` 而不是徽章。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随件。开关状态与工具可见性归 dsh-tool-web 所有，而该控件是一个 slot effect，其声明、注册与拆除由本包测试覆盖。
