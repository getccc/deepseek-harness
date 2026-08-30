---
description: "管理控制台的浏览器 API：在 Control Plane 会话之上返回 JSON，问的是与表单提交同样的三个问题，留下的是同样的审计记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-admin-api

[English](README.md) | 中文

## 概述

`dsh-team-admin-api` 是管理控制台唯一对话的对象。它在 Control Plane 的浏览器会话之上返回 JSON，每一条路由在询问持有记录的那个服务之前，都会先问与表单提交同样的三个问题——有没有会话、这次请求是否来自本站、访问控制是否准许。控制台决定给成员看什么；它不决定成员可以做什么。

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

```yml
- name: '@deepseek-ai/dsh-team-admin-api'
  config:
    organizationId: 019400a1-0000-7000-8000-000000000000
    sessionMaxAgeSeconds: 43200
    secureCookie: true
    maxRequestBodyBytes: 16384
```

`organizationId` 没有默认值：一个猜测自己服务于哪个组织的 Control Plane 会拿错误的组织去认证成员，因此在部署提供它之前这一行加载失败。对于以明文 HTTP 提供服务的部署，`secureCookie` 必须为 false，因为浏览器会在这样的源上丢弃 `Secure` cookie，成员将永远无法保持登录。

读取用 `GET`，写入用 `POST`、`PATCH` 与 `DELETE`，都在 `/team/api` 之下。每一次写入都在 `x-dsh-csrf` 头里携带该会话的 CSRF 值，这个值由 `GET /team/api/session` 发放。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 一次写入需要三样都在

一个会话、一个指明本授权方的 `Origin`，以及由该会话派生的 CSRF 值。它们的失败方式不同：令牌检查拒绝一次伪造的请求，而源检查拒绝一个从未加载过本控制台的页面发来的请求。登录也是一次写入，因为否则另一个站点上的表单可以把成员登入该站点控制的账户。

### `permissions` 用来隐藏控件，它不执行任何强制

`GET /team/api/session` 回答该成员持有的 `resourceType|action` 对，好让控制台不必显示没人能用的按钮。随后每条路由仍会再问一次访问控制。一个显示了不该显示的控件的控制台，得到的依然是拒绝。

### 一次拒绝给的是一个词，不是一句话

`unauthenticated`、`forbidden`、`malformed`、`conflict`、`not-found`、`too-large`、`unavailable`。控制台在这个词上分支；`detail` 是给人读的，永远不是区分两种结果的唯一依据。登录失败对所有成因只有一个答复，因为究竟是“没有这个成员”“密码不对”还是“已锁定”，正是攻击者想要的。

### 传出去的比记录本身窄

一个账户的失败次数与锁定时限是认证提供者的事，不是管理员表格里的事。策略修订号是 `bigint`，以十进制字符串传输，因为 JSON 没有这种数。成员的角色被收窄到本组织的：没有任何东西阻止一次绑定指向另一个组织的角色，而本控制台指名的角色应当是它也能收回的。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 路由、三道证明、授权与审计记录 |
| [`src/http.ts`](src/http.ts) | 读取有界的 JSON 请求体并以 JSON 答复 |
| [`src/types.ts`](src/types.ts) | 控制台收到的内容，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`team-browser-session`](../team-browser-session/README.zh.md) —— 本 API 使用的 cookie、CSRF 派生与同源判定。
- [访问控制子系统](../../../docs/subsystems/access-control.zh.md) —— 一次授权可以指名的封闭权限目录。

<a id="model-experience"></a>
## 模型体验

无，因为本包服务的是管理员的浏览器，不注册任何提示词分区、工具或请求上下文。

#### KV 缓存影响

这里没有任何东西加入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是契约当前的约束，不是任务待办。

- **一个组织，写在配置里** —— 本 API 针对它被配置的那个组织做认证，没有任何东西解析某个请求属于哪个组织。
- **没有入职或密码路由** —— 管理员添加成员，而设置该成员的第一个密码仍需另一条路径。
- **只创建类型授权** —— 针对单个具名资源的授权在这里可读可撤销，但仍通过访问控制服务创建，直到控制台有一个不会把显示名与受治理资源 id 混淆的资源选择器。
- **整集合返回，无分页** —— 一次写入以它改动的那份列表作答，一次读取返回全部，这针对的是本版本服务的部署规模。
- **没有审计查询** —— `organization.audit.read` 在目录里，但还没有路由服务它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

拒绝的测试比成功的测试更重要：三道证明被逐一去掉，并检查存储没有发生任何改变。`readJson` 在请求体超限时停止读取而不是销毁套接字——销毁会把响应一并带走，控制台看到的将是断开的连接而不是那次拒绝。

</details>
