---
description: "仅 Team 的 GMO供应链 Host Remote：浏览器读取的已授权分类目录，以及它记录的会话分类选择。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-gmo-controller

[English](README.md) | 中文

## 概述

`dsh-api-gmo-controller` 是支撑 composer 的 GMO 控件的 Host Remote：浏览器无法直接触及 `ctx.gmo`，因为该服务在 Host 上，其提供方持有设备令牌，所以控件在这里询问。它回答一个会话可以从哪些分类中选择、已经选了哪个，并把新的选择记录为工具与提示词章节折叠的 `gmo/scope` 事件。这是仅 Team 的命名空间：没有 GMO 分析的组合不挂载它。

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

在挂载了 GMO 提供方的 Team Host 中挂载它；`dsh-client-ui-gmo` 调用它。

### Remote

| 方法 | 回答 |
|---|---|
| `scope(sessionId)` | 已授权的选项、从会话日志折叠出的当前范围，以及该范围是否已过期 |
| `choose(sessionId, mode, categoryRef?)` | 记录 `off` 或一个分类，并回答此刻的范围 |

目录在每次打开时读取而不是缓存：上次查看之后被撤销的授权会让控件变窄，管理员停用的分类会从中消失。所选分类若已不在目录中，会被报告为 `unavailable` 而不是被丢弃，让访问发生变化的成员知道自己的选择已过期。

### 一次选择记录什么

显示名取自此刻的已授权目录并写入事件，因为提示词要指名它，而模型可见的名字必须能从日志重建。目录里没有的引用被拒绝而不是被记录：Control Plane 在提问时本来也会拒绝它，记录它就等于在日志里写下一个无法兑现的承诺。

### 失败

| 代码 | 含义 |
|---|---|
| `gmo/no-category` | `selected` 的选择没有指名分类 |
| `gmo/not-available` | 该引用不是本成员可以分析的分类 |
| `gmo/unavailable` | 目录无法读取；封闭原因随之携带 |
| `gmo/session-not-open` | 被寻址的会话在本进程中没有打开 |

格式错误的请求回答 `gateway/bad-request`，从不变成授权结果。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

做成独立的、仅 Team 的命名空间，而不是会话控制器上更多的接口，因为在会话控制器里缺失的服务只能读作空目录。目录失败时封闭原因随之携带，让控件能说"请重新登录"或"Control Plane 无法访问"，而不是显示一个空列表——那会被读作"你没有任何访问权限"。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 控制器、请求解析与范围折叠 |
| [`src/types.ts`](src/types.ts) | Remote 边界类型，自成一体，让生成的 face 只命名本包声明的类型 |

生成的 Remote face 与 Host 绑定是 `lib/` 下的构建产物。

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——本 Remote 记录的范围事件。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——选择为何记录在会话日志里。

<a id="model-experience"></a>
## 模型体验

间接地，通过它记录的 `gmo/scope` 事件——`dsh-tool-gmo` 把它变成提示词段与工具可见性。

#### KV Cache 影响

自身没有。记录一次选择会改变 `dsh-tool-gmo` 拥有的 `gmo:scope` 提示词段与工具列表；前缀失效在那里描述。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **目录每次打开都读取**——控件每次打开发一次 Control Plane 调用；没有缓存。
- **生成的 Remote 客户端按声明的参数个数计数**——调用方必须把末尾可选的 `categoryRef` 以 `undefined` 传入，否则浏览器调用会失败，而 jsdom 测试却能通过。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：控制器不拥有注册表；它记录的恰好是折叠所读取的事件，由本包的测试断言。
