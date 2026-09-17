---
description: "BI 分析能力族的包地图：Team Runner 用来获取成员可分析的已保存图表的 BI 服务接缝。"
kind: "package-group"
---

# bi/ —— BI 分析能力族

[English](README.md) | 中文

## 摘要

`bi/` 组通过一个与提供方无关的服务（`ctx.bi`）为 harness 接入公司的 BI 系统。已保存图表受治理：成员可以分析哪些项目是管理员做出的角色决定，它可能随时变化，而触达 BI 源的凭据不能放在成员的进程里。因此该接缝只命名产品操作；在 Team Edition 中，Runner 侧的提供方把每个操作转发给负责授权的 Control Plane。本组拥有词汇表——`BiProjectRef`、`BiChartRef`、`bi/scope` Session 事件与封闭的失败集合——不拥有客户端、存储或工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

五个包扮演 BI 相关角色；子系统参考拥有穷尽的词汇与契约，Agent Note 列出了这项能力其余部分要加入的包。

| 包 | 角色 | ctx key |
|---|---|---|
| [`bi/`](bi/README.zh.md) | BI 服务：已授权项目目录、已保存图表列表、图表执行、稳定引用和会话范围 | `ctx.bi` |
| [`bi-source/`](bi-source/README.zh.md) | 上游数据源接缝：列出数据源的项目与某个项目的图表、定位图表、执行一张已授权的图表 | `ctx.biSource` |
| [`bi-webi/`](bi-webi/README.zh.md) | 说 webi 的四条固定路由，把个人访问令牌留在 Control Plane | 注册到 `ctx.biSource` |
| [`bi-gateway/`](bi-gateway/README.zh.md) | 受治理网关接缝：持久项目目录，以及已授权目录、图表列表与图表执行 | `ctx.biGateway` |
| [`bi-gateway-sqlite/`](bi-gateway-sqlite/README.zh.md) | 基于 SQLite 的持久目录，带同步、逐项目授权与审计 | 注册到 `ctx.biGateway` |

-----

<a id="related-documentation"></a>
## 相关文档

先读子系统参考了解共享词汇，再读解释接缝为何如此设计的提案。

- [BI 子系统](../../docs/subsystems/bi.zh.md)——目录、图表列表、图表执行、会话范围、稳定引用与封闭的失败分类。
- [Team BI 分析 Agent Note](../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)——BI 为何留在 Control Plane 之后，以及第一阶段不做什么。

<a id="dev-note"></a>
## Dev Note

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
