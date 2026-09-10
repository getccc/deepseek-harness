---
description: "办公交付物选择词汇：一次对话应生成哪种文档、其会话日志事件、恢复它的折叠，以及从线上读回一个选择的校验器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-office

[English](README.md) | 中文

## 概述

`dsh-office` 是一个小选择的共享词汇：一次对话应生成哪种办公交付物——`word`、`excel`、`ppt`、`chart` 或 `none`。它拥有 `OfficeKind`、记录一次选择的 `office/kind` 会话事件、从日志恢复当前选择的折叠，以及从线上读回一个选择的校验器。它不带插件、不带提示词、不带投影：面向模型的工具（`dsh-tool-office`）与浏览器 Remote（`dsh-api-office-controller`）都在此词汇之上构建，而它刻意除会话事件外不含任何模块增强，因此一个命名 `OfficeChoice` 的生成 Remote 面绝不会把投影注册表拖进自身。

## 目录

- [使用本包](#use-this-package)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

导入词汇以记录或读取一次会话的办公选择：

- `OfficeKind`、`OFFICE_KINDS`、`isOfficeKind` —— 类型与守卫。
- `foldOfficeChoice(events)` —— 当前选择，日志无记录时为 `none`。
- `parseOfficeChoice(value)` —— 校验来自线上或存储的选择；当值不是本构建接受的选择时为 `undefined`。
- `DEFAULT_OFFICE_CHOICE` —— 新会话持有的 `none`。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **每会话一个选择** —— 词汇记录当前类型，而非历史或逐目录默认值；新对话从 `none` 开始。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

`office/kind` 事件在 `scope.ts` 中增强 `SessionEventMap`；投影增强位于 `dsh-tool-office` 而非此处，因此 Remote 控制器可以命名 `OfficeChoice` 而不导入投影注册表。

</details>

**运行时不变量：**不发布伴随文件：提示词分段与投影都是对 Session 日志的纯折叠；记录的选择是本构建认识的类型，这一点由 `choose` 内的 `parseOfficeChoice` 强制执行，并由本包测试断言。
