---
description: "GMO供应链 composer 控件：单选本次对话查询哪个 GMO 分类，通过仅 Team 的 gmo Remote 记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-gmo

[English](README.md) | 中文

## 概述

`dsh-client-ui-gmo` 是工作 composer 的 GMO供应链控件，位于 BI 徽章的右侧：在成员可分析的分类上单选，通过仅 Team 的 `gmo` Remote 把选择记录为 `gmo/scope` 事件，并读取同一事件的投影。选择的任何信息都不保存在浏览器里，所以另一个浏览器、重新加载和模型看到的都是同一个分类。插件不带 Host 行为；挂载它只是把它的浏览器部分放进启动图。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Team 构建中，在 `dsh-api-gmo-controller` 之后挂载：

```yaml
- id: api-gmo-controller
  name: '@deepseek-ai/dsh-api-gmo-controller'
- id: client-ui-gmo
  name: '@deepseek-ai/dsh-client-ui-gmo'
```

### 控件做什么

它只为工作会话渲染，从不为聊天会话渲染，因为后者的无工具预设没有可问的结果。标签是会话记录的显示名；再次点击已选的分类会清除它。目录在菜单打开时读取，所以上次打开之后被撤销的授权会让行变少。菜单页脚会说明：更改无法保存、成员没有可选的分类，以及已记录的分类不再可用。

### 文案

文案在 `gmo` 语言命名空间里，有简体中文和英文两份，composer 徽章显示 GMO供应链 或 GMO supply chain。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

所选分类从 `gmo` 投影读取而不是保存在组件里，所以徽章、重新加载、另一个浏览器和模型是一致的。控件通过 Remote 写，通过投影读，从不去调和两者。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：Remote 挂载、词典和 composer 槽位注册 |
| [`src/client/GmoSelect.tsx`](src/client/GmoSelect.tsx) | 控件 |
| [`src/client/locales.ts`](src/client/locales.ts) | 该命名空间的词典 |

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——控件记录的范围。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——composer 控件，以及对话为何从 off 开始。

<a id="model-experience"></a>
## 模型体验

间接地，通过控件记录的 `gmo/scope` 事件——`dsh-tool-gmo` 把它变成指名分类的提示词段以及五个 GMO 工具的可见性。

#### KV Cache 影响

每次选择都会改变 `dsh-tool-gmo` 拥有的 `gmo:scope` 系统提示词段与工具列表，因此下一次请求的前缀从该段起不同；打开控件在点击分类之前不产生任何开销。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **一个对话一个分类**——控件是单选，没有表示多个或全部的分支。
- **生成的 Remote 客户端按声明的参数个数计数**——控件传入每个声明的参数，没有分类时末尾一个以 `undefined` 传入，因为参数更少的调用会被客户端拒绝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：控件通过一个 Remote 读一个投影、写一个事件，其组件测试与插件测试断言了这一点。
