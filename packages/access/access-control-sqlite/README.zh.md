---
description: "SQLite 后端的访问控制：角色、授权、受治理资源，以及其上的默认拒绝求值，供组合 Team Edition Control Plane 的部署使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-access-control-sqlite

[English](README.md) | 中文

## 概述

`dsh-access-control-sqlite` 在一个 SQLite 数据库之上实现 [`dsh-access-control`](../access-control/README.zh.md)，使用 Node 内置驱动——不需要外部数据库进程，也没有任何东西要安装。它保存角色、用户组、受治理资源以及两种授权形态，并用一条覆盖主体全部角色的查询来回答 `authorize`。不变量由数据库声明，而不是靠服务自觉：授权表带有指向已播种权限目录的外键，因此即使某个调用方直达数据库，指名本构建未治理组合的授权也存不进去。

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

```yaml
- id: access-control
  name: '@deepseek-ai/dsh-access-control-sqlite'
  config:
    path: /var/lib/dsh-team/access.db
```

`path` 接受 `:memory:` 表示进程内数据库，测试用的就是它。它需要 `accountStore` 一同挂载，因为组织的策略修订号随组织存放。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 求值是一条查询

`authorize` 按请求所指名的身份读取资源、拒绝被停用的资源、汇集主体的角色——直接的与经组派生的并成一个集合——然后在一条语句里同时匹配类型授权与资源授权。一个决定会返回准入它的每一条授权，这正是让一次拒绝或准许无需二次查询即可解释的原因。

### 不变量存在于 schema 之中

权限目录在打开时被播种进一张表，两张授权表都带有指向它的外键。播种只做插入：本构建不再治理的组合会留在表中，使既有授权保住外键，而服务自身的检查——它读的是代码目录而非这张表——阻止它被再次授予。删除行只会弄坏已存的授权，而不是让它退役。

资源上 `(org_id, type, external_ref)` 唯一，两张授权表上 `(角色, 目标, 动作)` 唯一，因此同一组合授予两次得到的是一条授权，而不是会被一个决定同时点名的两行。

### 策略修订号不在本地

它随组织存放在账户存储中，因此一个计数器服务于所有缓存。此处每一次可能改变结果的变更都会递增它——包括治理一个资源，因为某个角色已持有的类型授权现在多覆盖了一样东西。创建用户组不绑定任何角色，因此不会递增。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方、求值，以及递增修订号的那些变更 |
| [`src/schema.ts`](src/schema.ts) | DDL、行形状、目录播种，以及版本强制 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件的注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`access-control`](../access-control/README.zh.md)——本包实现的契约。
- [访问控制子系统](../../../docs/subsystems/access-control.zh.md)——完整的求值规则。
- [`account-store-sqlite`](../../account/account-store-sqlite/README.zh.md)——保存身份的姊妹后端。

<a id="model-experience"></a>
## 模型体验

无，因为授权存储位于服务端，不注册任何提示词分段、工具或请求上下文。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包既无请求前缀也无缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是本后端当前的约束，不是待办清单。

- **同一时刻只服务一个进程**——SQLite 在文件内对写者串行化，与部署所面向的单 Control Plane 实例相符。两个实例对着同一文件，正是客户端/服务器数据库的用武之地。
- **尚无迁移路径**——`SCHEMA_VERSION` 为 1，打开时会拒绝更新的文件，但没有任何东西会升级更旧的文件。第一次 schema 变更必须补上它。
- **没有决定缓存**——每次 `authorize` 都读数据库。策略修订号的存在正是为了让调用方能安全地缓存；本后端不代它缓存。
- **角色不会被删除**——没有任何东西移除角色，因为授权与绑定都引用它。删除路径需要先定下这些引用如何处理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`node:sqlite` 无需依赖，且已经是 session persistence、session query、storage 和账户存储的后端。面向多实例部署的 PostgreSQL 后端，是同一个 Service Definition 之后的第二个 provider，而不是对此处的改动。

</details>
