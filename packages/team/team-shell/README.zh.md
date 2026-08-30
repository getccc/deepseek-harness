---
description: "Control Plane 的登录、设备确认，以及受 RBAC 保护的组织、用户、角色、设备与模型管理控制台。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-shell

[English](README.md) | 中文

## 概述

`dsh-team-shell` 提供成员与管理员在 Control Plane 上使用的页面：登录、电脑确认，以及用于组织、用户、角色与授权、设备和公司模型的统一响应式管理控制台。每一次写入都被授权两次——会话说明是谁在问，访问控制说明他们是否可以——而每一次管理行为都留下一条指名执行者的审计记录。页面由服务端渲染，不含脚本或外部资产，因此其安全性不依赖客户端代码。

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
  '@deepseek-ai/dsh-team-shell':
    organizationId: 019400a1-0000-7000-8000-000000000000
    sessionMaxAgeSeconds: 43200
    secureCookie: true
```

`organizationId` 是必填的。第一版是单组织的，把它写明能让这一点成为一项被陈述的事实，而不是 shell 从存储里恰好有什么推断出来的东西。

对于以纯 HTTP 提供服务的部署，`secureCookie` 必须为 false，因为浏览器会在这样的源上丢弃 `Secure` Cookie，成员将永远无法保持登录。

shell 会分别为组织、成员、角色、设备和模型目录管理注册一项受治理的管理资源。部署通过给角色授予相应的读取与管理权限，并把该角色绑定到账户来引导首位管理员。此后，控制台可以重命名已配置的组织、创建和停用用户、绑定角色、从封闭权限目录组合类型授权、撤销任何可见授权、撤销设备，以及注册或停用公司模型。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 一次写入需要三样齐全

一个会话、同源浏览器元数据，以及一个由会话导出的 CSRF Token。通常由指名本 authority 的 `Origin` 提供证明；发送 `Origin: null` 的不透明浏览器上下文还必须发送 `Sec-Fetch-Site: same-origin`。该 Token 是导出的而不是存储的，因此没有第二份记录需要保持同步；它又是一个不同于 Cookie 的值，因此单是携带 Cookie 并不足以提交一个表单。

### 会话 Cookie 是 Lax，不是 Strict

成员是顺着自己 Runner 所服务的配对页上的链接到达确认页的，那是一次跨站顶层导航。`Strict` 会在那里扣下会话，并毫无理由地要求他们重新登录。

### 登录对任何人都会成功；做事不会

认证回答"是谁"，此后每一个页面和每一次操作都会询问访问控制"是否可以"。一个没有任何授权的成员登录之后依然什么也做不了——包括读取成员列表。

### 一次失败的登录不记录任何账户

究竟是"查无此人"、"密码错误"还是"已锁定"，恰恰是攻击者想要的信息，因此页面对三者回答同一条消息，审计记录也不指名任何账户。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 路由、每次写入都要通过的三道检查，以及审计记录 |
| [`src/session.ts`](src/session.ts) | 会话 Token、CSRF 导出，以及同源判定 |
| [`src/pages.ts`](src/pages.ts) | 全部页面，服务端渲染且不含脚本 |
| [`src/paths.ts`](src/paths.ts) | shell 所提供的地址 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [团队 Handoff 子系统](../../../docs/subsystems/team-handoff.zh.md)——这些页面所完成的流程的两半。
- [`access-control`](../../access/access-control/README.zh.md)——每一次管理操作在动手前所询问的对象。
- [`audit`](../../access/audit/README.zh.md)——每一次管理行为被记录的地方。

<a id="model-experience"></a>
## 模型体验

无，因为这些是 Control Plane 页面，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **单一组织，写在配置里** —— shell 对它被配置的那个组织进行认证，没有任何东西负责解析一个请求属于哪个组织。
- **没有 Enrollment Link** —— 管理员添加一个成员，而设置该成员的首个密码仍然需要另一条路径。
- **只能创建类型授权** —— 角色页会显示并能撤销两种授权，但只能创建类型授权；为单个具名资源添加授权仍需使用访问控制服务。
- **没有分页** —— 很长的用户、角色、设备和模型列表会被整体渲染，目标是小型单实例部署。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

一个不携带拒绝词的失败回答 500 并记录 `outcome: 'error'`，而不是 400。把存储故障报告成"这个站点不认识的请求"既是假话也无济于事，而且审计记录会说成员被拒绝了，而他们并没有。

</details>
