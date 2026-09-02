---
description: "dsh 团队版 Control Plane：一个刻意不挂载 Agent、文件系统、shell 或代码执行能力的独立服务端 bundle，供运行公司服务的部署使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-team-control-plane

[English](README.md) | 中文

## 概述

`dsh-team-control-plane` 是 Team Edition 的管理员与公司资源服务器。它持有公司凭据并应答每位成员 Runner，正因如此，它不具备 Agent、文件系统、Shell、Subprocess 或 Sandbox 能力。这棵完整独立配置树包含账户认证、访问控制、审计、管理控制台自身的导航、设备授权、配额、模型网关、面向 Runner 的认证端点，以及管理 API 与应用。它不组合成员浏览器登录或确认页面。

它不会在未配置的情况下启动：Runner 认证与管理 API 都需要部署提供组织 ID。它们会直接失败，而不是猜测自己服务于哪个账户命名空间。

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

该 profile 只组合本 bundle，并监听 `127.0.0.1:3095`。普通成员不会浏览此端口；管理员访问 `/team/admin/`，Runner 则调用设备、模型与知识端点。

### 生产环境绑定

默认绑定回环地址。生产部署应在该监听器前用反向代理终止 TLS，而不是直接暴露它。必须绑定所有网络接口的部署，应在自己的 profile patch 中声明，并重述 `webserver` 行拥有的每一个键。

### 部署私有知识

有三个配置项没有默认值，缺少它们组合就无法加载：知识源上的 `sourceCode`、`baseUrl` 和 `credentialRef`。猜测自己治理哪个知识部署的 Control Plane 会读到陌生人的知识，而猜测数据源代码的 Control Plane 会铸造出比这个错误活得更久的知识引用。

凭据必须解析为 WeKnora 的**空间** Key，而不是平台 Key。空间 Key 固定访问其所属空间；平台 Key 能访问任意空间并通过租户请求头指定是哪一个，因此持有平台 Key 的 Control Plane 可以读到它所治理空间之外的知识。

把知识部署运行在本主机上，并把它的回环地址给 `baseUrl`。通过回环访问它，正是使「成员除了经由这里做出的判定之外无法读取公司知识」成为网络事实而非策略的原因：不存在供成员发现的来源，也没有凭据跨网段传输。必须把两者拆到不同主机的部署，应在把地址移出回环之前恢复等效限制——一个私有网段和一个服务身份。

`sourceCode` 被限制为审计 token 字符集下的 19 个字符。它是知识引用中由部署选择的部分，而整个引用必须放得进审计存储会记录的内容，因此更长的值在加载期失败，而不是在第一次检索被拒时。

### 存储与实例数量

每个存储都是 DSH home 下的一个 SQLite 文件，这把部署限制为一个具有持久存储与备份的活动 Control Plane 进程。这是真实约束而非默认设置：两个进程使用这些文件的副本，会在授权和存在哪些知识库上产生分歧。横向副本需要共享数据库设计，而不是副本。

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

- **组织初始化仍在控制台之外**——部署必须先创建组织、初始管理员密码、管理入口授权与动作授权，控制台才能继续管理自身。
- **能力缺席在组合层强制，不在运行时**——若部署方在自己的 profile patch 里添加本地执行配置行，即可绕过。测试约束的是本仓库交付的内容，不是运维方后续组合出的内容。
- **默认绑定回环地址**——从其他主机访问需要在前面加反向代理，或用重述整个 `webserver` 行的部署 patch。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

组合测试中的禁用包清单是逐条写出的，而不是按前缀匹配，这样新增能力包时必须在此处做出明确决定，而不是悄悄匹配上某个模式，或悄悄逃过它。

</details>
