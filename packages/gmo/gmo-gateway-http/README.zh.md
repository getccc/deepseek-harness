---
description: "Control Plane 面向 Runner 的 GMO HTTP 端点：经令牌校验、检查协议版本的目录、结果列表、描述与提问路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-gateway-http

[English](README.md) | 中文

## 概述

`dsh-gmo-gateway-http` 在 Control Plane 的 web server 上注册 Runner 调用的四条路由——`/team/gmo/catalog`、`/results`、`/describe` 与 `/ask`。请求必须无法声明是谁在问或答案从哪里来：主体取自已验证的设备令牌，绝不读自请求体；数据源由目录解析，在请求里没有位置。协议版本先于其他任何字段被检查，所以这个构建无法与之对话的 Runner 会被告知去更新。

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

在 web server、GMO 网关与设备授权之后挂载到 Control Plane。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-gmo-gateway-http'
  config:
    maxRequestBodyBytes: 65536
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `maxRequestBodyBytes` | `65536` | 接受的最大请求体；一个提问可以列出很多筛选值 |

### 路由

| 路由 | 请求体 | 回答 |
|---|---|---|
| `POST /team/gmo/catalog` | `protocolVersion` | 已授权目录：引用与显示名 |
| `POST /team/gmo/results` | `protocolVersion`、`ref`，可选 `page`、`pageSize` | 一个分类的一页结果 |
| `POST /team/gmo/describe` | `protocolVersion`、`resultRef` | 一份结果的描述 |
| `POST /team/gmo/ask` | `protocolVersion`、`resultRef`、`query` | 数据源的有界答案 |

每条路由只接受 `POST`，读取有界的 JSON 对象，检查 `protocolVersion`，校验 bearer 令牌，之后才解码该操作的字段。不支持的版本以 `426` 回答并附上支持范围，不执行任何操作。

### 提问被解析而不是被信任

`query` 由域包的 `readGmoQuery` 读取：三种，每种只有它定义的键，列名必须像列名，列表有界。多出一个键的请求被当作格式错误拒绝，因为 Runner 以为筛选生效、控制面却把它丢掉，会得出一个自信的错误数字。

### 拒绝

| 原因 | HTTP 状态 |
|---|---|
| `unauthenticated` | `401` |
| `not-allowed` | `403` |
| `scope-unavailable`、`result-unavailable`、`unsupported` | `409` |
| `invalid-query` | `422` |
| `too-large` | `413` |
| `upstream-unavailable`、`upstream-invalid` | `502` |
| `update-required` | `426` |
| `cancelled` | `499` |

响应体是 `{ "error": "gmo", "reason": <词> }`，从不携带上游文本。不是 `GmoError` 的失败是本部署自己的缺陷，以 `500` 回答，不带原因。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

路由在分叉之前做的所有事——方法、请求体、版本、身份——只做一次，且按此顺序。版本在身份之前，所以过时的 Runner 会被告知去更新，而不是去登录；身份在任何操作之前，所以被拒绝的请求不会让数据源付出任何代价。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件、四条路由与拒绝映射 |
| [`src/protocol.ts`](src/protocol.ts) | 路径、协议版本范围，以及 Runner 提供方导入的请求体类型 |

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——路由用来回答的词汇。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——协议优先的拒绝，以及提问为何是封闭词汇。

<a id="model-experience"></a>
## 模型体验

无，因为路由运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它们。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **只有一个协议版本**——`GMO_PROTOCOL_VERSION` 及其最小值都是 `1`；保留这个范围是为了让第一次不兼容变更有去处。
- **请求体有界，答案不分页**——一个提问返回一个有界答案；没有流式，也没有续传令牌。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：插件注册四条路由，其拒绝由本包的测试在真实 HTTP 服务器、真实设备凭据与真实网关之上驱动。
