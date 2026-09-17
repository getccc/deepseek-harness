---
description: "Web GUI 的 BI 分析 chip：位于办公 chip 右侧、在分析能力落地前保持不可用的控件；供构建该能力的维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-bi

[English](README.md) | 中文

## 概述

本包持有 Web GUI 的 BI 分析 chip：composer 工具行中位于办公 chip 右侧的「BI分析」控件。它已就位但不可用——它确定的是席位、在同排 chip 中的次序与文案，并通过 `aria-disabled` 与工具提示说明该能力尚未构建。它不持有状态、不读取投影、也不调用 Remote；分析行为将在之后落到本包。

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

与 `ui-conversation` 一起挂载本插件；chip 随即出现在每个工作任务对话中。无需配置：不想显示该席位的部署，把本插件从其组装中去掉即可。Team bundle 把它挂载在它所跟随的办公 chip 旁边。

### 成员看到什么

chip 以 composer 自身的墨色显示趋势字形与文案，位于联网、知识与办公 chip 之后；composer 窄于 460px 时它像同排 chip 一样收缩为纯字形。它为无障碍技术提供名称、被播报为不可用、并带有说明功能仍在开发的工具提示。点击它不会发生任何事。它不出现在聊天对话中——那里没有可供分析的工作区。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

chip 以 order 120 加入由 conversation 声明的 `conversation.input.left` 列表——在 50 的联网开关、60 的录音转写 chip、100 的知识 chip 与 110 的办公 chip 之后。它通过标准套件的 `useSessions` 读取会话种类，在工作会话之外不渲染任何内容。node 半边是空 apply（名册行）。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当这个 chip 不够用时阅读以下页面。它们从席位走向声明席位的 composer 以及它所跟随的 chip。

- [ui-conversation](../ui-conversation/README.zh.md)——声明 composer 的 `conversation.input.left` 区域。
- [ui-office](../ui-office/README.zh.md)——本 chip 紧邻的 chip，也是一个可用 composer 选择的形态。
- [ui-voice](../ui-voice/README.zh.md)——另一组先于能力放好的席位。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该 chip 是不可用的占位控件：不渲染任何模型可见文本，也不在会话日志中记录任何内容。

#### KV Cache 影响

chip 不增加提示内容，也不改变请求前缀，因此没有任何请求前缀发生移动。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了当前的包。它们说明这个席位尚未承载什么。

- **没有分析**——chip 背后的能力尚未构建：它不打开任何界面、不读取任何数据、也不产出任何报告。构建它属于本包，建立在拥有数据源与所运行分析的宿主 seam 之上。
- **仅限工作任务对话**——聊天对话中不显示该 chip。
- **chip 属于默认 composer**——plan 评审等待处理的整 composer 交互会临时替换 InputBar 及其席位。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随件。本包拥有一个 slot effect，其声明、注册与拆除由本包自身的测试覆盖，且不存在两个观察者可能看法不同的关系。
