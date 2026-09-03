---
description: "Session 办公交付物选择的 Host Remote 拥有者：读取一次对话的选择，并从浏览器记录一个新选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-office-controller

[English](README.md) | 中文

## 概述

`dsh-api-office-controller` 是编辑器办公芯片对话的 Host Remote。浏览器无法追加会话事件，因此它请求 `office` 命名空间读取一次对话折叠后的办公选择（`scope`）并记录一个新选择（`choose`）。它是与办公工具一并挂载的仅限 Team 的命名空间；不含该工具的构建绝不生长它。该 Remote 将选择记录为 `office/kind` 事件，并让 `dsh-tool-office` 成为唯一把它变成模型可见内容的地方。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Team 组合中挂载；浏览器插件 `dsh-client-ui-office` 挂载其生成的 Remote 面并调用它。它注入 `agents` 与 `typert`，无需配置。

- `office.scope(sessionId)` → 会话当前的选择。
- `office.choose(sessionId, kind)` → 记录一个类型（或 `none`）并读回。未知类型或未打开的对话会被拒绝。

-----

<a id="model-experience"></a>
## Model Experience

间接地，通过它记录的 `office/kind` 事件：`dsh-tool-office` 把该事件变成提示词分节。此 Remote 不注册提示词、工具或 schema，其中也没有文本进入请求。

#### KV Cache effect

它自身没有。记录一个选择会改变 `dsh-tool-office` 拥有的 `office:kind` 提示词分节；前缀失效在那里描述。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **线型是自包含的** —— Remote 面声明自己的选择信封，而非导入词汇的 `OfficeChoice`，因此二者由 `parseOfficeChoice` 而非共享类型保持一致。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

自包含线型是刻意的：若生成的 Remote 面顺着 `OfficeChoice` 进入 `@deepseek-ai/dsh-office`，会把会话事件的模块增强拉进分析器并使其崩溃。

</details>
