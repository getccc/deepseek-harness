---
description: "Runner 的三个本地地址：开始一次绑定、进入应用，以及从 Control Plane 接回浏览器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-local-handoff

[English](README.md) | 中文

## 概述

`dsh-team-local-handoff` 是可选的公司站点浏览器 Handoff。默认 Team Bundle 改用 [`team-local-login`](../team-local-login/README.zh.md)，因此普通成员始终留在 3090。刻意组合本包时，它提供 `/team/start`、`/team/open` 与 `/team/callback`；Callback 回答 200 并附自我导航页面，因为 `SameSite=Strict` Cookie 挺不过跨站导航链中的重定向。

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

```yaml
plugins:
  '@deepseek-ai/dsh-team-local-handoff':
    applicationPath: /
```

三个路径是固定的，不可配置：Control Plane 把它的重定向目标登记在它们之上，因此改名的部署会弄坏每一台已绑定的电脑。

除非请求是顶层文档导航，否则每一个都回答 405。它们不携带 RPC、不读请求体、也够不到任何 Host 能力，因此守卫 `/api` 的浏览器信任栅栏在这里没有什么可守。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 为什么 Callback 不是重定向

本地会话 Cookie 是 `SameSite=Strict`，而到达 `/team/callback` 的那次导航是由公司站点发起的。浏览器会对跨站导航链中的每一个请求扣下 Strict Cookie，包括重定向产生的那个，因此设置 Cookie 再回答 303，会让浏览器不带它落在应用上。回答 200 并附一个自我导航的页面，会让那次导航变成同站的，Cookie 随它一同发送。

### 本地 state 做什么，不做什么

state 把一次 Callback 绑到本进程服务过的那个配对页，正是这一点阻止了别人拼装的链接把这台电脑绑到他们的账户上。它不阻止重放：Control Plane 的 Authorization Code 是一次性的，那才是拒绝第二次携带它的 Callback 的东西。state 刻意在一次失败的完成后存活，因为在那里消费它会把 Control Plane 的一时故障变成成员的一次彻底重来。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 三条路由、导航检查与 state |
| [`src/paths.ts`](src/paths.ts) | 三个固定地址 |
| [`src/pages.ts`](src/pages.ts) | 配对页与故障页 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [团队 Handoff 子系统](../../../docs/subsystems/team-handoff.zh.md)——两侧的完整流程。
- [`team-account-client`](../team-account-client/README.zh.md)——这些地址所驱动的对象。
- [`client/connection`](../../client/connection/README.zh.md)——拥有这些地址所发放的本地浏览器会话。

<a id="model-experience"></a>
## 模型体验

无，因为这些是导航端点，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **配对页朴素且无样式** —— 它在应用尚未解锁时被提供，因此不能依赖应用自身资源的加载。
- **不报告任何 Sec-Fetch 事实的浏览器被当作在导航** —— 拒绝这些请求会把较老的浏览器挡在一个没有该提示也安全的端点之外。
- **同时只有一次进行中的绑定** —— 第二次 `/team/start` 会替换第一次铸出的 state，于是较早那个配对页停止工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试使用 `node:http` 而不是 `fetch`，因为 `fetch` 会用自己的值覆盖 `Sec-Fetch-Mode`：用它的测试永远无法呈现一次真实导航所呈现的东西，而这些端点恰恰就是按那个头来回答的。

</details>
