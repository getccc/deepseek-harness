---
description: "Provider HTTP Transport Service Definition：模型请求如何到达 Provider，与请求说了什么相分离。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-http-transport

[English](README.md) | 中文

## 概述

`dsh-llm-http-transport` 把模型请求"如何传输"与"说了什么"分开。LLM Adapter 保留它已经拥有的一切——序列化请求、解析流、图片与文件语义——而 Transport 只替换那一趟：成员自己的钥匙直连 Provider，或者公司模型经由 Control Plane、用一份 Runner 从不持有的凭据。请求指名的是封闭列表中的一个操作和一个模型，绝不是一个 URL。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-llm-http-transport'

declare const ctx: Context

const response = await ctx.llmHttpTransport.send({
  operation: 'chat.completions',
  modelRef: 'company-v4',
  body: { model: 'company-v4', messages: [{ role: 'user', content: 'hi' }] },
  inputTokens: 1_200,
})
```

响应体是一个流。模型响应很长，而一个把它缓冲起来的 Transport，会为每个请求在内存里留住一整份 completion。

`listModels()` 可以选择把发现所有权交给 Transport。它默认返回 `undefined`，表示 Adapter 使用本机目录。远程策略 Transport 则返回当前主体的稳定 id 与显示名。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 操作列表是封闭的

`TRANSPORT_OPERATIONS` 在代码中注册。一个接受任意路径的 Transport，就是一个调用方可以指向任何地方的 Transport，而那正是这个接缝存在要防的全部——它也让 Control Plane 能够拒绝一个它没有同意承载的操作。

### 失败是一个词，不是一条消息

`TransportFailedError` 携带 `refused`、`unreachable` 或 `not-bound`，因为调用方必须决定是否重试，而一个句子不是一个决定。一个以错误状态回答的 Provider 不是传输失败：那是一个响应，会被返回。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务、它的失败，以及 `ctx.llmHttpTransport` |
| [`src/vocabulary.ts`](src/vocabulary.ts) | 封闭操作列表 |
| [`src/types.ts`](src/types.ts) | Transport 承载什么、交回什么，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`llm-http-transport-team`](../llm-http-transport-team/README.zh.md) —— 公司 Transport。
- [模型网关子系统](../../../docs/subsystems/model-gateway.zh.md) —— Control Plane 拿它承载的请求做什么。

<a id="model-experience"></a>
## 模型体验

无，因为本接缝声明的是请求如何传输，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

Transport 不改变 Adapter 构造的字节，因此它自身没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **只有一个操作** —— `chat.completions`。这个列表的存在，是为了让第二个成为一次带名字的新增，而不是调用方提供的一条路径。
- **暂无 Direct Provider** —— 成员自己的 BYOK 路线仍走 Adapter 既有路径；把它移到这个接缝之后是它自己的一次改动。
- **`inputTokens` 是调用前计量** —— 存在 Adapter 计数时由 seam 携带；没有 Provider tokenizer 的 Adapter 发送零，Control Plane 再根据 Provider 报告的用量结算。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

`TransportRequest` 里没有 URL，这是设计而不是遗漏。加上它会让每一个 Transport 都变成"调用方决定凭据去往何处"的地方。

</details>
