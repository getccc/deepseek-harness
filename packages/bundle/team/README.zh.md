---
description: "dsh 团队版表层：在 dsh-web-app 之上分层、使用独立回环端口的共享本机 Runner，供组合 team profile 的部署使用。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-team

[English](README.md) | 中文

## 概述

`dsh-team` 是把本机 Web 表层变成 Team Runner 的那一层。它叠加在 [`dsh-base`](../base/README.zh.md) 与 [`dsh-web-app`](../web-app/README.zh.md) 之上，把工作空间与执行留在成员电脑。本层拥有 `3090` 端口、`/team/login` 本地账户登录、这台电脑持有的设备凭据，以及公司模型传输。`3080` 继续留给独立 `dsh web`。

它不会在未配置的情况下绑定：Account Client 行不指名任何 Control Plane，也不指名 Runner 版本，因此一个没人告诉它属于哪家公司的 Runner 会加载失败，而不是把公钥发给一个陌生人。

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

你不直接挂载本 bundle，而是选择叠加了它的 profile：

```sh
dsh --profile team
```

该 profile 依次组合 `dsh-base`、`dsh-web-app` 与本层，并打开 `http://127.0.0.1:3090/team/open`。未解锁的浏览器会看到本地账户表单，绝不会被送到 Control Plane 管理端源。

### 与 `dsh web` 并行运行

两者都是普通的回环服务器，因此不能共用端口：后绑定的那个会失败。让 Team Runner 使用自己的默认端口，意味着你可以在 `3080` 上保留开发用的 `dsh web`，同时让 Team Runner 服务 `3090`，两边都不需要改配置。

### 选择其他端口

`--port` 仍然优先于组合出的默认值：

```sh
dsh --profile team --port 8080
```

需要另一个固定端口的部署，应在 profile 自己的 `cordis.patch.yml` 中覆盖 `webserver` 行，并重述所有要保留的键。端口刻意固定而非扫描：公司入口会把浏览器导航到一个已知地址，因此一个悄悄换了地址的 Runner 会变成不可达，而不只是不存在。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 组合机制

本包的实质是 `cordis.patch.yml`，由 `dsh.bundle.patch` 清单字段指明。profile 组合器按 profile 列出的顺序应用每个 bundle 的 patch，因此本层看到的是 `dsh-base` 与 `dsh-web-app` 已经插入的配置行，并按 id 覆盖它们。

patch 会替换目标行的整个 `config`，因此这里的 `webserver` 与 `web-runtime` 覆盖会重述各自拥有的每一个键。Runtime 入口为 `/team/open`，它刻意不接收独立 Web 的进程 Token，因为 Team 解锁由本地账户认证负责。

### 源码地图

| 路径 | 作用 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 本层自身：本 bundle 覆盖的配置行 |
| [`src/index.ts`](src/index.ts) | 仅提供模块身份；本 bundle 不暴露运行时 API |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件的注册 |

### 不变量归属

本包是静态的 patch 列表载体：不挂载服务、不发出事件、不拥有可检查的可变关系，因此其伴随插件不安装任何检查。它覆盖的 `webserver` 行，其绑定不变量由 [`dsh-host-webserver`](../../host/webserver/README.zh.md) 拥有。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [app-boot 的 profile 章节](../../boot/app-boot/README.zh.md)——profile 如何解析、分层与重载。
- [`dsh-web-app`](../web-app/README.zh.md)——本层扩展的浏览器表层。
- [Bundle 包地图](../README.zh.md)——构建在 `dsh-base` 之上的其他表层。
- [生成的组合图](../../../apps/cli/composition.md)——每个随附 profile 实际使用的插件集合。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本层只覆盖一个传输地址，自身不插入提示词分段、工具或请求上下文。

#### KV Cache 影响

本 bundle 不向请求前缀添加任何内容；所有面向模型的配置行都属于 `dsh-base` 与 `dsh-web-app`。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

以下是本层当前的约束，不是待办清单。

- **同一时刻每台机器只有一个 Team Runner**——回环端口是整机资源，因此另一个操作系统用户启动的第二个 Runner 会绑定失败而不是改用其他地址。并发多用户机器不在本层范围内。
- **覆盖会替换整个设置块**——后续 patch 若要修改 `webserver` 的某一个键，必须重述其余各键；不存在自动合并。
- **桌面分发固定指向一个部署**——[Team Runner 桌面外壳](../../../apps/team-runner-desktop/README.zh.md)把一个 Control Plane 源写进它启动的 profile 补丁。切换部署需要另一份企业构建，而不是由成员编辑服务器地址。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

该 profile 保持 `patchReload: live`，与 `web` 一致，因为它服务的是同一个浏览器表层。后台服务在用户编辑 patch 时重新组合，这与 web profile 已有的行为相同；只有当服务托管的部署需要仅启动时应用的变体时，才需要重新考虑。

</details>
