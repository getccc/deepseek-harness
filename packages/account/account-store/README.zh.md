---
description: "账户存储接缝：组织、成员账户与登录状态，置于一个后端中立的服务之后，供组合 Team Edition 的部署使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-account-store

[English](README.md) | 中文

## 概述

`dsh-account-store` 是 Team Edition 记录成员身份的地方：一个组织及其中的账户，每个账户有组织内唯一的登录名、一个状态，以及锁定策略读取的计数器。它只是一个仓储：记录发生了什么并报告冲突，不做任何决定。五次失败是否意味着锁定、编码后的密码哈希包含什么，都属于经由它读写的认证提供方。挂载它以获得词汇表与服务契约；请与 [`account-store-sqlite`](../account-store-sqlite/README.zh.md) 这样的后端搭配使用。

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

注入 `accountStore` 并调用它。每个方法都是返回 promise 的仓储操作，因此每种失败都是 rejection——没有任何方法会同步抛出。

```ts
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-account-store'

declare const ctx: Context

const org = await ctx.accountStore.createOrganization('Acme')
const user = await ctx.accountStore.createUser({
  orgId: org.id,
  loginName: 'alice',
  displayName: 'Alice',
})
```

`updateOrganization` 会改变组织自身的字段——名称，以及描述它的编号、负责人、电话与邮箱——但不会改变其稳定 id 或授权修订号。未给出的字段保持原样，置为 `null` 的字段会被清除。

### 新签发的账户还不能登录

`createUser` 只存储身份。账户不携带任何认证材料，且 `mustChangePassword` 为真。配置账户的调用方随后通过认证提供方写入秘密；`setPasswordHash` 会一并存下该秘密的编码形式并清除标志。

### 登录状态在此计数，在别处裁决

`recordFailedLogin` 返回连续失败次数，`lockUser` 会拒绝登录直到你传入的那个时刻。存储从不判断某个次数是否过高、锁多久；这套策略归认证提供方所有，它调用这些方法来记录自己的裁决。

浏览器会话也与账户记录存放在一起。`revokeBrowserSessions` 把移除一个账户的所有管理会话作为一次账户恢复操作；账户没有会话时结束操作也成功。

### 你可以据以行动的失败

`DuplicateLoginNameError` 指明冲突的登录名与组织。`UnknownAccountUserError` 和 `UnknownOrganizationError` 指明操作找不到的那条记录。后端抛出的其他任何错误都原样传递，因此调用方永远不会被告知错误的原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 为什么认证材料在这里是不透明的

存储保存编码后的哈希，但从不解析、比较或从中派生任何东西，并且通过两个窄接口暴露它，而不是把它放进账户记录里。这正是让存储与认证方式保持正交的原因：把密码登录换成外部身份提供方，改变的是挂载了哪个提供方，而不是已存储的账户、角色和设备。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务、它的失败类型，以及 `ctx.accountStore` 声明 |
| [`src/brand.ts`](src/brand.ts) | `OrgId` 与 `UserId`：品牌化类型及其品牌函数 |
| [`src/types.ts`](src/types.ts) | 实体形状，仅类型 |

### 不变量归属

本包声明一个抽象服务且不挂载任何东西，因此其伴随插件不安装任何检查。实现该服务的后端拥有其行数据必须满足的持久关系，并在这些关系所在之处强制它们。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`account-store-sqlite`](../account-store-sqlite/README.zh.md)——随附的后端。
- [账户包地图](../README.zh.md)——本能力族如何拆分。
- [能力接缝](../../../docs/capability-seams.zh.md)——本包遵循的 Definition / Provider / Consumer 拆分。

<a id="model-experience"></a>
## 模型体验

无，因为该存储属于服务端身份，任何提示词分段、工具或请求上下文都触及不到它。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包既无请求前缀也无缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是当前契约的约束，不是待办清单。

- **实际上每个存储只有一个组织**——该服务可以容纳多个，但尚无任何东西负责解析一个请求属于哪个组织，因此部署只使用一个。
- **不支持删除账户**——账户只能停用、不能移除，因为角色、设备和审计行都引用它。删除路径需要先定下这些引用如何处理。
- **没有任何东西清理过期会话** —— 会话行在不再被认可之后仍然留下，因此保留期处理需要它自己的设计，而不是在读取时来一句 `DELETE`。
- **登录名精确比较**——仅大小写或 Unicode 规范化不同的两个名字属于不同账户。希望它们相等的部署必须在调用前自行规范化。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

方法保持同步的函数体并返回 `Promise.reject`，而不是写成 `async`，因为仓库的 lint 拒绝没有 `await` 的 `async` 函数。真正重要的是契约：调用方的 `.catch` 必须能看到每一种失败，因此任何方法都不得同步抛出。

</details>

**运行时不变量：**不发布伴随文件：本包只声明抽象服务及其词汇，不挂载任何东西；实现该服务的 provider 拥有其行必须满足的持久关系并自行检查。
