---
description: "GMO供应链分析能力族的包地图：Team Runner 用来获取成员可分析的处理结果的 GMO 服务。"
kind: "package-group"
---

# gmo/ —— GMO供应链分析能力族

[English](README.md) | 中文

## 摘要

`gmo/` 组通过一个与提供方无关的服务（`ctx.gmo`），让 harness 使用公司的 GMO供应链协同自动化平台 excel-tools。它的处理结果受治理：成员可分析哪些业务线（如 GB / GL 分配这样的分类）由管理员按角色决定，而通往 excel-tools 的令牌不能放在成员的进程里。在 Team 版里，Runner 侧的提供方把每个操作转发给负责授权的 Control Plane。本组拥有词汇表——分类与结果引用、提问词汇、`gmo/scope` 会话事件、封闭的失败集合——以及读取它们的面向模型的工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

本组的八个包扮演 GMO 相关角色；控制器和 composer 控件与其他 Team 浏览器包放在一起。子系统参考拥有穷尽的词汇与契约。

| 包 | 角色 | ctx key |
|---|---|---|
| [`gmo/`](gmo/README.zh.md) | GMO 服务：已授权分类目录、结果列表、描述、提问、稳定引用和会话范围 | `ctx.gmo` |
| [`gmo-source/`](gmo-source/README.zh.md) | 上游数据源接缝：列出数据源的分类与结果、定位并描述一份结果、向一份已授权的结果提问 | `ctx.gmoSource` |
| [`gmo-excel-tools/`](gmo-excel-tools/README.zh.md) | 说 excel-tools 固定的只读网关路由，把网关令牌留在 Control Plane | 注册到 `ctx.gmoSource` |
| [`gmo-gateway/`](gmo-gateway/README.zh.md) | 受治理网关接缝：持久分类目录，以及已授权目录、列表、描述与提问 | `ctx.gmoGateway` |
| [`gmo-gateway-sqlite/`](gmo-gateway-sqlite/README.zh.md) | 基于 SQLite 的持久目录，带同步、逐分类授权与审计 | 注册到 `ctx.gmoGateway` |
| [`gmo-gateway-http/`](gmo-gateway-http/README.zh.md) | Runner 调用的四条路由，带令牌校验与协议版本协商 | 在 `ctx.webServer` 上注册路由 |
| [`gmo-team/`](gmo-team/README.zh.md) | Runner 侧提供方：每个操作一次 Control Plane 请求，携带设备令牌 | 注册到 `ctx.gmo` |
| [`tool-gmo/`](tool-gmo/README.zh.md) | 模型所见：五个工具、范围提示词段与范围驱动的可见性 | 注册到 `ctx.tools` 与 `ctx.systemPrompt` |

另有两个位于别处的包补全这项能力：[`api/gmo-controller`](../api/gmo-controller/README.zh.md)，仅 Team 的 Remote，向浏览器提供其已授权的分类并记录选择；[`client/ui-gmo`](../client/ui-gmo/README.zh.md)，composer 控件。

-----

<a id="related-documentation"></a>
## 相关文档

先读子系统参考了解共享词汇，再读解释这项能力为何如此设计的提案。

- [GMO 子系统](../../docs/subsystems/gmo.zh.md)——目录、列表、描述、提问词汇、会话范围、稳定引用与封闭的失败分类。
- [Team GMO供应链分析 Agent Note](../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——为何以分类为授权单位、业务规则为何随数据而行，以及第一阶段不做什么。

<a id="dev-note"></a>
## Dev Note

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
