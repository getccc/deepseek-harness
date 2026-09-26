---
description: "Runner 的回环发布路由：桌面外壳向它询问，而 Runner 用外壳并不持有的设备凭据去询问 Control Plane；面向 Team 桌面应用的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-update-source

[English](README.md) | 中文

## 概述

本包答复一个回环路由 `/team/update/manifest`，给出本部署提供给已登录成员的版本。桌面外壳向它询问，是因为外壳没有成员凭据、也不应该有，而 Runner 已经持有部署签发给它的设备凭据。Runner 不会添加任何外壳所信任的东西：它原样交还签名文档，而外壳在下载任何内容之前会自行校验发布密钥的签名。

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

在携带 `webServer` 与 `teamAccountClient` 的 Team Runner 组合中挂载它；桌面安装程序会用它所打包的那个部署写下这一行。

```yaml
- id: team-update-source
  name: '@deepseek-ai/dsh-team-update-source'
  config:
    controlPlaneUrl: https://control.example.com
    controlPlaneCa: /absolute/path/to/control-plane-ca.crt
```

`GET /team/update/manifest` 答复 Control Plane 所答复的内容：`200` 带清单、签名与版本下限；没有任何版本提供给该成员时 `404`；本 Runner 没有凭据时 `401`；部署不可达时 `503`；应答者不是 Control Plane 时 `502`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

该路由按请求读取 Runner 的访问令牌而不缓存，因此被吊销的设备在下一次检查时就不再被提供版本。对 Control Plane 的调用携带该部署固定的证书颁发机构，与其它每个 Runner 调用一样，因为 Node 会忽略操作系统的信任库。

每种失败保留各自的状态码：不可达、不可读与未认证对外壳意味着不同的事情，外壳会把原因报告给成员，而这三种情况下已安装的构建都继续运行。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-team-release-http](../team-release-http/README.zh.md)——本路由所询问的 Control Plane 路由。
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.zh.md)——询问本路由、并进行校验、下载与安装的外壳。
- [dsh-team-account-client](../team-account-client/README.zh.md)——本路由所携带的设备凭据。
- [Team 包地图](../README.zh.md)——相邻的 Team 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该路由不注册任何模型输入。

#### KV Cache 影响

此处没有任何内容进入模型请求，因此没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

- **只在回环上，且在那里不鉴权** ——任何能访问到 Runner 端口的东西都可以读取该路由。它返回的是一份公开的签名文档，而该路由既不安装也不下载任何东西。
- **不做缓存** ——每次检查都会重新询问 Control Plane，这正是被吊销的设备能立即生效的原因，也是每次检查一个请求的代价所在。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。凭据、判定与版本各自由另一个包拥有并断言；本路由只是在其中两者之间传递一份答复。
