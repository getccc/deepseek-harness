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

九个包，按它们运行在网络的哪一侧划分；完整契约由各自的子 README 拥有。

| 包 | 所在侧 | 作用 | ctx key |
|---|---|---|---|
| [`team-control-plane-http/`](team-control-plane-http/README.zh.md) | Control Plane | 面向 Runner 的账户认证与设备凭据端点 | — |
| [`team-account-client/`](team-account-client/README.zh.md) | Runner | 设备密钥、凭据，以及对 Control Plane 的调用 | `ctx.teamAccountClient` |
| [`team-local-login/`](team-local-login/README.zh.md) | Runner | 默认本地成员登录、入口与退出 | — |
| [`team-local-handoff/`](team-local-handoff/README.zh.md) | Runner | 可选公司站点浏览器 Handoff | — |
| [`team-admin-api/`](team-admin-api/README.zh.md) | Control Plane | 管理控制台的 JSON API：会话、授权、审计 | — |
| [`team-admin-app/`](team-admin-app/README.zh.md) | Control Plane | 提供构建好的管理控制台 | — |
| [`team-console-menu/`](team-console-menu/README.zh.md) | Control Plane | 控制台的导航树，以及每条菜单所声明的权限 | `ctx.consoleMenu` |
| [`team-console-menu-sqlite/`](team-console-menu-sqlite/README.zh.md) | Control Plane | SQLite 版导航，由本构建随附的树播种 | `ctx.consoleMenu` |
| [`team-browser-session/`](team-browser-session/README.zh.md) | Control Plane | 会话 cookie、它的 CSRF 值与同源判定 | — |
| [`team-shell/`](team-shell/README.zh.md) | Control Plane | 供 `team-local-handoff` 使用的可选浏览器确认 | — |
| [`team-update/`](team-update/README.zh.md) | Runner | 一个被提供的发行版是否可以安装，以及安装程序所写入的服务定义 | — |

-----

<a id="related-documentation"></a>
## 相关文档

- [团队登录子系统](../../docs/subsystems/team-handoff.zh.md)——3090 成员流程与仅供管理员使用的 3095 边界。
- [设备授权子系统](../../docs/subsystems/device-authorization.zh.md)——这些端点所暴露、这个客户端所驱动的接缝。
- [`client/connection`](../client/connection/README.zh.md)——拥有这些端点所发放的本地浏览器会话。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

默认 Team Bundle 组合 `team-local-login`，不组合可选 Handoff 与 Shell。如果部署刻意恢复浏览器 Handoff，其 `/team/callback` 必须保留该包文档所述的自我导航 200 响应。

</details>
