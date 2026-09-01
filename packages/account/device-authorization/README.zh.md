---
description: "设备授权 Service Definition：配对码绑定、PKCE 与设备签名兑换，以及带重放检测的 Refresh Token Family。"
kind: "package-reference"
---

# @deepseek-ai/dsh-device-authorization

[English](README.md) | 中文

## 概述

`dsh-device-authorization` 把成员的浏览器会话变成一台电脑上的长期凭据，且仅限那一台。绑定分别证明三件事——有成员批准了它、他们批准的是*这一台*电脑、这台电脑握有他们比对过的那把钥匙——三者缺一即拒绝。本包拥有该流程的词汇表，以及两侧必须以相同方式导出的那些值：PKCE Challenge、供人比对的公钥摘要、设备所签的字节，以及密钥的存储哈希。请与 [`device-authorization-sqlite`](../device-authorization-sqlite/README.zh.md) 这样的后端搭配使用。

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
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import { redeemSigningInput } from '@deepseek-ai/dsh-device-authorization'

declare const ctx: Context
declare const orgId: OrgId
declare const userId: UserId
declare const publicKey: string
declare const pkceChallenge: string
declare const sign: (input: string) => string

// On the Runner, before anyone has approved anything.
const started = await ctx.deviceAuthorization.start({
  publicKey, platform: 'darwin', runnerVersion: '2.4.1',
  pkceChallenge, callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
})

// On the Control Plane, after the member compared started.pairingCode.
const issued = await ctx.deviceAuthorization.confirm(started.transactionId, {
  orgId, userId, authenticationId: 'session:browser-session',
})

// Back on the Runner, proving it holds the key behind the digest.
const signature = sign(redeemSigningInput(started.transactionId, issued.code))
```

`start` 刻意不携带账户：在成员从一个已认证会话确认之前，Transaction 不属于任何人，因此打开一个 Transaction 的未认证调用方，只能学到它自己已经提供的东西。

`revokeUserDevices(orgId, userId)` 在一个提供方事务中撤销关联到该账户的所有凭据族。设备清单行仍可供管理员查看，但它们的刷新 token 与访问 token 此后都无法通过验证。密码替换使用这项账户级操作；撤销一台设备仍是范围更窄的成员支持操作。

### 导出共享值

Runner 与 Control Plane 在运行时从不共享代码，因此两侧都导入 [`crypto.ts`](src/crypto.ts) 来得到任一侧需要导出的每一个值：`pkceChallenge`、`digestPublicKey`、`redeemSigningInput`、`refreshSigningInput` 和 `hashSecret`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 为什么被签字节同时指名 Transaction 和 Code

`redeemSigningInput(transactionId, code)` 把一份签名绑定到一次兑换，因此从另一次截获的签名毫无用处。Code 本身不在被签串里——里面只有它的哈希——否则一份泄露的签名会顺带携带造出它的那个 Code。

### 为什么配对码不含元音

不含元音的码拼不出让眼睛自动补全而不是逐字阅读的单词，去掉 `0`、`O`、`1`、`I`、`L` 则移除了在浏览器随手挑的字体里长得像的那几对。这个码不需要独自抵抗猜测：确认本身已经要求一个已认证的 Control Plane 会话。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务、它的拒绝，以及 `ctx.deviceAuthorization` |
| [`src/crypto.ts`](src/crypto.ts) | 流程两侧必须以相同方式导出的每一个值 |
| [`src/vocabulary.ts`](src/vocabulary.ts) | 平台与拒绝原因词表 |
| [`src/brand.ts`](src/brand.ts) | 设备、Transaction 与 Family 身份 |
| [`src/types.ts`](src/types.ts) | 请求、响应与实体结构，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`device-authorization-sqlite`](../device-authorization-sqlite/README.zh.md) —— 随产品提供的后端。
- [设备授权子系统](../../../docs/subsystems/device-authorization.zh.md) —— 完整的流程及其拒绝。
- [`account-store`](../account-store/README.zh.md) —— 一次确认所指名的组织与账户。

<a id="model-experience"></a>
## 模型体验

无，因为设备绑定只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **Access Token 不携带授权** —— 它指名一个组织、一个账户、一台设备。角色与授权按请求读取，因此 Token 不能被当作一项能力。
- **只支持 Ed25519** —— 流程指名一种签名算法，而不是协商一种，因为两侧一起发布，而可协商的算法是一个当前并无第二选项的攻击面。
- **这里的任何东西都不保护 Runner 自己的进程** —— 与 Runner 共享同一 Cordis 进程的插件可以读到设备密钥。短有效期与撤销缩小窗口，但不隔离它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

重放检测刻意连同正当持有者一起惩罚：一个被重放的 Refresh Token 意味着要么 Token 泄露了，要么 Runner 弄丢了它的记录，而这次交换中的任何东西都无法区分两者。把它软化成"忽略这次重放"，会让一个被窃 Token 在整个 Family 的生命周期内一直可用。

</details>
