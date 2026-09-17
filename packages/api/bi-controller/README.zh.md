---
description: "仅 Team 的 BI 分析 Host Remote：浏览器读取的已授权项目目录，以及它记录的 Session 项目选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-bi-controller

[English](README.md) | 中文

## 概述

`dsh-api-bi-controller` 是输入框 BI 控件所对话的 Host Remote。浏览器无法触达 `ctx.bi`，也无法追加 Session 事件，因此它请求 `bi` 命名空间：读取成员可分析的项目以及某个对话折叠后的选择（`scope`），并记录新的选择（`choose`）。它是随 BI 工具一起挂载的仅 Team 命名空间；没有这些工具的构建永远不会长出它。本 Remote 把选择记录为一个 `bi/scope` 事件，携带目录在那一刻持有的显示名，并让 `dsh-tool-bi` 成为把它变成模型所见内容的唯一地方。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Team 组合中把它挂载在 `dsh-bi-team` 旁边；浏览器插件 `dsh-client-ui-bi` 挂载其生成的 Remote 面并调用它。它注入 `agents`、`bi` 与 `typert`，无需配置。

- `bi.scope(sessionId)` → 该成员此刻可分析的项目、Session 当前的选择，以及该选择是否指名了目录已不再持有的项目。
- `bi.choose(sessionId, mode, projectRef?)` → 记录 `off`，或带一个项目的 `selected`，并读回范围。目录不持有的项目会被拒绝而不是记录，因为记录下来的名字会到达提示词，必须在选择的那一刻就已获得。

目录在每次调用时读取而不缓存：上次查看之后被撤销的授权应当收窄控件，被管理员关闭的项目应当离开它。无法读取的目录以携带封闭原因的 `bi/unavailable` 应答，这样控件可以说“重新登录”，而不是显示一个空列表。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过它记录的 `bi/scope` 事件——`dsh-tool-bi` 把它变成提示词段与工具可见性。

#### KV Cache 影响

自身没有。记录一次选择会改变 `dsh-tool-bi` 拥有的 `bi:scope` 提示词段与工具列表；前缀失效在那里描述。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **线路类型是自包含的**——Remote 面声明自己的范围封套，而不是导入词汇表的 `BiScope`，因此两者由 `parseBiScope` 而不是共享类型保持一致。
- **一个对话一个项目**——`choose` 记录一个项目或不记录；没有整个目录模式，因为提示词指名一个项目，而工具不接受项目参数。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

自包含的线路类型是有意为之：一个跟随 `BiScope` 进入 `@deepseek-ai/dsh-bi` 的生成 Remote 面会把 Session 事件的模块增强拉进分析器并使其崩溃，办公 Remote 在此之前已经遇到过。

请求解析与打开 Session 的查找，与知识和办公 Remote 携带的是同样的片段；克隆检测器会报告它们。抽取一个由三者参数化、以 Session 为地址的 Remote 基类是后续工作，它会触及那两个包及其测试，这正是它没有随添加本包的变更一起进行的原因。

</details>

**运行时不变量：** 不发布伴随包：控制器在调用之间不持有状态，也不拥有注册表；记录的项目是目录在选择那一刻所持有的，这在 `choose` 内部强制执行，并由本包的测试断言。
