---
description: "Team Runner 的 GMO 提供方（ctx.gmo）：经公司 Control Plane 获取已授权分类目录、结果列表、描述与提问，只携带当前设备令牌，别无其他。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-team

[English](README.md) | 中文

## 概述

`dsh-gmo-team` 是 `ctx.gmo` 在 Runner 侧的提供方：每次目录读取、结果列表、描述或提问发出一次 Control Plane 请求，携带当前设备访问令牌和一个受治理引用。它发送的是引用、页码，或封闭词汇中的一个提问。它不发送、也无法发送的——因为协议里没有位置——是 excel-tools 地址、令牌、上游 id，或它自己的语句。

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

在 Team Runner 中与账号客户端一起挂载；`dsh-tool-gmo` 与 composer 控件建立在它之上。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-gmo-team'
  config:
    controlPlaneUrl: https://dsh.company.com
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `controlPlaneUrl` | 无，必填 | 公司 Control Plane 的源 |
| `controlPlaneCa` | 无 | PEM 文件路径，其中的证书是唯一被接受用于该 Control Plane 的证书 |

### 令牌

访问令牌每次调用时从账号客户端读取而不是持有，因为客户端会刷新它。没有登录的电脑在发送任何东西之前就以 `unauthenticated` 失败。

### 失败

拒绝的原因词按封闭集合解码；本构建不认识的词读作 `control-plane-unreachable`，因为编造一个含义会让成员去做可能没有帮助的事。DNS 失败、TLS 失败、吞掉请求的代理、不是 JSON 的响应体，以及已宕机的 Control Plane，对成员来说是同一件事，读法也相同。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

提供方在线路上校验返回的内容：引用必须能解析，字段必须有相应类型，答案的内容按 Control Plane 转发的样子原样通过。本构建读不懂的回复是 `upstream-invalid`，而不是部分答案，因为被悄悄收窄的结果对读它的模型来说与正确结果无法区分。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方、它的配置、调用，以及 Control Plane 答案的读取器 |

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——答案被读入的词汇。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——Runner 为何不持有 excel-tools 的地址或令牌。

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-gmo`——它向模型呈现结果列表、说明与答案，并拥有范围提示词段。本提供方不贡献提示词，也不注册 schema。

#### KV Cache 影响

没有直接失效；所指名的消费者拥有一次分类选择引起的请求前缀变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **每个操作一次请求**——没有批处理，也没有缓存，所以问十个问题的对话会发出十次 Control Plane 调用。
- **不重试**——失败的调用以封闭原因报告，由模型或成员决定是否再问。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

同步、目录与授权的代码是知识库和 BI 网关的第三份副本，`pnpm run duplication` 会报告这些重复。抽取共用的受治理目录助手是后续项：它会动到已发布、且没有任何已录制会话测试覆盖的知识库与 BI 代码，所以本次变更没有做。

</details>

**运行时不变量：** 不发布伴随包：提供方不拥有注册表，也不发出事件；离开电脑的内容由本包的测试逐字段断言，这些测试运行在一个记录请求的 HTTP 服务器上。
