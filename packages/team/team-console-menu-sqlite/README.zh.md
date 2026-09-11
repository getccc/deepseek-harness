---
description: "SQLite 版控制台菜单：一个数据库文件，保存组织的管理导航以及它初始使用的随附菜单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-console-menu-sqlite

[English](README.md) | 中文

## 概述

`dsh-team-console-menu-sqlite` 使用 Node 内置驱动，把 [`dsh-team-console-menu`](../team-console-menu/README.zh.md) 定义的导航存进一个 SQLite 数据库文件——无需外部数据库进程，也没有任何东西要安装。在 Control Plane 组合中挂载它、给它一个路径，管理控制台的树就会跨重启保留下来，包括每一次重命名、重排与隐藏。

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

一行配置就是全部设置：

```yaml
- id: team-console-menu
  name: '@deepseek-ai/dsh-team-console-menu-sqlite'
  config:
    path: /var/lib/dsh-team/menus.db
```

`path` 接受 `:memory:` 以使用进程内数据库，测试用的就是它。文件与它的 Schema 在首次打开时创建。播种是管理 API 发起的另一次调用，因为这个 Store 并不知道 Control Plane 服务于哪个组织。

### 它保证什么

每一次写入都是单条语句，因此每一次本身就是原子的；这里没有任何操作跨越两张表。`listMenus` 会把每条菜单紧接着它自己的子树返回，同级按 `sortOrder` 再按插入顺序排列，因此管理员看到的树不会在两次读取之间乱序。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### Schema 归属

数据库带有一个 application id 和单调递增的 `SCHEMA_VERSION`。打开时会拒绝其他应用打过标记的文件，也会拒绝更新构建写出的文件——降级无法知道它从未见过的列意味着什么，因此它选择停止，而不是向下迁移。

### 不变量存在于 Schema 中

`(org_id, seed_key)` 上的唯一索引正是每次启动重新播种也安全的原因：随附菜单的第二次插入会冲突，而不是把树复制一遍。从 `parent_id` 指回本表的外键则让子项无法指向一条已经消失的菜单。两者都声明给了 SQLite，这也是本包的不变量伴生插件什么都不安装的原因。

组织只以 id 命名，而不做关联：账户存放在账户存储自己的数据库里，而一条菜单比它所命名的组织活得更久，恰恰是这个文件无法约束的关系。

### 重命名会丢弃随附的 copy key

`updateMenu` 只要写入名称就会清空 `label_key`，其他任何编辑都不动它。正是这一点让已翻译的随附菜单保持翻译，直到管理员给它自己的措辞。

### 源码导览

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | Store 实现及其插件配置 |
| [`src/schema.ts`](src/schema.ts) | DDL、行结构，以及版本与 application id 的强制检查 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`team-console-menu`](../team-console-menu/README.zh.md)：本包所实现的契约。
- [`team-admin-api`](../team-admin-api/README.zh.md)：经由它读写的路由。
- [`team-control-plane/`](../../bundle/team-control-plane/README.zh.md)：本包被组合进去的服务端 Profile。

<a id="model-experience"></a>
## Model Experience

无：该后端存储的是管理员的导航，没有任何 Prompt Section、工具或 Request Context 会触及它。

#### KV Cache 影响

这里没有任何内容进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

以下是该后端当前的约束，不是任务清单。

- **一次一个进程**：SQLite 在一个文件内串行化写者，因此该后端适合部署所面向的单个 Control Plane 实例。不支持两个实例同时对一个文件运行；那是客户端/服务端数据库该做的事。
- **只有增量 Schema 变更能自行完成**：每条语句都是 `CREATE ... IF NOT EXISTS`，因此旧文件会获得新构建增加的内容，并被打上新版本标记。修改或删除既有列的变更目前没有路径，必须自带一条。
- **被删除的随附菜单会回来**：播种以随附 key 匹配，因此产品随附的菜单会在下次启动时以随附设置回来。想让移除持久生效，应当停用或隐藏它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`node:sqlite` 无需任何依赖，而且同一组合中的账户存储、访问控制与审计已经在用它，因此本包没有给仓库引入任何驱动。这个 Store 刻意对"存在哪个组织"不持立场：播种把组织作为参数传入，而这个参数来自唯一在配置中命名了它的那个插件。

</details>

**运行时不变量：**不发布伴随文件：该后端必须保持的持久关系（组织内每个随附条目一行、子项指向存在的条目）以唯一索引和外键声明给 SQLite，数据库会拒绝违规写入。
