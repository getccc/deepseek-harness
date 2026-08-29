---
description: "SQLite 设备授权存储：绑定状态机、设备注册表，以及在重放时自我吊销的 Refresh Token Family。"
kind: "package-reference"
---

# @deepseek-ai/dsh-device-authorization-sqlite

[English](README.md) | 中文

## 概述

`dsh-device-authorization-sqlite` 在一个 SQLite 数据库上运行[绑定流程](../device-authorization/README.zh.md)：Transaction 及其唯一的 Authorization Code、由兑换填充的设备注册表，以及被重放摧毁的 Refresh Token Family。每一份密钥都以哈希存放，每一个一次性值都带着记录它已被消费的那一列，因此重放是一次查表，而不是一次判断。

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
  '@deepseek-ai/dsh-device-authorization-sqlite':
    path: ./devices.sqlite
    transactionTtlMs: 300000
    codeTtlMs: 60000
    accessTokenTtlMs: 900000
    refreshTokenTtlMs: 2592000000
```

`codeTtlMs` 由构建封顶在 60 秒。部署可以调短它，但不能调长，因为 Code 只走一次重定向，更长的窗口买到的是攻击者的时间，而不是成员的任何东西。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### Code 住在它的 Transaction 上

一个 Transaction 至多有一个 Authorization Code，因此 Code 的哈希、有效期与消费时间住在 Transaction 行里，而不是另起一张表。这让"每个 Transaction 一个 Code"成为结构上的事实，而不是需要谁去执行的规定。

兑换按 Code 自己的哈希查找，然后核对该行就是调用方所指名的那个 Transaction，因此与错误 Transaction 配对的 Code 是根本查不到，而不是查到后再被拒绝。

### 已消费的行被保留

一个已消费的 Refresh Token 留在表里。重放检测是一次能查到"已消费"行的查表；删掉它会让一次重放与一个从未存在过的 Token 无法区分。

### 撤销是一次操作

读取方只检查 Credential Family，因此 `revokeDevice` 在同一次调用中撤销设备**并且**吊销它曾经开启的每一个 Family。一台被撤销却留着活 Family 的设备，依然能拿到 Token。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 状态机：start、confirm、redeem、refresh、verify、revoke |
| [`src/schema.ts`](src/schema.ts) | 表、约束与 pragma 守卫 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`device-authorization`](../device-authorization/README.zh.md) —— Service Definition 与共享导出。
- [设备授权子系统](../../../docs/subsystems/device-authorization.zh.md) —— 完整的流程及其拒绝。
- [`account-store-sqlite`](../account-store-sqlite/README.zh.md) —— 同组存储，Schema 版本与 Application ID 的处理方式相同。

<a id="model-experience"></a>
## 模型体验

无，因为设备绑定只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **没有任何东西清理过期 Transaction 或已消费 Token** —— 两者都被保留以便重放可被检出，而保留期处理需要它自己的设计，而不是一句会抹掉证据的 `DELETE`。
- **Browser Session 被记录，而不是被验证** —— 存储保存是哪个 Control Plane 会话确认了某个 Transaction；判定该会话是否有效属于持有它的那个调用方。
- **重新绑定一台被撤销的设备会让它重新生效** —— 再次绑定同一台电脑的成员，会经过一次全新的人工确认，那正是首次绑定所要求的同一份证据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试驱动的是一对真实的 Ed25519 密钥，而不是一个桩签名器。被测的性质是：只有持有成员比对过的那份摘要背后私钥的一方，才能走完这套流程；而一个桩签名器对此什么也证明不了。

</details>
