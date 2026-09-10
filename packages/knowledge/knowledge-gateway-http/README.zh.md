---
description: "面向 Runner 的知识端点：设备 Token 验证、先于其他任何字段的协议版本协商、严格请求解析，以及封闭拒绝映射。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-gateway-http

[English](README.md) | 中文

## 概述

`dsh-knowledge-gateway-http` 提供 Team Runner 访问私有知识所调用的两条路由：读取已授权目录，以及在其中检索。它做的一切都围绕一个事实展开——请求不得能够声明是谁在问、答案从哪里来。主体从已验证的设备 Access Token 恢复，绝不从请求体读取；数据源由目录解析，在请求中根本没有位置。在 Control Plane 中与它所前置的受治理网关并排挂载。

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

在 `team-control-plane` 组合中，于 Web 服务器、受治理网关和设备授权之后挂载。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-knowledge-gateway-http'
  config:
    maxRequestBodyBytes: 65536
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxRequestBodyBytes` | `65536` | 接受的最大请求体；一个查询加一个范围用不了多少 |

### 两条路由

`POST /team/knowledge/catalog` 只接受 `protocolVersion`，回答主体的已授权目录。`POST /team/knowledge/search` 增加 `query`、`scope` 和可选的 `maxResults`。两个请求体都没有组织、主体、设备、数据源、地址、租户、凭据或上游 id 的字段——Runner 说出它想要什么，其余由 Control Plane 解析并授权。

### 版本最先判定

`protocolVersion` 在解码任何其他字段之前、也在验证 Token 之前被检查。两个次序都是有意的。用发送方并非指代的语法去解码请求体，正是版本检查失去意义的方式；而告诉一个版本过旧的 Runner「重新登录」——当通过本构建拒绝的协议登录根本无济于事时——会把成员送进一个循环。不受支持的版本以 `426` 应答并携带支持范围，因为 Runner 无法通过对方刚刚说它不会说的协议去索取该范围。

知识拥有自己的版本，而不共用设备绑定的那个：两者独立演进，而且抬高知识最小值不得把老 Runner 挡在绑定之外——绑定恰恰是它恢复所需要的那一个操作。

### 拒绝

每个拒绝都携带一个封闭的知识理由，使 Runner 无需解析消息就能区分「重新登录」「去找管理员」和「稍后再试」。

| 理由 | 状态码 |
|---|---|
| `unauthenticated` | 401 |
| `not-allowed` | 403 |
| `scope-unavailable`、`scope-incompatible` | 409 |
| `upstream-unavailable`、`upstream-invalid` | 502 |
| `control-plane-unreachable` | 503 |
| `update-required` | 426 |
| `cancelled` | 499 |

不是知识失败的失败，是本部署自身的缺陷，而不是 Runner 做错了什么，因此以 `500` 应答且不带理由词：编造一个会让成员去做一件无济于事的事。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

这两条路由对知识不做任何判定。它们确立是谁在问、证明请求格式良好，然后把两者交给网关；每一个授权结果和每一个上游事实都属于网关。这正是为什么畸形引用在这里是 `400`，而未授权引用是来自网关的 `403`：前者是协议错误，后者是一次判定。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/protocol.ts`](src/protocol.ts) | 路径、版本常量，以及双方共同 import 的请求体 |
| [`src/index.ts`](src/index.ts) | 两条路由、共享的开场序列，以及拒绝映射 |

<a id="further-exploration"></a>
## 延伸阅读

- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 这两条路由承载的受治理词汇。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— Runner 请求为何没有地址或主体的位置。

<a id="model-experience"></a>
## 模型体验

无，因为这两条路由运行在 Control Plane，而 Control Plane 不挂载 agent 也不挂载工具注册表，模型永远到不了它们。

#### KV Cache 影响

这里不会改变任何请求前缀。段落只有在 Runner 侧工具渲染之后才成为模型可见内容，前缀开销落在那里。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本适配器自身在何处不完整。它们是当前的包约束。

- **不转发取消** —— 客户端在检索中途断开不会中止上游调用；结束它的是网关自身的上界。把请求的 abort 信号串下去，需要一个能携带它的路由契约。
- **没有文档阅读路由** —— 在阅读文档全文交付之前，这两条路由就是面向 Runner 的全部接口面。
- **没有限流** —— 一台设备可以多频繁检索的上界属于这里，而目前没有任何地方施加；当前的答案是前置的反向代理。
- **`cancelled` 映射到非标准的 499** —— 没有已注册的状态码描述被客户端放弃的请求，而 Runner 读的是理由词；状态码是给日志看的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变量：**不发布伴随文件：该适配器在请求之间不持有状态，也不发布事件流；请求无法自称主体是结构性事实：请求体没有相应字段，身份来自已验证的 token。
