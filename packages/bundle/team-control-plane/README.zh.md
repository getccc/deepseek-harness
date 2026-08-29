---
description: "dsh 团队版 Control Plane：一个刻意不挂载 Agent、文件系统、shell 或代码执行能力的独立服务端 bundle，供运行公司服务的部署使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-team-control-plane

[English](README.md) | 中文

## 概述

`dsh-team-control-plane` 是 Team Edition 的服务端一半。它持有公司凭据并应答每位成员 Runner 的请求，正因如此，它不具备在自己所运行的机器上执行代码、读取文件或驱动 Agent 的任何能力。与其他每个 Team bundle 不同，它不叠加在 [`dsh-base`](../base/README.zh.md) 之上：base 挂载 Agent loop、文件系统、subprocess、shell 和 sandbox 提供者，叠加它等于一次性把这些全都交给 Control Plane。目前这棵树只有一个 HTTP 传输，别无他物；公司服务——账户、RBAC、配额、审计、模型与知识库网关、私有目录和管理界面——会随各自的包落地插入此处。

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

你不直接挂载本 bundle，而是选择指名它的 profile：

```sh
dsh --profile team-control-plane
```

该 profile 只组合本 bundle。它监听 `127.0.0.1:3095`，且在当前阶段不注册任何路由——公司服务到来时各自认领。

### 生产环境绑定

默认绑定回环地址。生产部署应在该监听器前用反向代理终止 TLS，而不是直接暴露它。必须绑定所有网络接口的部署，应在自己的 profile patch 中声明，并重述 `webserver` 行拥有的每一个键。

### 与 Runner 并行运行

该端口与 Team Runner 的 `3090` 及 `dsh web` 的 `3080` 都不同，因此维护者可以在一台机器上同时运行三者进行开发，不会发生绑定冲突。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 为什么它不叠加 base bundle

其他每个 Team bundle 都是叠加在既有配置树上的 patch 层。这一个是自成一体的完整树，形态与 [`dsh-sdk-minimal`](../sdk-minimal/README.zh.md) 相同——因为它**必须不具备**的那组能力，恰恰就是 `dsh-base` 所提供的。

这种缺席是组合层面的事实而非运行时事实，因此由测试在两个相互独立的位置守住：本包断言其 patch 不指名任何本地执行包、其清单不声明对这类包的依赖，而 `app-boot` 断言 profile 模板不指名任何会重新引入它们的 bundle。缺少包声明时新增的配置行会加载失败而不是悄悄挂载，因此清单是第二道屏障，不是第一道的重复。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 该 profile 启动的完整配置树 |
| [`src/index.ts`](src/index.ts) | 仅提供模块身份；本 bundle 不暴露运行时 API |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件的注册 |

### 不变量归属

本包是静态的 patch 列表载体：不挂载服务、不发出事件、不拥有可检查的可变关系，因此其伴随插件不安装任何检查。它要保证的能力缺席在运行时不可观测——因为那里什么都没有——所以改由组合测试拥有。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`dsh-team`](../team/README.zh.md)——本服务端所应答的成员侧 Runner 表层。
- [`dsh-sdk-minimal`](../sdk-minimal/README.zh.md)——另一个独立 bundle，也是本包遵循的形态。
- [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)——profile 如何解析与分层。
- [Bundle 包地图](../README.zh.md)——其他表层及其组合方式。

<a id="model-experience"></a>
## 模型体验

无，因为 Control Plane 不运行 Agent，也不挂载提示词分段、工具或请求上下文。

#### KV Cache 影响

本 bundle 根本不驱动模型请求，因此既无请求前缀也无缓存影响。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是本 bundle 当前的约束，不是待办清单。

- **这棵树只有传输，别无他物**——尚未注册任何路由，因此服务器对每个请求都返回 404。账户、RBAC、配额、审计、网关、目录和管理界面会随各自的包陆续到来。
- **能力缺席在组合层强制，不在运行时**——若部署方在自己的 profile patch 里添加本地执行配置行，即可绕过。测试约束的是本仓库交付的内容，不是运维方后续组合出的内容。
- **默认绑定回环地址**——从其他主机访问需要在前面加反向代理，或用重述整个 `webserver` 行的部署 patch。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

组合测试中的禁用包清单是逐条写出的，而不是按前缀匹配，这样新增能力包时必须在此处做出明确决定，而不是悄悄匹配上某个模式，或悄悄逃过它。

</details>
