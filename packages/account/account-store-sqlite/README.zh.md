---
description: "SQLite 后端的账户存储：一个数据库文件保存一个组织及其成员账户，供组合 Team Edition Control Plane 的部署使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-account-store-sqlite

[English](README.md) | 中文

## 概述

`dsh-account-store-sqlite` 把 [`dsh-account-store`](../account-store/README.zh.md) 所定义的账户保存在一个 SQLite 数据库文件中，使用 Node 内置驱动——不需要外部数据库进程，也没有任何东西要安装。在 Control Plane 组合中挂载它、指向一个路径，组织与成员账户便可跨重启持久化。数据库自己声明其不变量：登录名在其组织内唯一、账户必须属于一个已存在的组织，因此违规写入会被 SQLite 直接拒绝，而不是先落库、再等某个检查发现。

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

一行配置就是全部设置：

```yaml
- id: account-store
  name: '@deepseek-ai/dsh-account-store-sqlite'
  config:
    path: /var/lib/dsh-team/accounts.db
```

`path` 接受 `:memory:` 表示进程内数据库，测试用的就是它。文件及其 schema 在首次打开时创建。

### 它保证什么

每次写入都是单条语句，因此本身即是原子的；这里没有任何操作横跨两张表。`listUsers` 按插入顺序返回账户，依据的是 SQLite 自身的行标识而非时间戳，因此同一毫秒内签发的两个账户仍会按创建顺序返回。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### Schema 归属

数据库携带一个 application id 和单调递增的 `SCHEMA_VERSION`。打开时会拒绝由其他应用打过戳的文件，也会拒绝由更新版本写出的文件——降级无法知道一个它从未见过的列意味着什么，因此它选择停下而不是向下迁移。

### 不变量存在于 schema 之中

`(org_id, login_name)` 唯一索引和指向 `organization` 的外键，就是本后端必须守住的持久关系。把它们声明给 SQLite，意味着违规写入根本不会落库，这也是本包的不变量伴随插件什么都不安装的原因：不存在一个「坏行已存在、等待被发现」的时间窗。

只有登录名索引会转化为接缝错误。其他任何失败——组织不存在、磁盘写满——都原样传递，因此调用方永远不会被告知错误的原因。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 存储实现及其插件配置 |
| [`src/schema.ts`](src/schema.ts) | DDL、行形状，以及版本与 application id 的强制 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件的注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`account-store`](../account-store/README.zh.md)——本包实现的契约。
- [账户包地图](../README.zh.md)——本能力族如何拆分。
- [`team-control-plane/`](../../bundle/team-control-plane/README.zh.md)——本包被组合进的服务端 profile。

<a id="model-experience"></a>
## 模型体验

无，因为该后端保存的是服务端身份，任何提示词分段、工具或请求上下文都触及不到它。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包既无请求前缀也无缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是本后端当前的约束，不是待办清单。

- **同一时刻只服务一个进程**——SQLite 在文件内对写者串行化，因此本后端适配部署所面向的单 Control Plane 实例。不支持两个实例对同一文件运行；那正是客户端/服务器数据库的用武之地。
- **只有增量式 schema 变更能自我完成**——每条语句都是 `CREATE ... IF NOT EXISTS`，因此更旧的文件会获得新版本所添加的内容，并被打上新的版本号。修改或删除既有列的变更尚无路径，必须自带一条。
- **policy revision 经由 `Number` 读取**——该列是 64 位 SQLite 整数并以 `bigint` 暴露，但读取过程经过 JavaScript number，因此只在 2^53 以下精确。一个 revision 计数器不会触及该上限。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`node:sqlite` 无需依赖，且已经是 session persistence、session query 和 storage 的后端，因此本包没有给仓库新增任何驱动。面向多实例部署的 PostgreSQL 后端，是同一个 Service Definition 之后的第二个 provider，而不是对此处的改动。

</details>
