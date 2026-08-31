---
description: "管理控制台的浏览器 API：在 Control Plane 会话之上返回 JSON，问的是与表单提交同样的三个问题，留下的是同样的审计记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-admin-api

[English](README.md) | 中文

## 概述

`dsh-team-admin-api` 是管理控制台唯一对话的对象。只有当账户还持有 `organization.admin.access` 时，密码认证才会创建浏览器 Session。随后每条路由都会在询问持有记录的服务前，重新检查控制台入口权限、请求 Session 与 Origin，以及具体动作授权。控制台决定给管理员看什么；它不决定管理员可以做什么。

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

| 集合 | 读取需要 | 修改需要 |
|---|---|---|
| `/organization`、`/overview` | `organization.read` | `organization.settings.manage` |
| `/members` | `member.read` | `member.create`、`member.update`、`member.password.reset`、`member.delete`、`member.disable`、`member.enable`、`member.role.bind` |
| `/departments` | `department.read` | `department.manage` |
| `/roles`、`/grants` | `role.read` | `role.create`、`role.update`、`role.delete`、`role.grant.manage` |
| `/menus` | 一个会话，不需要授权 | `menu.manage` |
| `/devices` | `device.inventory.read` | `device.revoke` |
| `/models` | `model.catalog.read` | `model.catalog.manage` |

导航是这张表里的例外。没有它控制台就画不出自己，它只命名本构建随附的内容，而它通向的每个页面都会再次询问访问控制，因此读取它只需要一个会话，别无其他——这与 `/permissions` 遵循的规则相同。

`POST /roles/:id/menus` 接收角色应当可达的导航菜单，并让它的类型授权与之一致：加上每条被选中菜单所声明的权限，撤销未被选中菜单的权限，并且不动任何没有菜单声明过的配对。菜单权限是授权之上的一个视图，不是第二套鉴权系统。`POST /roles/:id/permissions` 在目录本身之上做同一件事，让角色的类型授权恰好等于传入的那些配对；针对单个具名资源的授权不在这两个列表之内，会被原样保留。

`POST /roles/:id/models` 是针对具体资源的例外。它把目录模型 id 解析为受治理资源 id，替换该角色精确的 `model.discover` 与 `model.invoke` 授权，并清除 `coversCatalog`。Runner 使用当前设备访问 token 向模型网关请求发现，因此只会显示这些精确授权允许的活跃模型。

`POST /members` 要求在创建账户的同一次写入中提供成员初始密码。`PATCH /members/:id/password` 替换密码，撤销该账户拥有的每个浏览器会话与设备凭据族，并在管理员重置自己密码时让本次请求的管理 cookie 过期。

被标记为 `coversCatalog` 的角色持有本构建治理的每一项权限，并在 Control Plane 启动时被补齐到目录——正是这一点让管理员的角色在某次构建新增权限时不会落后。这个标记属于授权管理：只要请求携带该字段，`PATCH /roles/:id` 就会在 `role.update` 之外额外要求 `role.grant.manage`。

首位管理员必须在控制台之外获得 `organization.admin.access` 以及其所需动作权限。普通成员账户改由面向 Runner 的端点认证，不会获得管理 Session。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 一次写入需要三样都在

一个会话、一个指明本授权方的 `Origin`，以及由该会话派生的 CSRF 值。它们的失败方式不同：令牌检查拒绝一次伪造的请求，而源检查拒绝一个从未加载过本控制台的页面发来的请求。登录也是一次写入，因为否则另一个站点上的表单可以把成员登入该站点控制的账户。

### `permissions` 用来隐藏控件，它不执行任何强制

`GET /team/api/session` 回答该成员持有的 `resourceType|action` 对，好让控制台不必显示没人能用的按钮。随后每条路由仍会再问一次访问控制。一个显示了不该显示的控件的控制台，得到的依然是拒绝。

### 一次拒绝给的是一个词，不是一句话

`unauthenticated`、`forbidden`、`malformed`、`conflict`、`not-found`、`too-large`、`unavailable`。控制台在这个词上分支；`detail` 是给人读的，永远不是区分两种结果的唯一依据。登录失败对所有成因只有一个答复，因为究竟是“没有这个成员”“密码不对”还是“已锁定”，正是攻击者想要的。

### 公司是组织树里的一行

`PATCH /organization` 接受与部门相同的那组描述字段——名称、编号、负责人、联系电话与邮箱——因为控制台把组织画成那棵树的根行，并就地编辑它。名称必填；其余字段传空即为清除。组织不接受的是上级、类别与排序：它就是根、就是公司，而且只有一个。

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
- **整集合返回，无分页** —— 一次写入以它改动的那份列表作答，一次读取返回全部，这针对的是本版本服务的部署规模。
- **没有审计查询** —— `organization.audit.read` 在目录里，但还没有路由服务它。
- **删除账户不等于删除它的历史** —— 账户本身、它的角色绑定、它的会话，以及它绑定过的电脑的凭据都会被移除；它留下的审计行保留，而它曾领导的组织或部门会失去负责人。
- **没有任何东西在清点剩余的管理员** —— 该 API 只拒绝发起请求的那个账户，因此一个组织仍然可能被删到没有管理员。
- **上级只在创建时选定** —— 部门与导航菜单都不能被移动到另一个上级之下；两者都在它们该在的位置被创建。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

拒绝的测试比成功的测试更重要：三道证明被逐一去掉，并检查存储没有发生任何改变。`readJson` 在请求体超限时停止读取而不是销毁套接字——销毁会把响应一并带走，控制台看到的将是断开的连接而不是那次拒绝。

</details>
