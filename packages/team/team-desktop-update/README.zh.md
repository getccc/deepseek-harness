---
description: "Web GUI 的桌面更新控件：成员条目旁用于下载并安装更新构建的按钮，仅在桌面外壳中显示；面向 Team 桌面应用的成员与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-desktop-update

[English](README.md) | 中文

## 概述

本包在侧边栏底部成员条目旁渲染更新控件：一个圆形按钮，在有更新构建可用时出现，点击一次即开始下载并绘制自身进度，随后重启应用进入该构建。检查、下载与安装由桌面外壳负责，外壳把它们暴露在 `window.dshTeamDesktop` 上；该桥不存在时本包不注册任何内容，因此同一页面在普通浏览器或源码启动中呈现的侧边栏保持不变。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在同时组合了 `dsh-team-local-login` 的组合中挂载本插件，后者声明了本控件加入的 `team.account.action` 列表。Team Bundle 两者都会组合。除此之外无需配置：是否存在更新由外壳判定，控件呈现的是外壳报告的内容。

### 按钮呈现什么

已安装构建为最新时以及检查进行中，按钮不存在——没有可安装内容的成员看到的侧边栏底部保持不变。一个被接受的版本会把它变成实心下载按钮，提示气泡给出版本号；点击一次开始下载。下载期间按钮以圆环绘制百分比且不接受点击。下载完成后应用停止 Runner 并重启进入新构建，因此就绪状态按设计十分短暂。失败会把按钮变为警告样式，提示气泡携带原因，点击则重新询问。

### 失败

检查或下载失败时，已安装构建继续运行且未被改动。外壳报告的原因就是提示气泡的文本；成员可以用同一个按钮重试，部署方也始终可以改为分发完整安装程序。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

浏览器半在 apply 时读取一次 `window.dshTeamDesktop`，当该对象缺失或其 `protocolVersion` 不是本构建所讲的版本时，直接返回且不注册任何内容。存在桥时，它注册词典并以 order 100 加入 `team.account.action`，通过条目的注入面把桥的三个调用传递下去。节点半是空 apply——让浏览器半进入启动图的名册行。

控件只持有一份状态：外壳最后发布的那个状态。它在挂载时订阅，同时调用一次 `check()`，因为外壳可能在页面加载之前就完成了自己的检查，而订阅只承载此后发生的事情。每个阶段映射到一个图形、一个无障碍名称、一个提示气泡，以及点击的行为；`idle` 与 `checking` 映射为不渲染。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当控件本身不足以回答问题时阅读这些。它们从按钮走向对其采取行动的外壳。

- [dsh-team-local-login](../team-local-login/README.zh.md)——渲染成员条目并声明 `team.account.action` 列表。
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.zh.md)——负责检查、下载、安装并暴露该桥的外壳。
- [Team 桌面端从 Control Plane 自更新](../../../.agents/notes/proposed/feature/2026-09-20-team-desktop-self-update.zh.md)——为什么更新通过部署自己的 Control Plane 发布。
- [Team 包地图](../README.zh.md)——相邻的 Team 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该控件不注册任何模型输入。

#### KV Cache 影响

此处没有任何内容进入模型请求，因此没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

- **仅在桌面外壳中** ——从浏览器访问同一 Runner 的成员无法通过本控件更新，因为只有外壳能替换已安装的应用。
- **整个应用共用一个按钮** ——一次更新同时替换外壳、Runner 与插件树；没有可供选择的按部件更新。
- **没有版本说明** ——提示气泡携带版本号，失败时携带原因；一个版本改动了什么在应用之外分发。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`src/client/desktop-bridge.ts` 中的桥声明与外壳的 `TeamDesktopUpdateApi` 是同一个对象的两份独立声明，因为两个程序各自独立编译，任何一方都不应依赖另一方的构建产物。`DESKTOP_UPDATE_PROTOCOL` 正是二者漂移时的绊线：讲另一个版本的外壳不会注册控件，而不是调用一个并不匹配的桥。

</details>

**运行时不变量：** 不发布伴随包。每一项更新操作都由外壳拥有，而本控件是一个插槽副作用，其声明、注册与拆除由本包自身覆盖。
