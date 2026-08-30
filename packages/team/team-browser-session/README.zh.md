---
description: "Control Plane 的浏览器会话：cookie 里的不透明令牌、存储中它的哈希、由它派生的 CSRF 值，以及“这次写入来自本站”的判定。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-browser-session

[English](README.md) | 中文

## 概述

`dsh-team-browser-session` 持有每一个面向成员的 Control Plane 界面都必须取得一致的四件事：会话 cookie 叫什么、它的令牌如何哈希进账户存储、那个令牌派生出什么 CSRF 值，以及一次写入何时可以被当作来自本站。它们放在一个包里，是因为回答这些问题的界面不止一个——浏览器 API 与设备确认页——而一条会话规则的两份副本，就是两次对“谁已登录”产生分歧的机会。

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
import {
  csrfMatches, csrfToken, currentSession, newSessionToken, sameOrigin, writeSessionCookie,
} from '@deepseek-ai/dsh-team-browser-session'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AccountStore } from '@deepseek-ai/dsh-account-store'

declare const store: AccountStore
declare const req: IncomingMessage
declare const res: ServerResponse

const signed = await currentSession(store, req)
if (signed !== undefined && sameOrigin(req) && csrfMatches(signed.token, 'the value the client echoed')) {
  // The three proofs a write needs, in the order they cost.
}

writeSessionCookie(res, newSessionToken(), 43_200, true)
```

`currentSession` 在每个请求上都通过存储解析，因此被停用成员的会话会立刻失效，而不是等到某个签名值恰好过期。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### cookie 里不带任何关于成员的信息

cookie 携带随机字节，存储持有它们的 SHA-256。被窃取的 cookie 读不出内容，而结束一次会话是一次存储写入，不是一次等待过期。

### CSRF 值是派生的，不是存储的

`csrfToken` 是会话令牌的函数，因此没有第二条记录需要与第一条保持同步。它与 cookie 不是同一个值，因此仅仅携带 cookie 不足以提交一次写入。`csrfMatches` 按常量时间比较。

### 会话 cookie 是 Lax，不是 Strict

成员是从自己 Runner 提供的配对页点链接抵达设备确认页的，那是一次跨站顶层导航。Strict 会在那里扣下会话，页面便会毫无理由地要求他们重新登录。

### 不透明的 Origin 需要 Fetch Metadata

`sameOrigin` 拿 `Origin` 与请求自身指明的授权方比对，因此部署不必把自己的地址配置两遍。发送 `Origin: null` 的上下文只有在浏览器控制的 `Sec-Fetch-Site` 独立地说 `same-origin` 时才被接受；网页内容设置不了那个头。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | cookie、令牌、CSRF 派生与同源判定 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`team-admin-api`](../team-admin-api/README.zh.md) —— 用这些函数做认证的浏览器 API。
- [`team-shell`](../team-shell/README.zh.md) —— 共享同一会话的设备确认页。

<a id="model-experience"></a>
## 模型体验

无，因为本包决定的是浏览器认证，不注册任何提示词分区、工具或请求上下文。

#### KV 缓存影响

这里没有任何东西加入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是契约当前的约束，不是任务待办。

- **一个浏览器一个会话，且不与设备绑定** —— 会话是 cookie 里的持有者令牌，没有任何东西把它系到取得它的那台电脑上，而那正是独立的设备授权凭据为 Runner 所做的事。
- **没有闲置超时** —— cookie 的 `Max-Age` 就是整个生命周期，会话不会因为不活动而缩短。
- **成员看不到自己的会话清单** —— 存储一次解析一个会话；要列出一个账户持有的会话以便成员结束其中之一，需要本包没有的查询。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`sameOrigin` 对 `Origin: null` 做了正反两面的测试，因为这条规则的价值完全在于它拒绝了什么：没有同源 Fetch Metadata 的不透明上下文必须失败，否则那个头什么也没换来。

</details>
