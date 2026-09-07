---
description: "SQLite 模型网关：目录存储，以及它前面的授权与预留。"
kind: "package-reference"
---

# @deepseek-ai/dsh-model-gateway-sqlite

[English](README.md) | 中文

## 概述

`dsh-model-gateway-sqlite` 把[公司模型目录](../model-gateway/README.zh.md)保存在一个 SQLite 数据库中，并做出它前面的判定：有没有这个模型、这个主体可不可以调用它、还有没有预算。注册一个模型会在同一次调用中把它纳入访问控制的治理——一条访问控制不知道的目录记录，是一个没有授权能指名、也没有人能调用的模型。

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
  '@deepseek-ai/dsh-model-gateway-sqlite':
    path: ./models.sqlite
```

它注入 `accessControl` 和 `quota`，因此两者都必须先于它挂载。"模型是什么"没有配置项：目录由管理员填充，而不是由一个配置文件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 注册与治理是同一个动作

`register` 写下目录行，并把同一个模型注册为受治理资源。`setStatus` 同时移动两者，因此一个退役的模型在访问控制那边也会被拒绝——无论请求从哪个入口到达。

### 目录持有的是引用，不是密钥

凭据引用是通往 Credential Provider 的一把钥匙。读取这个数据库得不到任何人能花掉的东西，轮换一份凭据也不改变这里的任何内容。

### 三个判定的顺序

一个没人可以发现的模型，在其他任何东西运行之前就被拒为 `unknown-model`。一个已授权但没有预算的模型，在它已经通过的那次授权**之后**被拒，因此阅读审计的管理员能区分"不被允许"和"没钱了"。预留最后才取，因此一个被拒绝的请求什么也不占。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 目录操作与三个判定 |
| [`src/schema.ts`](src/schema.ts) | 表、它的约束与 pragma 守卫 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`model-gateway`](../model-gateway/README.zh.md) —— Service Definition 与请求体改写。
- [模型网关子系统](../../../docs/subsystems/model-gateway.zh.md) —— 完整判定的散文版。
- [`access-control-sqlite`](../../access/access-control-sqlite/README.zh.md) —— 模型成为受治理资源的地方。

<a id="model-experience"></a>
## 模型体验

无，因为网关只存在于服务端，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **`discover` 对每个模型询问一次访问控制** —— 在本版本所面向的目录规模上没有问题，而批量判定应由访问控制接缝提供，而不是由这里绕过。
- **没有价格元数据** —— 目录携带的是输出上限，不是费率，因此账本计的是 Token 而不是钱。
- **模型从不被删除** —— `setStatus` 让它退役，因为授权、预留和结算都引用那个 Ref。
- **Schema 版本 2 双向拒绝** —— `input_modalities` 是一个带非空 CHECK 的 JSON 数组列，处于任何其他 `user_version` 的文件在打开时被拒绝而不是迁移；在第一个打标签的发布之前，部署方重建目录并重新注册模型。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试是对着真实的访问控制与配额组合而不是桩来跑的。值得测的是三个判定的顺序以及每一个拒绝了什么，而一个桩只会重放测试告诉它的东西。

</details>
