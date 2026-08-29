---
description: "治理能力族的包地图：封闭的权限目录与默认拒绝的授权接缝、只追加的审计，以及两者背后的 SQLite 后端。"
kind: "package-group"
---

# access/ — 成员能做什么，以及做过什么

[English](README.md) | 中文

## 概述

`access/` 组判定一个主体是否可以对某个资源执行某个动作，保存该判定所读取的角色、授权与受治理资源，并记录判定了什么。求值刻意做得很小——默认拒绝、角色的授权准入、多个角色取并集、被停用的资源一律拒绝——没有显式 Deny、没有角色继承、没有表达式语言，因此一次拒绝可以通过点名产生它的那些授权来解释。两半都是由代码播种的封闭目录：管理员用已注册的权限组合拼装角色，而不是凭空造出权限字符串；一条审计记录携带的是目录词与短 Token，而不是任何人的工作。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

两个能力接缝、四个包；完整契约由各自的子 README 拥有。

| 包 | 作用 | ctx key |
|---|---|---|
| [`access-control/`](access-control/README.zh.md) | Service Definition 与代码播种的权限目录 | `ctx.accessControl` |
| [`access-control-sqlite/`](access-control-sqlite/README.zh.md) | 存放角色、授权与受治理资源，并在其上求值 | 注册 `ctx.accessControl` |
| [`audit/`](audit/README.zh.md) | Service Definition、动作与 Metadata 目录，以及记录检查 | `ctx.audit` |
| [`audit-sqlite/`](audit-sqlite/README.zh.md) | 存放只追加的审计，并把同一套规则声明给数据库 | 注册 `ctx.audit` |

-----

<a id="related-documentation"></a>
## 相关文档

- [访问控制子系统](../../docs/subsystems/access-control.zh.md)——求值规则及其读取的记录。
- [审计子系统](../../docs/subsystems/audit.zh.md)——把任务内容挡在外面的封闭词汇表与存储规则。
- [`account/`](../account/README.zh.md)——被授权的身份，以及其策略修订号被本组递增的那个组织。
- [能力接缝](../../docs/capability-seams.zh.md)——本能力族遵循的 Service Definition / Service Provider / Consumer 拆分。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

配额刻意不在此处：授权回答的是主体是否可以使用某个资源，配额回答的是是否还有额度。把两者合并会让一次拒绝变得含混。

授权与审计是两个独立接缝，而不是一个既判定又记录的服务，因为对请求求值的那份存储并不知道任何主体的设备、关联标识或意图。记录由持有这些信息的那次操作写入。

</details>
