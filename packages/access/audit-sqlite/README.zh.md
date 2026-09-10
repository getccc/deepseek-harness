---
description: "SQLite 审计存储：一张只追加的事件表，其每一个文本列装的都是目录词或短 Token，任务内容无处落脚。"
kind: "package-reference"
---

# @deepseek-ai/dsh-audit-sqlite

[English](README.md) | 中文

## 概述

`dsh-audit-sqlite` 把[审计](../audit/README.zh.md)存放在一个 SQLite 数据库中。这里正是隐私主张不再只是一项约定的地方：Schema 把两份目录播种进表并用外键指向它们，把 Token 规则作为 `CHECK` 在每一个文本列上再声明一次，并用触发器拒绝 `UPDATE` 和 `DELETE`。一个绕过服务、直接打开文件的调用方，依然既存不进 Prompt，也改不了已经存下的东西。

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
  '@deepseek-ai/dsh-audit-sqlite':
    path: ./audit.sqlite
    maxQueryRows: 500
```

`maxQueryRows` 约束每一次读取。请求更多的读者得到这么多；请求更少的读者得到它所请求的数量。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### Schema 把规则再陈述一遍

| 列 | 约束它的是什么 |
|---|---|
| `action` | 指向已播种动作目录的外键 |
| `outcome`、`reason` | `CHECK … IN`，由 Definition 导出的词表渲染而来 |
| `org_id`、`principal_id`、`resource_id`、`device_id`、`correlation_id` | `CHECK`：1–64 个字符，`NOT GLOB '*[^A-Za-z0-9._:@-]*'` |
| `audit_event_metadata.key` | 指向已播种 Metadata Key 目录的外键 |
| `audit_event_metadata.value_text` | 同一条 Token `CHECK` |

没有 `resource_type` 列：动作已经确定了它，因此目录只持有它一次，需要按它过滤的查询做一次 JOIN。一份反规范化的副本会是一个无人约束的文本列。

### 只追加，在数据库层面

四个触发器在两张表上中止 `UPDATE` 和 `DELETE`。`seq` 用的是 `AUTOINCREMENT` 而不是 rowid 别名，因此即便将来某次迁移取消了某个触发器，被删除的最大值也永远不会被再次发出。

### 播种只增不减

这个构建不再知道的动作或 Key 会留在它的目录表里，于是引用它的事件保住外键。阻止它被再次记录的是代码目录，而不是这些表；读取时会丢弃当前构建已退役的 Metadata Key，而不是抛出一个没有任何消费方声明的值。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务本体：record、query，以及行到事件的映射 |
| [`src/schema.ts`](src/schema.ts) | 表、约束、触发器与目录播种 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`audit`](../audit/README.zh.md) —— Service Definition 及本后端所播种的目录。
- [审计子系统](../../../docs/subsystems/audit.zh.md) —— 完整的词汇表与存储规则。
- [`access-control-sqlite`](../access-control-sqlite/README.zh.md) —— 同组存储，Schema 版本与 Application ID 的处理方式相同。

<a id="model-experience"></a>
## 模型体验

无，因为审计只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **保留期无法通过删除行来实现** —— 触发器按设计就会拒绝它。落实一个保留窗口需要一条有文档的特权路径，例如在一次 Schema 迁移中删除某个触发器。
- **一条记录不与它所描述的变更同事务写入** —— 审计数据库与账户、访问控制数据库彼此独立，因此一次操作与它的记录各自提交。
- **`policy_revision` 以 SQLite 整数存储** —— 与账户存储的修订号计数器已经共处的 53 位上限相同。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试特意开第二条连接到同一个文件并写裸 SQL。被测的主张不是"服务不肯存 Prompt"，而是"数据库存不进 Prompt"；一个只走服务的测试，面对一份毫无约束的 Schema 也照样会通过。

</details>

**运行时不变量：**不发布伴随文件：该后端必须保持的关系（事件指向本构建审计的动作、元数据指向已注册的键、token 列短而纯、任何行不得修改或删除）以外键、CHECK 约束和触发器声明给 SQLite，违规写入会被拒绝。
