---
description: "访问控制接缝与其代码播种的权限目录：在角色、授权和受治理资源之上的默认拒绝授权。"
kind: "package-reference"
---

# @deepseek-ai/dsh-access-control

[English](README.md) | 中文

## 概述

`dsh-access-control` 是每一个公司资源入口和每一次管理操作都要问的那一个问题：这个主体可以对这个资源执行这个动作吗？它所规定的求值刻意做得很小——默认拒绝、角色的授权准入、多个角色取并集、被停用的资源一律拒绝——没有显式 Deny、没有角色继承、没有表达式语言，因此一个决定可以通过点名产生它的那些授权来解释。本包还拥有权限目录，由代码播种且封闭：管理员用已注册的 `(resourceType, action)` 组合拼装角色，无法凭空造出权限字符串。请搭配一个后端使用，例如 [`access-control-sqlite`](../access-control-sqlite/README.zh.md)。

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
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import '@deepseek-ai/dsh-access-control'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId

const decision = await ctx.accessControl.authorize({
  orgId, principalId, action: 'model.invoke', resourceType: 'model', resourceId: 'deepseek-v4',
})
if (decision.allowed) {
  // decision.matchedGrantIds names what admitted it; decision.policyRevision is
  // the revision it was computed against.
}
```

主体永远来自已认证的 token。调用方绝不传入角色、授权或 scope：那些都在这里读取，因此请求体携带的任何东西都无法扩大它被允许做的事。

### 授权

**类型授权**让一个角色对某类型下每一个启用的资源执行某个动作，包括在该授权写下之后才受治理的资源。**资源授权**只指名一个资源。除非目录治理该组合，两者都会被拒绝。

`listRoleGrants` 返回两种授权以及管理界面所需的目标身份；它不做授权决定，也不暗示读取者可以编辑这些授权。

`deleteResource` 停止治理一个资源，并把所有指名它的授权一并带走。资源 id 从不复用，因此以同一外部 Ref 再次注册的资源会拿到新的 id 并从零授权开始；可逆的那个动作是 `setResourceEnabled`。

### 读懂一次拒绝

`no-grant` 同时覆盖「没有授权准入」与「没有这个资源」，因此一次拒绝永远不会向一个在其上一无所有的主体确认该资源存在。`default-deny` 表示主体根本不持有任何角色。`resource-disabled` 是刻意的例外，它确实确认了存在性：它回答的是一个**确实**持有授权的主体，而告诉他资源已被关闭，正是有用消息与困惑消息之间的差别。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 为什么目录是封闭的

权限是代码中的值，不是数据库接受的字符串。不在 [`PERMISSION_CATALOG`](src/permissions.ts) 中的组合不是权限，因此拼写错误会在写入授权处失败，而不是在请求到来时悄悄准入或拒绝。动作名是完全限定的，且不必逐字重复其资源类型：类型是授权匹配的依据，动作是审计行里给人读的内容。

### 为什么没有显式 Deny

在只有 allow 的授权模型下，一个决定就是主体各角色所携带内容的并集，解释它等于列出那些授权。加入 deny 会让顺序与优先级成为答案的一部分，「这为什么被拒了？」就需要重放策略引擎，而不是给出一份清单。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 抽象服务、它的失败类型，以及 `ctx.accessControl` |
| [`src/permissions.ts`](src/permissions.ts) | 封闭的权限目录及其成员判定 |
| [`src/brand.ts`](src/brand.ts) | 角色、用户组、资源与授权的身份 |
| [`src/types.ts`](src/types.ts) | 实体、请求与决定的形状，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件的注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`access-control-sqlite`](../access-control-sqlite/README.zh.md)——随附的后端。
- [访问控制子系统](../../../docs/subsystems/access-control.zh.md)——完整的求值规则。
- [`account-store`](../../account/account-store/README.zh.md)——被授权的身份，以及被递增的策略修订号。

<a id="model-experience"></a>
## 模型体验

无，因为授权发生在服务端，不注册任何提示词分段、工具或请求上下文。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包既无请求前缀也无缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是当前契约的约束，不是待办清单。

- **没有显式 Deny，也没有角色继承**——两者都是刻意的，且都会改变一个决定的含义。要加入任何一个，都需要它自己的设计，而不是一个字段。
- **每个请求一个组织，由调用方解析**——`authorize` 接受 `orgId`；这里没有任何东西决定一个请求属于哪个组织。
- **配额是另一个问题**——本包回答的是主体是否可以使用某个资源，绝不回答是否还有额度。把两者合并会让一次拒绝变得含混。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

准许结果上的 `scopes` 只携带请求所指名的那个资源。组装多 scope 断言是网关对自己那份已授权清单的循环；在此处加一个批量查询，会诱使调用方授权一次、行动多次。

</details>
