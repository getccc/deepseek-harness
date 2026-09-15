---
description: "会话联网开关的宿主 Remote 所有者：读取一个对话的 agent 是否被提供网页工具，并从浏览器设置它，对话流里不留下命令记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-web-access-controller

[English](README.md) | 中文

## 概述

`dsh-api-web-access-controller` 是 composer 联网徽章所对话的宿主 Remote。浏览器无法追加 Session 事件，因此它请求 `webAccess` 命名空间读取一个对话的开关（`state`）并设置它（`set`）。设置会记录与 `/web` 命令相同的 `web/access` 事件，但它是一条没有命令节点的 log-only 事件，所以反复点击徽章不会在屏幕上留下任何东西。它随 Web 组合挂载；preset 未组合开关的对话会被拒绝，而不是被悄悄记录。`dsh-tool-web` 仍是把该事件变成模型所见内容的唯一地方。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Web 组合中挂载它；浏览器插件 `dsh-client-ui-web-access` 挂载其生成的 Remote 面并调用它。它注入 `agents`、`typert` 与 `web`，不需要配置。

- `webAccess.state(sessionId)` → 会话日志所陈述的开关。
- `webAccess.set(sessionId, enabled)` → 记录该值并读回；日志已陈述的值不记录任何东西。

两者都会向 web 服务询问部署是否许可该成员搜索，每次调用都重新询问，不许可时、对话未在本进程打开时、或因组合未提供开关而日志中没有 `web/access` 事件时，都以 `web-access/unavailable` 拒绝。徽章在对话打开时读取 `state`，被拒绝就保持隐藏。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过它记录的 `web/access` 事件：`dsh-tool-web` 把它变成网页工具 schema 及其指引的出现或消失。

#### KV Cache 影响

自身没有。记录一个值会加入或移除 `dsh-tool-web` 拥有的 `web_search`/`web_fetch` schema；前缀失效在那里描述。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **线上类型自包含**——Remote 面声明自己的 `{ enabled }` 视图，而不是从 `dsh-tool-web` 导入开关的投影类型，因此两者由测试而非共享类型保持一致。
- **有意不留命令节点**——经本 Remote 的设置在对话里没有可见记录；想要记录的成员仍可使用 `/web` 命令。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

自包含的线上类型是有意为之：若生成的 Remote 面顺着投影类型进入 `@deepseek-ai/dsh-tool-web`，会把 Session 事件的模块扩充拉进分析器并使其崩溃，与 office Remote 声明自己信封的理由相同。

</details>

**运行时不变量：** 未发布伴随件：控制器在调用之间不持有任何东西，也不拥有注册表；"只有值不同时才改变日志"在 `set` 内部强制执行并由包的测试断言。
