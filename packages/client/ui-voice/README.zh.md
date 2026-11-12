---
description: "聊天输入框中的录音转写占位入口。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-voice

[English](README.md) | 中文

## 概述

本包在聊天输入框的工具行提供“录音转写”占位入口。入口显示功能开发中的提示，不录音，也不修改草稿。实际语音输入由独立的语音输入插件提供。

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

将本插件与 `ui-conversation` 一起挂载，即可在聊天输入框中显示录音转写入口。本插件没有配置项。

### 成员看到什么

入口位于联网开关旁、知识与 office 徽章之前，显示波形图标和“录音转写”。输入框宽度小于 460px 时只显示图标。入口具有可访问名称，并通过 `aria-disabled` 和工具提示说明功能不可用。它不出现在工作会话中。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

入口以 order 60 注册到 `conversation.input.left`，并通过 `useSessions` 读取会话种类。插件不占用 `conversation.input.voice`，该席位可由实际语音输入插件使用。node 半边的 apply 为空。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

以下页面说明入口所在的输入框和席位。

- [ui-conversation](../ui-conversation/README.zh.md)——声明 composer 的 `conversation.input.left` 区域与 `conversation.input.voice` 席位。
- [ui-web-access](../ui-web-access/README.zh.md)——录音转写徽章紧邻的徽章，也是一个可用 composer 控件的形态。
- [Web 客户端 Slots](../../../docs/subsystems/slots.zh.md)——入口加入的席位层级。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无。占位入口不生成模型可见文本，也不记录会话事件。

#### KV Cache 影响

控件不增加提示内容，也不改变请求前缀，因此没有任何请求前缀发生移动。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

本包仅提供占位入口。

- **不录音或转写**——入口不请求麦克风权限，不采集音频，也不向草稿插入文字。
- **仅限聊天对话**——工作会话不显示此入口。
- **默认输入框**——plan 评审等交互可临时替换包含此入口的 InputBar。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 本包拥有一个 slot effect，注册和卸载由包内测试覆盖。
