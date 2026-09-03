---
description: "选择本次对话应生成哪种办公交付物的编辑器芯片：Word、PowerPoint、AMEC PowerPoint 模版或 Excel。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-office

[English](README.md) | 中文

## 概述

`dsh-client-ui-office` 是成员用来指定一次对话应生成哪种办公文档的编辑器芯片。它是单选——Word、PowerPoint、AMEC PowerPoint 模版或 Excel——再次点击已选类型即清除。芯片从 `office` 投影读取已选类型，并通过仅限 Team 的 `office` Remote 记录一次点击，因此重载或第二个浏览器显示相同选择，而模型通过 `dsh-tool-office` 拥有的提示词分节读取它。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Team 浏览器组合中挂载；它在编辑器左区安置一个控件，并挂载它调用的 `office` Remote 命名空间。它无需配置。Host 不折叠任何办公选择的构建不渲染任何内容。

-----

<a id="model-experience"></a>
## Model Experience

间接地，通过芯片记录的 `office/kind` 事件：`dsh-tool-office` 把该事件变成命名文档类型的提示词分节。此包中没有文本进入请求。

#### KV Cache effect

每次选择都会改变 `dsh-tool-office` 拥有的 `office:kind` 系统提示词分节，因此下一次请求的前缀从该分节起不同；在点击某个类型之前，打开芯片不产生任何代价。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **选择只存在于一次对话** —— 没有被记住的默认值，因此每个新对话都以未选择任何办公格式开始。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

芯片从一个本地常量列出五种类型，而非导入词汇的 `OFFICE_KINDS`，因为客户端 bundle 不得跨插件导入运行时值；类型仍来自 `@deepseek-ai/dsh-office`。

</details>
