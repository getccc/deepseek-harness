---
description: "账户能力族的包地图：保存组织与成员账户的后端中立存储，以及持久化它们的 SQLite 后端。"
kind: "package-group"
---

# account/ — 成员是谁

[English](README.md) | 中文

## 概述

`account/` 组保存 Team Edition 所授权的身份：一个组织及其中的成员账户，每个账户带有登录名、状态，以及锁定策略要读取的登录状态。该存储只是一个仓储，别无其他——它记录发生了什么并报告冲突，而「失败次数意味着什么」这一策略、以及任何认证材料的格式，都属于经它读写的认证提供方。把存储与认证方式拆开，正是为了让外部身份提供方日后替换登录方式时，无需触碰已存储的账户、角色和设备。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

四个包覆盖本能力族；完整契约由各自的子 README 拥有。

| 包 | 作用 | ctx key |
|---|---|---|
| [`account-store/`](account-store/README.zh.md) | Service Definition：组织、成员账户与登录状态 | `ctx.accountStore` |
| [`account-store-sqlite/`](account-store-sqlite/README.zh.md) | 把它们保存在一个 SQLite 数据库文件中 | 注册 `ctx.accountStore` |
| [`account-auth/`](account-auth/README.zh.md) | Service Definition：把登录名与密钥变成一个账户 | `ctx.accountAuth` |
| [`account-auth-password/`](account-auth-password/README.zh.md) | 对着已存哈希校验，并拥有锁定策略 | 注册 `ctx.accountAuth` |

-----

<a id="related-documentation"></a>
## 相关文档

- [账户子系统](../../docs/subsystems/account.zh.md)——身份模型、Credential 格式，以及一次登录如何被回答。
- [能力接缝](../../docs/capability-seams.zh.md)——本能力族遵循的 Service Definition / Service Provider / Consumer 拆分。
- [`team-control-plane/`](../bundle/team-control-plane/README.zh.md)——这些包被组合进的服务端 profile。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

认证属于它自己的能力族而不在此处，因此替换登录方式永远不会迁移已存储的身份。

</details>
