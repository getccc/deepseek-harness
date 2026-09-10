---
description: "控制台菜单 Service Definition：管理控制台的导航树、每条菜单所声明的权限，以及组织初始使用的随附目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-console-menu

[English](README.md) | 中文

## 概述

`dsh-team-console-menu` 把管理控制台的导航变成组织自己的数据，而不是浏览器应用内的一份列表。一个条目说明它叫什么、去往哪里、由哪个页面组件渲染，以及它需要访问控制目录中的哪个权限。最后这个字段正是角色菜单访问权的组成来源：给角色一个页面就是授予该页面声明的权限，管理员编写的导航永远不可能命名这个构建不治理的权威。本包拥有词汇表与本构建随附的树；请与 [`team-console-menu-sqlite`](../team-console-menu-sqlite/README.zh.md) 这样的后端搭配使用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

使用方声明 `inject = ['consoleMenu']`，随后读写这棵树：

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import '@deepseek-ai/dsh-team-console-menu'

declare const ctx: Context
declare const orgId: OrgId

const entries = await ctx.consoleMenu.listMenus(orgId)
const first = entries[0]
if (first !== undefined) await ctx.consoleMenu.updateMenu(first.id, { visible: false })
```

Control Plane 在启动时调用一次 `seedShipped(orgId)`。该调用幂等，且从不覆盖：部署改过名、隐藏过或重排过的菜单会保留这些修改，被删除的那条则会在下次启动时以随附设置回来。

### 一条菜单是什么

| 类型 | 含义 |
|---|---|
| `catalog` | 只用于分组，自身没有可去之处 |
| `menu` | 一个页面：它有地址，并指明渲染它的组件 |
| `action` | 两者都不是——它的存在是为了让页面内的一个控件能够指明自己需要的权限 |

`status` 与 `visible` 是两回事：停用的菜单不再服务，而隐藏的菜单只是不画在侧边栏里。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 导航不做任何决定

这棵树说明了什么值得提供，它并不是执行者：控制台发出的每一次请求都会由管理 API 再次鉴权，因此一条对一无所有的人可见的菜单只是导航配置的失误，而不是一条入口。

### 菜单声明的权限不是自由文本

`isMenuPermission` 会把 `resourceType|action` 这一对与 [`dsh-access-control`](../../access/access-control/README.zh.md) 的代码目录比对，后端会拒绝命名其他内容的菜单。管理员组合导航，但不能凭空发明权限字符串——这与授权一直遵循的规则相同。

### 随附菜单带着控制台自己的措辞

控制台以不止一种语言渲染，因此产品随附的菜单携带一个 `labelKey`，由控制台通过词典翻译。重命名会丢弃这个键：措辞从此归组织所有，而那不是本构建该去翻译的内容。

### 源码导览

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | Service Definition、它的失败类型与权限校验 |
| [`src/types.ts`](src/types.ts) | 记录、创建与更新输入，以及随附菜单的字段 |
| [`src/catalog.ts`](src/catalog.ts) | 本构建随附的导航 |
| [`src/brand.ts`](src/brand.ts) | 带 brand 的菜单标识 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`team-console-menu-sqlite`](../team-console-menu-sqlite/README.zh.md)：存储它的后端。
- [`team-admin-api`](../team-admin-api/README.zh.md)：读写这棵树、并把菜单权限转换为授权的路由。
- [`access-control`](../../access/access-control/README.zh.md)：一条菜单可以命名的权限目录。

<a id="model-experience"></a>
## Model Experience

无：本包声明的是管理员的导航，没有任何 Prompt Section、工具或 Request Context 会触及它。

#### KV Cache 影响

这里没有任何内容进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

以下是本 Seam 当前的约束，不是任务清单。

- **上级只在创建时选定**：`UpdateConsoleMenu` 无法把一条菜单移到另一个上级之下。移动子树与编辑菜单是两种不同的操作，而排列这棵树的遍历依赖于上级永不改变这一点。
- **组件清单归浏览器应用所有**：菜单可以命名任意 `componentPath`，只有控制台知道本构建随附了哪些组件。命名了别的内容，就是通向一个并不存在的页面，控制台会在页面本应出现的位置说明这一点。
- **实际上一次服务一个组织**：这些记录以组织为范围，但随附树由知道部署服务于哪个组织的那一方来播种，而今天那就是单组织的管理 API。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

给控制台增加一个页面意味着在这里增加它——一条带 key、copy key、路由、组件路径与权限的随附菜单——并把该组件加入浏览器应用自己的注册表。key 是重新播种时的匹配依据，因此绝不能被另一个页面复用。

</details>

**运行时不变量：**不发布伴随文件：本包只声明抽象服务、随附目录和一次对权限目录的纯检查；组织存储的树与本构建随附条目的对应关系，属于播种它的 provider 及其测试。
