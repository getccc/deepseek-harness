---
description: "控制面面向 Runner 的网页搜索路由：设备令牌校验、协议版本协商、按成员的 web.search 决策、经控制面自身 web 服务执行的搜索，以及审计记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-gateway-http

[English](README.md) | 中文

## 概述

`dsh-web-search-gateway-http` 提供 Team Runner 用公司凭据搜索网页时调用的唯一路由：`POST /team/web/search`。主体从已校验的设备访问令牌中恢复，绝不从请求体读取；搜索经控制面自身的 `ctx.web` 执行，搜索提供方及其凭据都组合在那里，因此请求没有位置指名提供方、地址或密钥。每次调用都由组织 `web_search` 资源上的 `web.search` 决定，并记入审计日志。把它挂在控制面中、它所代理的 web 服务旁。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `team-control-plane` 组合中，把它挂在 web 服务器、带搜索提供方的 web 服务、设备授权、访问控制与审计之后。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: deepseek-official
- name: '@deepseek-ai/dsh-web-search-deepseek'
  config:
    apiKeyEnv: DEEPSEEK_API_KEY
- name: '@deepseek-ai/dsh-web-search-gateway-http'
  config:
    maxRequestBodyBytes: 16384
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxRequestBodyBytes` | `16384` | 接受的最大请求体；一个查询和一个上限用不了多少 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-gateway-http)是该字段的穷尽来源。

### 路由

`POST /team/web/search` 接受 `protocolVersion`、`query` 和可选的 `maxResults`，并原样回答 web 服务的结果：可选的 `content`、`sources` 与 `truncated`。请求体没有组织、主体、设备、提供方、地址或凭据的字段；Runner 说出它要什么，控制面解析并授权其余一切。

### 版本最先决定

`protocolVersion` 在解码任何其他字段之前、在校验令牌之前检查，因此请求体绝不会按发送方并不打算的语法解码，过旧的 Runner 也会被告知更新，而不是被送去重新登录。不支持的版本回答 `426` 并携带支持的范围。

### 谁可以搜索

令牌指名成员；路由随后向访问控制询问组织 `web_search` 资源上的 `web.search`，每次调用都重新询问，因此被撤销的授权会落在下一次搜索上。该资源由本路由在首次服务某个组织时注册，所以在第一次搜索之前就被授予该权限的角色已经覆盖它。管理员通过控制台的角色编辑器把该权限给角色，随附的导航在资源管理下带有"联网搜索"条目；覆盖整个目录的角色从一开始就持有它。

### 拒绝

| 原因 | 状态码 | 场景 |
|---|---|---|
| `update-required` | 426 | `protocolVersion` 超出支持范围 |
| `unauthenticated` | 401 | 没有令牌、未知令牌、已过期令牌或设备已吊销——一律同一答复 |
| `not-allowed` | 403 | 成员的角色都不持有 `web.search` |
| `upstream-unavailable` | 502 | 控制面的搜索后端没有提供方或没有凭据 |
| `upstream-invalid` | 502 | 搜索提供方回答了错误 |
| `cancelled` | 499 | 搜索被取消 |

格式错误的请求体回答 `400 { "error": "malformed" }`，POST 以外的方法回答 `405`，非 web 类的失败回答 `500 { "error": "internal" }`。

### 记录什么

每个做出决定的请求都针对组织资源写一条 `web.search` 审计事件：`allowed` 附返回的来源数，`denied` 附原因 `no-grant`，或 `error` 附成员收到的拒绝词。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

路由是 web 服务器上的一个处理器。它在配置的上限内读取请求体、检查版本、校验令牌、验证 `query` 与 `maxResults`、每个进程为组织注册一次 `web_search` 资源、询问访问控制、调用 `ctx.web.search`，并把抛出的 `WebError` 映射为拒绝：`WEB_ABORTED` 为 `cancelled`，提供方选择与凭据类的代码为 `upstream-unavailable`，其余 web 代码为 `upstream-invalid`。审计记录在 `webFailure` 下携带同一个词。线上词汇位于 [`src/protocol.ts`](src/protocol.ts)，由 Runner 侧提供方导入，因此两侧不会漂移。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 路由：版本、令牌、验证、决策、搜索、记录、拒绝映射 |
| [`src/protocol.ts`](src/protocol.ts) | 路径、头、版本、请求字段与封闭的拒绝集合 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-web-search-team](../web-search-team/README.zh.md)——调用本路由的 Runner 侧提供方。
- [Web 子系统](../../../docs/subsystems/web.zh.md)——本路由承载的搜索请求与结果。
- [dsh-access-control](../../access/access-control/README.zh.md)——`web.search` 所属的权限目录。
- [dsh-knowledge-gateway-http](../../knowledge/knowledge-gateway-http/README.zh.md)——私有知识的同形路由。
- [Team 网页搜索 Agent Note](../../../.agents/notes/implemented/feature/2026-09-15-team-web-search-through-the-control-plane.zh.md)——凭据为何绝不到达 Runner。

<a id="model-experience"></a>
## 模型体验

无，因为本路由不注册提示词段、工具或请求上下文；模型通过 Runner 上的 `dsh-tool-web` 抵达网页搜索，其提供方调用本路由。

#### KV Cache 影响

无：这里没有任何东西进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了本路由单独存在时的不完整之处。它们是当前包约束。

- **没有配额**——经随附 DeepSeek 提供方的一次搜索是公司 key 上的一次完整模型请求，这里没有任何东西针对成员的模型预算预留或结算它。在搜索用量接入配额 seam 之前，审计日志是唯一的账本。
- **单一组织资源**——决策按成员在一个 `web_search` 资源上做出；没有按提供方或按域名的授权。
- **没有自己的期限**——搜索提供方自身的超时约束该调用；更早放弃的 Runner 不会被告知等待。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随件。路由在调用之间不持有任何东西；请求不携带提供方、地址或凭据是一种缺失，其测试通过检查 Runner 实际发送的内容来断言。
