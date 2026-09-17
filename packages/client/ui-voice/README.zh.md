---
description: "Web GUI 的语音控件：录音转写徽章与语音输入按钮，在录音能力落地前先占据席位且不可用；供构建该能力的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice

[English](README.md) | 中文

## 概述

本包持有 Web GUI 的两个语音控件：composer 工具行中位于联网开关旁的「录音转写」徽章，以及上下文计量与发送按钮之间的麦克风按钮。两者都已就位但不可用——它们确定的是席位、在同排徽章中的次序与文案，并各自通过 `aria-disabled` 与工具提示说明该能力尚未构建。两者都不持有状态、不读取投影、也不调用 Remote；录音与口述行为将在之后落到本包。

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

与 `ui-conversation` 一起挂载本插件；两个控件随即出现在每个聊天对话中。无需配置：不想显示这两个席位的部署，把本插件从其组装中去掉即可。

### 成员看到什么

徽章以 composer 自身的墨色显示波形字形与文案，位于联网开关之后、知识与 office 徽章之前；composer 窄于 460px 时它像同排徽章一样收缩为纯字形。麦克风按钮是尾部控件组中的一枚安静圆钮，位于上下文计量之后、发送圆钮之前。两者都为无障碍技术提供名称、都被播报为不可用、都带有说明功能仍在开发的工具提示。点击任一都不会发生任何事。两者都不出现在工作会话中：该能力是为聊天 composer 构建的。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

徽章以 order 60 加入由 conversation 声明的 `conversation.input.left` 列表——在 50 的联网开关之后、100 的知识与 office 徽章之前。按钮占据 `conversation.input.voice`，即 `ui-conversation` 在 composer 上下文计量与发送圆钮之间声明的单一席位，并从该席位取用 `locked`，因此 composer 拒绝交互时它与相邻控件一同变暗。两者都通过标准套件的 `useSessions` 读取会话种类，在聊天会话之外不渲染任何内容。node 半边是空 apply（名册行）。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当这两个控件不够用时阅读以下页面。它们从席位走向声明席位的 composer。

- [ui-conversation](../ui-conversation/README.zh.md)——声明 composer 的 `conversation.input.left` 区域与 `conversation.input.voice` 席位。
- [ui-web-access](../ui-web-access/README.zh.md)——录音转写徽章紧邻的徽章，也是一个可用 composer 控件的形态。
- [Web 客户端 Slots](../../../docs/subsystems/slots.zh.md)——两个控件加入的席位层级。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为两个控件都是不可用的占位控件：不渲染任何模型可见文本，也不在会话日志中记录任何内容。

#### KV Cache 影响

控件不增加提示内容，也不改变请求前缀，因此没有任何请求前缀发生移动。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了当前的包。它们说明这两个席位尚未承载什么。

- **没有录音也没有口述**——两个控件背后的能力尚未构建：不申请麦克风权限、不采集音频、也不会有转写文本进入草稿。构建它属于本包，建立在拥有转写提供方的宿主 seam 之上。
- **仅限聊天对话**——工作会话中两个控件都不显示，因此要口述一个任务仍得打字。
- **控件属于默认 composer**——plan 评审等待处理的整 composer 交互会临时替换 InputBar 及其两个席位。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随件。本包拥有两个 slot effect，其声明、注册与拆除由本包自身的测试覆盖，且不存在两个观察者可能看法不同的关系。
