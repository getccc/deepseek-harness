---
description: "Control Plane 的公司模型端点：授权、附上凭据、流式转发 Provider 的答案，并按它报告的内容结算。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-gateway-http

[English](README.md) | 中文

## 概述

`dsh-model-gateway-http` 是公司模型调用的内容真正经过 Control Plane 的地方，也是唯一附上 Provider 凭据的地方。它所做的一切都围绕两个事实展开：请求不能说出自己去往何处，响应不能被留在内存里。它验证设备 Access Token，询问[网关](../model-gateway/README.zh.md)，在一次调用的时长内解析凭据，把 Provider 的答案流式转发回去，并按 Provider 所说的花费结算那笔预留。

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

### 凭据只为一次调用而存在

它在这里被解析，而不被写到任何地方——不写进计划、不写进目录、不写进日志。一条指名了没人配置过的引用、或者根本不是凭据引用的目录记录，回答 500 且不计费：那是这个部署的问题，不是成员的。

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
| [`src/index.ts`](src/index.ts) | 端点、代理与结算判定 |
| [`src/usage.ts`](src/usage.ts) | 从一个没人缓冲的响应中读出 Provider 的 Usage |
| [`src/protocol.ts`](src/protocol.ts) | 两侧共同导入的路径与请求体 |
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

- **只有一条上游路径** —— `/v1/chat/completions`，与 Transport 所承载的那一个操作对应。第二个操作需要它自己的路径映射，而不是调用方提供的路径。
- **没有审计记录** —— 设计要求对每一次公司模型的允许与拒绝各写一条；那条记录需要本端点已经持有的关联标识与设备，补上它是一次本次未做的小改动。
- **除"不记录"之外没有内容日志抑制** —— 端点不写关于请求体的任何东西，但它不配置周围的进程，而一个在别处开启了请求日志的部署会让这一点失效。
- **响应被流式转发但没有字节上限** —— 一个永不停止发送的 Provider 由 `upstreamTimeoutMs` 切断，而不是由字节上限切断。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试跑的是一个记录收到内容的真实 HTTP Provider，因为值得证明的两个事实都关于它收到的字节——凭据被附上了、model 字段是目录的那个——而一个 mock 只会报告测试告诉它要期待的东西。

</details>
