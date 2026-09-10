---
description: "基于账户存储的密码认证：带自描述参数的 scrypt 派生、校验时按需重算，以及锁定策略。"
kind: "package-reference"
---

# @deepseek-ai/dsh-account-auth-password

[English](README.md) | 中文

## 概述

`dsh-account-auth-password` 回答 [`dsh-account-auth`](../account-auth/README.zh.md)：用 Node 内置的 scrypt 派生密钥，再与 [`dsh-account-store`](../account-store/README.zh.md) 所保存的值比对——不需要安装依赖，也没有原生构建。它拥有由存储的计数器驱动的策略：连续多少次失败会锁定账户、锁多久。每一个已存哈希都记录着产生自己的参数，因此提高部署的成本——或日后换用另一种算法——都会在持有者下次登录时自动升级该账户，无需他们做任何事。

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
- id: account-auth
  name: '@deepseek-ai/dsh-account-auth-password'
  config:
    minSecretLength: 8
    requiredClasses: [uppercase, lowercase, digit]
    maxFailedAttempts: 5
    lockDurationMs: 900000
```

每个字段都有默认值，因此空配置就是一套可用部署。派生成本同样可配（`cost`、`blockSize`、`parallelization`），默认取的是刻意偏慢的设置；调低它是一个需要明确做出的决定，不是随手可取的优化。`requiredClasses` 指名密钥必须各含一个字符的类别：`uppercase`、`lowercase` 与 `digit`，可任意组合，也可以一个都不要。`secretPolicy` 会回答这两个字段，调用方无需另行写死要求就能说明它。

### 日后提高成本

改 `cost` 并重启。没有任何批量迁移：每个账户会在其持有者下次成功登录时按新成本重新派生，因为哈希自带参数，提供方会把它与当前参数比对。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 编码后的哈希是自描述的

已存哈希形如 `$scrypt$N=..,r=..,p=..$salt$derived`。校验使用哈希自身记录的参数，而绝不使用当前生效的参数——这正是配置变更后所有既存哈希依然有效的原因。开头的算法段，是未来的提供方能在不作废任何东西的前提下新增算法的原因：校验按它读到的内容分派，而它认不出的哈希会被当作需要替换，而不是当作匹配。

### 为什么账户不存在也要花算力

当登录名不存在、账户被停用、被锁定或从未认领过密钥时，`authenticate` 会对着一个进程级的诱饵哈希做派生。没有它，账户不存在的情形会比密钥错误更快返回，而计时会暴露出接缝的无原因失败所隐瞒的东西。

### 锁定策略在哪里

存储负责计数；本提供方负责裁决。密钥错误会递增存储的计数器，达到 `maxFailedAttempts` 则把账户锁定 `lockDurationMs`。锁定会重置计数器，因此一个刚过期的锁不会只差一次失败就再次锁上。被停用或被锁定的账户在任何计数之前就被拒绝，因此攻击者无法靠持续攻击把一个账户一直锁着。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方、其配置，以及锁定策略 |
| [`src/hash.ts`](src/hash.ts) | 派生、编码形式、校验，以及重算判定 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`account-auth`](../account-auth/README.zh.md)——本包实现的契约。
- [`account-store`](../account-store/README.zh.md)——哈希与计数器的所在。
- [账户子系统](../../../docs/subsystems/account.zh.md)——两个接缝合在一起看。

<a id="model-experience"></a>
## 模型体验

无，因为密码校验发生在服务端，不注册任何提示词分段、工具或请求上下文。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包既无请求前缀也无缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是本提供方当前的约束，不是待办清单。

- **是 scrypt，不是 Argon2id**——设计中点名的是 Argon2id，而它需要一个本仓库并不携带的依赖；scrypt 内置于 Node 且是内存困难的。编码后的哈希记录了自己的算法且校验按它分派，因此 Argon2id 提供方是增量式的，且每个既存哈希在其持有者下次登录之前都继续有效。
- **计时是相当，而非恒定**——诱饵派生消除了账户不存在时本会出现的大幅差异。JavaScript 运行时无法承诺恒定时间，本包也不作此宣称。
- **计数器同一时刻只服务一个进程**——两个 Control Plane 实例对着同一个存储，可能交错递增失败计数并冲过阈值。本包所面向的部署只运行一个。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

诱饵哈希每个进程只派生一次并复用。逐次尝试都派生会让每一次真实登录的成本翻倍，却换不来任何额外性质。

</details>

**运行时不变量：**不发布伴随文件：该 provider 必须保持的关系都在一次调用与账户存储自身的行之间（失败递增计数，成功清零），存储是两者的权威；这里没有可供运行时检查读取的可变状态。
