---
description: "受治理知识库、BI 与 GMO 端点在 Team Runner 与 Control Plane 之间共用的传输：一端是请求开启与拒绝信封，另一端是设备令牌调用与拒绝解码。"
kind: "package-library"
---

# @deepseek-ai/dsh-team-governed-wire

[English](README.md) | 中文

## 概述

`dsh-team-governed-wire` 让受治理的能力提供并调用它的 Runner 端点，而不必重新实现传输。在 Control Plane 上，它依次检查方法、请求体上限、协议版本与设备令牌，并用封闭的拒绝词及其 HTTP 状态应答。在 Runner 上，它带着当前令牌提交版本与字段，并把每个应答变成该能力的错误。路径、版本、原因与字段仍由能力自己保留。

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

### 何时使用

Control Plane 端用在 `*-gateway-http` 插件里，Runner 端用在对应的 `*-team` 提供方里。`dsh-knowledge-gateway-http`、`dsh-bi-gateway-http` 与 `dsh-gmo-gateway-http` 引用前者；`dsh-knowledge-team`、`dsh-bi-team` 与 `dsh-gmo-team` 引用后者。信封不同的端点（例如模型流量）不使用它。

### 入口

Control Plane 端包装每条路由；该函数解码请求体并返回要执行的操作，请求体格式不对时返回 `undefined`：

```text
const serve = (parse: ParseRoute) => governedHandler({ protocol, limit, verify, reasonOf }, parse)
const results = { kind: 'exact', path, handler: serve(opened => ref === undefined ? undefined : () => gateway.results({ ...opened.principal, ref })) }
```

Runner 端绑定一次能力，之后每个操作调用一次：

```text
const call = governedClient({ fail, reasons, fetch, baseUrl, account })
const body = await call(PATH, PROTOCOL_VERSION, { ref }, signal) // throws the capability's error
```

`COMMON_REFUSAL_STATUS` 保存所有能力共用的拒绝词及其状态。能力把自己的词加到它的副本里。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

两端放在一个包里，使它们必须一致的事实只有一个归属：`authorization` 承载令牌的请求头、在解码任何其他字段之前就执行的版本范围检查、`{ error, reason }` 拒绝信封，以及告诉 Runner 去更新的 `update-required` 响应体。

开启请求时按固定顺序拒绝。POST 之外的方法答 405。请求体超过上限、不是 JSON 或不是对象答 400。版本落在范围之外答 426，且发生在查看令牌之前，因为过期的 Runner 重新登录也无法自行修复。未知、已失效或已吊销的令牌答同一个 401。解码发生在失败处理之外，所以本构建读不懂的字段是 400，而不会成为授权结果。能力点名的失败答它的原因与状态；其他任何失败答 500 且不带原因词。

在 Runner 上，fetch 失败、应答不是 JSON 对象，以及本构建不认识的拒绝词，都变成 `control-plane-unreachable`：成员对这些情形无法采取不同的行动。读不到令牌则变成 `unauthenticated`。

| 文件 | 内容 |
|---|---|
| [`src/server.ts`](src/server.ts) | 请求开启、路由处理函数与拒绝应答 |
| [`src/client.ts`](src/client.ts) | 绑定后的 Runner 调用与拒绝解码 |
| [`src/protocol.ts`](src/protocol.ts) | 请求头与共用的拒绝表 |
| [`src/types.ts`](src/types.ts) | 协议、选项与处理函数类型 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-gmo-gateway-http`](../../gmo/gmo-gateway-http/README.zh.md)——一种能力在这条传输上的路由。
- [`dsh-gmo-team`](../../gmo/gmo-team/README.zh.md)——它的 Runner 提供方。
- [`dsh-team-account-client`](../team-account-client/README.zh.md)——Runner 端使用的 fetch 与访问令牌。

<a id="model-experience"></a>
## 模型体验

无，因为本包通过 HTTP 传输封闭的词、引用与版本，不注册任何提示词、schema 或结果文本；模型看到的一切由 Runner 侧工具负责。

#### KV Cache 影响

这里没有请求前缀的变化；拒绝词只会经由 Runner 侧工具的结果到达模型。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **每个能力一个协议版本范围**——Control Plane 端只检查一个最小版本与当前版本；知识库能力按操作发送版本，并依赖这个范围。
- **模型与发布流量保留各自的信封**——`dsh-web-search-gateway-http`、`dsh-model-gateway-http` 与 `dsh-team-release-http` 重复了请求开启的一部分，尚未迁移。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：本包不持有状态，拒绝的先后顺序由本包以及各能力在真实 HTTP 服务器上的测试驱动。
