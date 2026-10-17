---
description: "基于 SQLite 的受治理 GMO 网关：持久的分类目录、对照数据源的同步、access-control 注册、逐操作授权与审计。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-gateway-sqlite

[English](README.md) | 中文

## 概述

`dsh-gmo-gateway-sqlite` 在 SQLite 上实现 `ctx.gmoGateway`。它保存持久的分类目录，对照数据源的一次成功列表做同步，把每个分类作为受治理资源注册到 access control，在询问数据源任何东西之前对照当前授权授权每个面向成员的操作，并为每个操作记录一行审计。目录记录一个分类是什么，不记录任何人问过它什么：没有存放结果、数字、筛选或凭据的列。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 access control、audit 与一个 `ctx.gmoSource` 提供方之后挂载到 Control Plane。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-gmo-gateway-sqlite'
  config:
    path: gmo.sqlite
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `path` | 无，必填 | 目录数据库的路径 |
| `journalMode` | `wal` | SQLite 日志模式；无法承载 WAL 共享内存文件的文件系统用回滚日志 |
| `busyTimeoutMs` | `1000` | 语句等待另一连接的锁多久 |
| `defaultResultPageSize` | `20` | 调用方没有指定大小时，一页结果列表的条数 |

### 同步

`sync` 在管理员请求时运行，且串行化：并发调用方加入已在进行的操作。一次成功的完整列表按以下规则应用。此前未知的分类登记一个受管资源并**以停用状态开始**。已知分类更新名称与结果数，不改变它的引用、资源或授权。成功列表里缺失的分类，连同它的资源以及指名它的所有授权一起被撤下。手动启用或停用从不被覆盖。失败的列表保留最近一次快照，并在数据源上记录失败词。

### 授权

每个面向成员的操作都对照目录解析它的分类，并在调用数据源之前，对该分类的资源重新向 access control 询问 `gmo.query`。未知、已停用和未授权的分类是同一种拒绝，记录方式也相同，所以什么都没被授予的成员无从得知某个分类是否存在。随后由数据源定位结果引用，数据源对分类的看法不一致时，操作被拒绝且没有读取任何东西；数据源归给另一分类的答案不被读取即丢弃。

### 审计

每个操作一行：`gmo.results`、`gmo.describe`、`gmo.ask` 与 `gmo.catalog.sync`。一行携带分类引用、提问的种类、条数和封闭的失败标签。名称、列、筛选和数字不会进入其中。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

两个数据库无法一起提交。access control 仍是角色、授权与资源的权威；本目录记录分类是什么。同步是幂等且重复进行的，所以这一对写入中第一个之后失败的写入，会被下一次同步修复，而不是留成永久的不一致。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 网关、它的配置、同步、授权与审计 |
| [`src/schema.ts`](src/schema.ts) | 表、schema 版本与 application id 检查 |

### 数据模型

`gmo_source` 每个已配置数据源一行，记录上次列表的情况；`gmo_category` 每个分类一行，含引用、上游键、显示名、结果数、管理员的启用位，以及上次被发现的时间。schema 版本单调递增，由其他构建写入的数据库被拒绝而不是迁移，这是本仓库对持久格式的预发布立场。

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——词汇与失败分类。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——本包执行的不变量。

<a id="model-experience"></a>
## 模型体验

无，因为网关运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它；数字只有在本网关授权、Runner 侧工具渲染之后才对模型可见。

#### KV Cache 影响

这里没有请求前缀的变化；受治理结果在 Runner 侧的消费方负责其带来的变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **两个存储无法一起提交**——目录与 access control 之间被中断的写入会留下一行，由下一次同步修复；在此之前，没有受管资源的行被隐藏，而不是展示为已治理。
- **授权按分类各评估一次**——目录对每个分类询问 access control，几十个分类时没有问题；之后的批量操作必须保持逐资源评估。
- **没有迁移**——其他 schema 版本的数据库被拒绝；重建的代价是一次同步和管理员的启用选择。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

同步、目录与授权的代码是知识库和 BI 网关的第三份副本，`pnpm run duplication` 会报告这些重复。抽取共用的受治理目录助手是后续项：它会动到已发布、且没有任何已录制会话测试覆盖的知识库与 BI 代码，所以本次变更没有做。

</details>

**运行时不变量：** 不发布伴随包：本包拥有一个 SQLite 文件，打开时检查其 schema 版本与 application id；目录与 access control 之间的关系由同步修复，而不是在运行时断言。
