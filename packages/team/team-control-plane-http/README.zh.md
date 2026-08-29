---
description: "Control Plane 面向 Runner 的绑定端点：开启 Transaction、兑换 Authorization Code、交换 Refresh Token。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-control-plane-http

[English](README.md) | 中文

## 概述

`dsh-team-control-plane-http` 提供 Runner 调用的三个端点：开启一个绑定 Transaction、兑换一个 Authorization Code、交换一个 Refresh Token。它们都不接受浏览器会话，因为它们都不由会话授权——开启一个 Transaction 既证明不了什么也学不到什么，另外两个由 PKCE Verifier、设备签名和一次性 Code 授权。成员浏览器使用的那些端点属于 Team Shell。

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
  '@deepseek-ai/dsh-team-control-plane-http':
    pathPrefix: /team/device
    maxRequestBodyBytes: 16384
```

三个路径是 `POST {pathPrefix}/start`、`/redeem` 和 `/refresh`。一次拒绝回答 403 并携带接缝自己的词，因此 Runner 无需解析消息就能把"再试一次"与"重新绑定这台电脑"区分开；一个本端点读不了的请求体回答 400。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 每一个请求体在接缝看到它之前都被解析

接缝的类型是它的调用方所许下的承诺，而一个经 HTTP 到达的调用方并未许下这样的承诺。每个端点逐字段构造接缝自己的请求，因此缺失的 `publicKey` 或设备词表不治理的平台在这里就是 400，而不是更深处的一次约束违反。

### 不是拒绝的失败不说明自己

一次拒绝携带接缝的词。其他任何情况回答 500 并附 `{"error":"internal"}`：Runner 得知这个部署有问题，除此之外什么也不知道。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 三条路由、请求体解析与拒绝映射 |
| [`src/protocol.ts`](src/protocol.ts) | 两侧共同导入的路径与协议版本 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [团队 Handoff 子系统](../../../docs/subsystems/team-handoff.zh.md)——两侧的完整流程。
- [`device-authorization`](../../account/device-authorization/README.zh.md)——这些端点所暴露的接缝。
- [`team-account-client`](../team-account-client/README.zh.md)——调用它们的那个 Runner。

<a id="model-experience"></a>
## 模型体验

无，因为这些端点只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **没有面向浏览器的端点** —— 读取一个待确认 Transaction 并确认它需要一个 Control Plane 会话，随 Team Shell 一起到来。
- **没有限速** —— 接缝会拒绝错误的 Code 或签名，但这里没有任何东西在两次尝试之间放慢调用方。
- **协议版本是发送的，不是协商的** —— Runner 声明它说哪个版本，接缝拒绝不匹配。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

这些端点是对着一个真实的设备授权组合而不是桩来测试的，因为值得测的是：一个经 HTTP 到达的请求体，能以接缝所要求的形态抵达接缝。

</details>
