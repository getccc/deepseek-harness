---
description: "Control Plane 面向 Runner 的发布路由：由成员所持角色决定它被提供哪个已发布版本，以及该部署强制执行的版本下限；面向 Team 部署的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-release-http

[English](README.md) | 中文

## 概述

本包为 Runner 回答一个问题：这位成员被提供哪个版本？它校验设备访问令牌，向访问控制询问该成员的角色是否包含预发布通道，并答复它可以取用的最新版本——与发布时完全一致的签名清单——连同该部署强制执行的版本下限。它交还一份自己无法产出的文档，因此一台落入他人控制的 Control Plane 可以扣住某个版本，却无法让已安装的应用去取用某个版本。

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

在携带 `webServer`、`teamReleases`、`deviceAuthorization` 与 `accessControl` 的 Control Plane 组合中挂载它：

```yaml
- id: team-release-http
  name: '@deepseek-ai/dsh-team-release-http'
  config:
    maxRequestBodyBytes: 4096
```

以 `{"protocolVersion": 1}` 与 `Authorization: Bearer <设备访问令牌>` 请求 `POST /team/updates/manifest`，会得到 `200` 与清单、其签名和 `minimumVersion`；没有任何版本提供给该成员时得到 `404`，其中仍携带下限；令牌未知、过期或被吊销时得到 `401`；协议版本不同得到 `426`；方法不同得到 `405`。

### 谁会被提供预发布版本

该路由注册一个受管资源 **Staged releases**，使控制台的角色编辑器可以把 `release.staged` 授予某个角色。持有它的成员会被提供两个通道中最新的版本；其余成员被提供最新的 `general` 版本，即使存在更新的预发布版本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

协议版本在校验令牌之前判定，因为按发送方并不指的语法去解码请求体，正是版本检查失去意义的方式，而让一个过时的 Runner 重新登录也无济于事。

该判定在每次调用时重新询问而不缓存，因此角色变更、成员被停用、设备被吊销都会在下一次检查更新时生效。受管资源在每个进程中按组织注册一次；注册对它所命名的身份是幂等的。

答复会把存储的文档重新编码为 JSON，这是安全的，因为签名覆盖的是清单的规范字节，而不是某一次传输的字节。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-team-release](../team-release/README.zh.md)——本路由读取的存储。
- [dsh-team-update](../team-update/README.zh.md)——已安装应用如何处理这份答复。
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.zh.md)——发起询问、校验、下载并安装的外壳。
- [Team 包地图](../README.zh.md)——相邻的 Team 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该路由不注册任何模型输入。

#### KV Cache 影响

此处没有任何内容进入模型请求，因此没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

- **按成员答复，而非按设备** ——拥有两台电脑的成员，两台都会被提供同一个版本，即使只有一个平台有构建。
- **Runner 看不到发布历史** ——该路由答复成员可以取用的最新版本；Runner 无法询问还发布过什么。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。本路由依赖的每一个关系——令牌、授权、已存储的版本——都由另一个包拥有并断言。
