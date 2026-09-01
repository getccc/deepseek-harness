---
description: "私有知识能力族的包地图：Team Runner 用来获取成员可访问的公司知识的知识服务接缝。"
kind: "package-group"
---

# knowledge/ —— 私有知识能力族

[English](README.md) | 中文

## 摘要

`knowledge/` 组通过一个与提供方无关的服务（`ctx.knowledge`）为 harness 提供公司私有知识——一份已授权目录，以及在其上的段落检索。它之所以存在，是因为公司知识是受治理的：成员可以检索哪些知识库是管理员做出的角色判定，它可能在两个问题之间就发生变化，而访问知识源的凭据绝不能待在成员的进程里。因此接缝只命名产品操作，而在 Team Edition 中由 Runner 侧提供方把每个操作转发给一个依据当前账户、设备和授权做判定的 Control Plane。本组拥有相应词汇：跨重命名命名知识库的 `KnowledgeRef`、记录会话可用哪些知识的 `knowledge/scope` 会话事件，以及封闭的失败集合。它不拥有上游客户端、存储或面向模型的工具。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## 包

三个包扮演知识相关角色；子系统参考拥有穷尽的词汇与契约。

| 包 | 角色 | ctx key |
|---|---|---|
| [`knowledge/`](knowledge/README.zh.md) | 知识服务：已授权目录、段落检索、稳定引用和会话范围 | `ctx.knowledge` |
| [`knowledge-source/`](knowledge-source/README.zh.md) | 上游数据源接缝：列出数据源，并检索其中一个已授权的知识库集合 | `ctx.knowledgeSource` |
| [`knowledge-weknora/`](knowledge-weknora/README.zh.md) | 说 WeKnora 的两个固定端点，把凭据留在 Control Plane | 注册到 `ctx.knowledgeSource` |

-----

<a id="related-documentation"></a>
## 相关文档

先看子系统参考了解共享词汇，再看解释接缝为何是这个形状的提案。

- [知识子系统](../../docs/subsystems/knowledge.zh.md) —— 目录、检索、会话范围、稳定引用和封闭失败分类。
- [Team 私有知识 Agent Note](../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 私有知识为何始终经由 Control Plane，以及第一阶段不做什么。

<a id="dev-note"></a>
## Dev Note

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
