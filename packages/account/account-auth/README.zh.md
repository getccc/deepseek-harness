---
description: "认证接缝：把登录名与密钥变成一个账户，与密钥如何校验无关，供组合 Team Edition 的部署使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-account-auth

[English](README.md) | 中文

## 概述

`dsh-account-auth` 只问登录要回答的那一个问题：这个登录名与这个密钥，是否指向一个账户？它对密钥如何校验只字不提——今天是已存的密码哈希，日后可以是外部身份提供方——正因如此，替换那套方式永远不会触碰 [`dsh-account-store`](../account-store/README.zh.md) 所保存的账户、角色和设备。挂载本包以获得契约；再搭配一个提供方，例如 [`dsh-account-auth-password`](../account-auth-password/README.zh.md)——真正做校验的是它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
const outcome = await ctx.accountAuth.authenticate(orgId, loginName, secret)
if (outcome.ok) {
  // outcome.userId is the account; outcome.mustChangePassword says whether it
  // still owes its holder a secret of their own.
}
```

### 失败刻意不带原因

登录名不存在、密钥错误、账户被锁、账户被停用，全都返回 `{ ok: false }`。没有任何字段可供分支，因此调用方不会不小心构造出一个「哪些登录名存在」的探针。区分它们属于审计的关注点，而审计从存储读取，不从登录响应读取。

这也意味着上层界面不得把这一区分加回去：所有失败共用一条消息。

### 设置密钥

`setSecret` 存下提供方派生出的任何东西，并满足一个新签发账户欠其持有者的那件事。若密钥不符合部署的策略，它以 `WeakSecretError` 拒绝，其 `requirement` 指明所要求的内容，供表单展示。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 为什么计时是契约的一部分

`authenticate` 被规定为：无论登录名是否存在，都消耗相同的可观测时间。能测出这一差异的调用方，得到的正是那个无原因失败所隐瞒的东西，因此该性质属于接口本身，而不是某一个提供方的备注。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务、结果联合类型，以及 `WeakSecretError` |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件的注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`account-auth-password`](../account-auth-password/README.zh.md)——随附的提供方。
- [`account-store`](../account-store/README.zh.md)——身份与登录状态的所在。
- [账户子系统](../../../docs/subsystems/account.zh.md)——两个接缝合在一起看。

<a id="model-experience"></a>
## 模型体验

无，因为认证发生在服务端，不注册任何提示词分段、工具或请求上下文。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包既无请求前缀也无缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是当前契约的约束，不是待办清单。

- **只有账户级限流**——本接缝看到的是登录名与密钥，看不到来源地址或浏览器会话，因此它能锁定一个账户，却无法拖慢一个把尝试分散到许多账户上的攻击者。那属于 HTTP 入口，而它尚不存在。
- **没有 enrollment 流程**——`setSecret` 为一个已知账户更改密钥；签发一条短期链接让成员选定自己的第一个密钥，是另一个接缝。
- **不签发会话**——成功结果只指明一个账户，别无其他。调用方据此铸造什么，是调用方的事。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

结果联合类型是强制点，而非文档说明：不存在可供调用方泄漏的原因字段，因此即使界面写得粗心，防枚举性质依然成立。

</details>
