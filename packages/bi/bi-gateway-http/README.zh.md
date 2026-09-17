---
description: "面向 Runner 的 BI 端点：设备令牌校验、先于任何其他字段的协议版本协商、严格的请求解析，以及封闭的拒绝映射。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-gateway-http

[English](README.md) | 中文

## 概述

`dsh-bi-gateway-http` 提供 Team Runner 为 BI 分析调用的路由：读取已授权项目目录、列出一个项目的已保存图表、执行其中一张。它做的一切都围绕一个事实——请求不能说出谁在问或答案来自哪里。主体从已校验的设备访问令牌恢复，绝不从请求体读取；数据源从目录解析，在请求里根本没有位置。在 Control Plane 中把它挂载在它所面向的受治理网关旁边。

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

在 `team-control-plane` 组合中，把它挂载在 web 服务器、受治理网关和设备授权之后。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-bi-gateway-http'
  config:
    maxRequestBodyBytes: 16384
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxRequestBodyBytes` | `16384` | 接受的最大请求体；一个引用和一个关键词所需甚少 |

### 这些路由

`POST /team/bi/catalog` 只接受 `protocolVersion`，回答主体的已授权项目目录。`POST /team/bi/charts` 增加 `ref` 以及可选的 `query`、`page` 和 `pageSize`。`POST /team/bi/query` 增加 `chartRef` 和可选的 `limit`。没有任何请求体有组织、主体、设备、数据源、地址、凭据、上游 id、筛选、参数或调用方自己查询的字段——Runner 说出它想要什么，Control Plane 解析并授权其余部分。已保存图表按保存时的样子执行。

关键词是请求体携带的唯一自由文本字段，被限制为最多 200 个字符的一行，因此它始终只是关键词；空关键词不收窄任何东西，读作没有。

### 版本最先判定

`protocolVersion` 在解码任何其他字段之前、在校验令牌之前检查。两种顺序都是有意的。用发送方并非本意的语法解码请求体，正是版本检查不再成其为检查的方式；而在通过本构建拒绝的协议重新登录无济于事时告诉过时的 Runner 重新登录，会把成员送进循环。不支持的版本回答携带受支持范围的 `426`，因为 Runner 无法通过对方刚说不会说的协议去询问那个范围。

BI 拥有自己的版本，而不与设备绑定或知识库的版本共享：这些协议独立演化，提升 BI 的最低版本不得把旧 Runner 锁在绑定之外，那是它为了恢复所需要的唯一操作。

### 拒绝

每个拒绝都携带封闭的 BI 原因，因此 Runner 无需解析消息就能区分“重新登录”、“找管理员”和“稍后重试”。

| 原因 | 状态码 |
|---|---|
| `unauthenticated` | 401 |
| `not-allowed` | 403 |
| `scope-unavailable`、`chart-unavailable` | 409 |
| `query-failed`、`upstream-unavailable`、`upstream-invalid` | 502 |
| `control-plane-unreachable` | 503 |
| `update-required` | 426 |
| `cancelled` | 499 |

失败的执行作为上游失败回答：数据仓库位于本 Control Plane 的上游，与 BI 服务一样，成员对两者能做的都只有重试或找管理员。不是 BI 失败的失败是本部署自己的缺陷而非 Runner 所为，因此以不带原因词的 `500` 回答：编造一个原因会让成员采取无济于事的行动。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

路由不对 BI 做任何决定。它们确认谁在问，证明请求格式正确，然后把两者交给网关；每个授权结果和每个上游事实都属于网关。这就是为什么畸形引用在这里是 `400`，而未授权的引用是网关给出的 `403`：前者是协议错误，后者是决策。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/protocol.ts`](src/protocol.ts) | 路径、版本常量，以及双方共同导入的请求体 |
| [`src/index.ts`](src/index.ts) | 路由、共享的开场序列，以及拒绝映射 |

<a id="further-exploration"></a>
## 延伸阅读

- [BI 子系统](../../../docs/subsystems/bi.zh.md)——这些路由承载的受治理词汇。
- [Team BI 分析 Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)——Runner 请求为何没有地址或主体的位置。

<a id="model-experience"></a>
## 模型体验

无，因为路由运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它们。

#### KV Cache 影响

这里没有请求前缀的变化。行数据只有在 Runner 侧工具渲染之后才对模型可见，其前缀成本落在那里。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了适配器何时单靠自身并不完整。它们是当前的包约束。

- **不转发取消**——执行中途断开的客户端不会中止上游执行；网关和提供方自己的上界才是终止它的东西。把请求的中止信号穿透过去需要一份携带它的路由契约。
- **没有速率限制**——一台设备多久可以执行一次图表的上界属于这里，目前没有任何东西施加；前面的反向代理是当前的答案。
- **`cancelled` 映射到非标准的 499**——没有注册的状态码描述客户端放弃的请求，Runner 读的是原因词；状态码只供日志。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：适配器在请求之间不持有状态，也不发布事件流；请求无法指名自己的主体是结构性的，因为请求体没有该字段，身份来自已校验的令牌。
