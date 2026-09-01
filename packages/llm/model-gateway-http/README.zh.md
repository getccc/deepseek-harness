---
description: "Control Plane 的公司模型端点：授权、附上凭据、流式转发 Provider 的答案，并按它报告的内容结算。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-gateway-http

[English](README.md) | 中文

## 概述

`dsh-model-gateway-http` 提供面向 Runner 的模型目录与公司模型调用路径。发现操作验证设备访问 token，并向[网关](../model-gateway/README.zh.md)询问该主体可以发现的活跃模型。调用操作是模型内容经过 Control Plane 的地方，也是唯一附上提供方凭据的地方：请求不能说出自己去往何处，响应不留在内存中，预留按提供方报告的内容结算。

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

```yaml
plugins:
  '@deepseek-ai/dsh-model-gateway-http':
    maxRequestBodyBytes: 4194304
    upstreamTimeoutMs: 600000
```

`upstreamTimeoutMs` 应当高于部署所预期的最长一次完成。在这里被切断的请求会按其上限计费，因为一个停止应答的 Provider 可能仍然生成过 Token。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 对每一个坏 Token 只有一种回答

未知的 Token、过期的 Token、设备已被撤销的 Token，一律回答 401。究竟是哪一种，恰恰是持有陈旧 Token 的攻击者想要知道的。

### 发现使用同一个设备主体

`GET /team/model/catalog` 验证当前设备 token，并且只返回 `model.discover` 允许的每个活跃模型的稳定引用与显示名。端点、上游模型与凭据引用留在 Control Plane。`POST /team/model/invoke` 会独立询问 `model.invoke`，因此知道或保留模型引用无法绕过调用决策。

### 凭据只为一次调用而存在

它在这里被解析，而不被写到任何地方——不写进计划、不写进目录、不写进日志。一条指名了没人配置过的引用、或者根本不是凭据引用的目录记录，回答 500 且不计费：那是这个部署的问题，不是成员的。

### Provider Base URL 保留路径前缀

目录中的 endpoint 是 OpenAI 兼容 Base URL，而不是完整的操作 URL。以 `/v1` 结尾的 Base URL 会追加 `chat/completions`，其余 Base URL 会追加 `v1/chat/completions`。因此 DashScope 的 `/compatible-mode/v1` 前缀得以保留，而 `https://api.deepseek.com` 仍然到达 `/v1/chat/completions`。

### Usage 靠"看着它过去"读取，而不是靠留住它

[`UsageScanner`](src/usage.ts) 在响应经过时只保留一行和一个 usage 对象。两种响应形态经由同一个扫描器：非流式响应体是一份 JSON 文档，而流是一串 `data:` 帧、其最后几帧携带 usage。

### 每种结果如何结算

| 结果 | 结算 |
|---|---|
| Provider 报告了 Usage | `reported`，无论状态如何——那些 Token 已经生成 |
| 状态 ≥ 400 且没有 Usage | `released`——Provider 表示它没有接受该请求 |
| 成功但没有 Usage 字段 | 按上限 `estimated`——它可能仍然产出了 Token |
| 完全没有响应 | 按上限 `estimated`——没有响应不是拒绝的证据 |

### 结算失败不是成员的问题

如果结算抛错，成员已经收到的响应保持有效，由 [Reconciler](../../access/quota/README.zh.md) 稍后关闭那笔预留。在这里抛错，会用一个关于记账的错误替换掉一个已经可用的答案。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 发现与调用端点、代理及结算判定 |
| [`src/usage.ts`](src/usage.ts) | 从一个没人缓冲的响应中读出 Provider 的 Usage |
| [`src/protocol.ts`](src/protocol.ts) | 两侧共同导入的路径与请求体定义 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [模型网关子系统](../../../docs/subsystems/model-gateway.zh.md) —— 完整判定的散文版。
- [`llm-http-transport-team`](../llm-http-transport-team/README.zh.md) —— 调用它的 Runner 一侧。
- [`quota`](../../access/quota/README.zh.md) —— 一笔结算落到哪里。

<a id="model-experience"></a>
## 模型体验

无，因为端点承载的是 Adapter 构造的请求，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

端点在调用上行之前改写 model 字段，因此两个映射到同一上游模型的目录 Ref 产生相同字节，Provider 的缓存得以保留。请求体中的其余部分一概不动。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **只有一种上游操作** —— 仅支持 Chat Completions，与 Transport 所承载的那一个操作对应。第二个操作需要它自己的路径映射，而不是调用方提供的路径。
- **没有审计记录** —— 设计要求对每一次公司模型的允许与拒绝各写一条；那条记录需要本端点已经持有的关联标识与设备，补上它是一次本次未做的小改动。
- **除"不记录"之外没有内容日志抑制** —— 端点不写关于请求体的任何东西，但它不配置周围的进程，而一个在别处开启了请求日志的部署会让这一点失效。
- **响应被流式转发但没有字节上限** —— 一个永不停止发送的 Provider 由 `upstreamTimeoutMs` 切断，而不是由字节上限切断。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试跑的是一个记录收到内容的真实 HTTP Provider，因为值得证明的两个事实都关于它收到的字节——凭据被附上了、model 字段是目录的那个——而一个 mock 只会报告测试告诉它要期待的东西。

</details>
