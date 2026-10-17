---
description: "excel-tools 的 GMO 数据源提供方：在 Control Plane 中持有网关令牌，说 excel-tools 固定的只读路由，并限制条数、时间与字节数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-excel-tools

[English](README.md) | 中文

## 概述

`dsh-gmo-excel-tools` 是 Control Plane 里唯一持有 excel-tools 网关令牌并说其协议的地方。它注册到 `ctx.gmoSource`，调用 excel-tools `/api/gateway` 的一组固定只读路由：分类列表、某个分类的结果、一份结果的定位与描述、聚合、现成看板、明细行以及供需视图。这里的任何东西都不知道谁在问；位于其前的网关已经决定了这一点。

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

把它与 `dsh-gmo-gateway-sqlite` 一起挂载在 Control Plane。令牌在 excel-tools 的 管理 → 对话网关 页面创建，存放在某个凭据引用之下；它只读取统计数据，不提供导出、下载、删除、上传或工具运行。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-gmo-excel-tools'
  config:
    sourceCode: gmo
    baseUrl: http://10.1.120.90:8700
    credentialRef: EXCEL_TOOLS_GATEWAY_TOKEN
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `sourceCode` | 无，必填 | 本部署对该数据源的代码，是每个分类引用的第二段；最多 19 个字符 |
| `baseUrl` | 无，必填 | excel-tools 提供服务的源，`http` 或 `https` |
| `credentialRef` | 无，必填 | 解析为网关令牌的凭据引用 |
| `requestTimeoutMs` | `60000` | 一次上游调用可以花多久 |
| `maxItems` | `200` | 一次请求最多要的行、分组、结果或排名条数 |
| `maxResponseBytes` | `700000` | 本进程读取的单个答案的最大字节数 |

错误的 `sourceCode`、`credentialRef` 或 `baseUrl` 在加载时失败，而不是在第一次操作时，因为每一个都会让之后的所有调用以读作故障的方式失败。

### 离开进程的内容

每个请求都带 `Authorization: Bearer <令牌>` 和一个请求 id，不带任何指名某个人的内容。令牌按操作解析，所以轮换在下一次调用就生效。

### 结果 id 与状态码

excel-tools 把多步结果的一步称为 `<id>~<阶段>`。`~` 不在引用字符集内，所以本提供方自己的 id 把它写成 `.`，只在拼路径时转换，并在任何请求发出之前拒绝不匹配 `[0-9a-f]{32}(.[a-z0-9-]+)?` 的 id。

| excel-tools 的回答 | 读作 |
|---|---|
| `400`、`422` | `invalid-query` |
| `404` | 结果路由上为 `result-unavailable`，列表上为 `upstream-invalid` |
| `409` | `unsupported`——结果存在但没有这个视图 |
| `413`，或超过 `maxResponseBytes` 的响应体 | `too-large` |
| `401`、`403`、`429`、`5xx`、没有应答 | `upstream-unavailable` |
| 其他，或不是 JSON 的响应体 | `upstream-invalid` |

上游的响应文本不会进入任何失败。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

提供方调用一个封闭的路由集合并做翻译，不做解释。提问以网关自己的参数名到达 excel-tools，上限被钳制到 `maxItems`；答案原样返回 excel-tools 产出的内容，只去掉它的 `category` 字段，因此数字不会在途中被重新计算或重新格式化。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方、它的配置、请求与失败映射，以及 excel-tools JSON 的读取器 |

### 数据模型

读取器校验网关词汇所指名的字段，忽略 excel-tools JSON 的其余部分，有一个例外：聚合、看板和明细的答案作为数据源的有界 JSON 直接通过，因为它们的字段取决于提问，而由发出提问的工具向模型描述它们。

<a id="further-exploration"></a>
## 延伸阅读

- [excel-tools 网关](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md#excel-tools-gateway)——本提供方调用的路由，以及它们为何固定。
- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——答案被读入的词汇。

<a id="model-experience"></a>
## 模型体验

无，因为提供方运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它；数字只有在网关授权、Runner 侧工具渲染之后才对模型可见。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **一个令牌触及每个分类**——excel-tools 没有逐分类令牌，所以 Control Plane 的逐分类授权是分类之间唯一的隔离。
- **不转发语句**——提问是三种之一，数据源对照结果校验它的列；这里不组装查询。
- **答案靠拒绝而不是截断来限制**——超过 `maxResponseBytes` 的答案以 `too-large` 被拒绝，由成员收窄提问。
- **CI 里没有实时契约测试**——路由由脚本化的夹具固定；对真实部署的运行是 `tests/excel-tools.e2e.ts`，需要 `EXCEL_TOOLS_BASE_URL` 和 `EXCEL_TOOLS_TOKEN`，缺少时跳过。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：提供方不拥有注册表，也不发出事件；上界与状态码映射由本包的测试断言。
