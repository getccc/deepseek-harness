---
description: "团队 Handoff 的包地图：Control Plane 面向 Runner 的绑定端点、Runner 侧的账户保管，以及浏览器所导航到的本地地址。"
kind: "package-group"
---

# team/ — 从公司站点到这台电脑

[English](README.md) | 中文

## 概述

`team/` 组把成员从公司站点带进他们自己电脑上运行的应用，并保管由此产生的凭据。它刻意不是一条隧道：没有工作空间、Session、终端输出或 Diff 穿过网络，站点是习惯性入口而不是检查点——直接打开本地地址得到的是同一个应用，正是这一点让产品在 Control Plane 不可达时依然可用。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

四个包，按它们运行在网络的哪一侧划分；完整契约由各自的子 README 拥有。

| 包 | 所在侧 | 作用 | ctx key |
|---|---|---|---|
| [`team-control-plane-http/`](team-control-plane-http/README.zh.md) | Control Plane | 面向 Runner 的绑定端点：start、redeem、refresh | — |
| [`team-account-client/`](team-account-client/README.zh.md) | Runner | 设备密钥、凭据，以及对 Control Plane 的调用 | `ctx.teamAccountClient` |
| [`team-local-handoff/`](team-local-handoff/README.zh.md) | Runner | 浏览器所导航到的三个本地地址 | — |
| [`team-shell/`](team-shell/README.zh.md) | Control Plane | 登录、确认一台电脑，以及管理页面 | — |

-----

<a id="related-documentation"></a>
## 相关文档

- [团队 Handoff 子系统](../../docs/subsystems/team-handoff.zh.md)——三个地址、Callback 的同站弹跳，以及本地 state 的作用。
- [设备授权子系统](../../docs/subsystems/device-authorization.zh.md)——这些端点所暴露、这个客户端所驱动的接缝。
- [`client/connection`](../client/connection/README.zh.md)——拥有这些端点所发放的本地浏览器会话。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

有一个细节不能被"简化"：`/team/callback` 回答 200 并附一个自我导航的页面，而不是重定向。`SameSite=Strict` Cookie 会被跨站导航链中的每一个请求扣下，因此重定向会让浏览器带着刚拿到的会话之外的空手落在应用上。

</details>
