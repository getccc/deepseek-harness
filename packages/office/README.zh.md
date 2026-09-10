---
description: "办公交付物选择的包地图：一次对话应生成哪种文档、告诉模型的提示词分节，以及记录选择的编辑器选择器。"
kind: "package-group"
---

# office/ — 办公交付物选择族

[English](README.md) | 中文

## 概述

`office/` 组让成员说出一次对话应产出哪种办公交付物——Word 文档、Excel 工作簿、PowerPoint 或交互式图表——并把该选择折叠进模型读取的提示词分节。这个选择必须挺过恢复、fork 与第二个浏览器。本组拥有词汇表——`OfficeKind`、记录它的 `office/kind` Session 事件与恢复它的折叠——不拥有文档引擎：产出文件是办公工具的职责；本组只命名目标，并为 PowerPoint 指向随附的公司模板。

## 目录

- [包](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx key |
|---|---|---|
| [`office/`](office/README.zh.md) | 选择词汇：类型、`office/kind` 事件、折叠与校验器 | — |
| [`tool-office/`](tool-office/README.zh.md) | 模型所见：`office:kind` 提示词分节与选择投影 | 注册于 `ctx.systemPrompt` |
| [`api/office-controller/`](../api/office-controller/README.zh.md) | Host Remote：从浏览器读取并记录一次会话的办公选择 | `ctx.remote.office` |
| [`client/ui-office/`](../client/ui-office/README.zh.md) | 选择类型的编辑器芯片 | 浏览器插件 |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>面向维护者的工作背景——点击展开</summary>

控制器的 Remote 面命名一个自包含的线型，而不导入 `OfficeChoice`，因此 Typert 生成器绝不会顺着一个边界类型进入一个增强投影或事件映射的包。

</details>
