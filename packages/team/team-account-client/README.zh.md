---
description: "Runner 的团队账户：它保管的设备密钥、它持有的凭据，以及它对 Control Plane 发起的调用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-account-client

[English](README.md) | 中文

## 概述

`dsh-team-account-client` 是成员电脑上持有的那一份团队账户。它在首次使用时生成设备密钥对并把私钥留在这里，通过 Control Plane 认证本地账户表单，并保存 Control Plane 返回的设备凭据与公开成员身份。公司 Provider 凭据从不到达这台电脑——这里只有属于自己设备的 Refresh Token、短期 Access Token，以及成员登录名与显示名。

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
  '@deepseek-ai/dsh-team-account-client':
    controlPlaneUrl: https://dsh.company.com
    controlPlaneCa: /opt/company/control-plane-ca.crt
    callbackUri: http://127.0.0.1:3080/team/callback
    runnerVersion: 2.4.1
    refreshLeadMs: 60000
```

`controlPlaneCa` 指向一个 PEM 文件，供证书未经公共机构签发的 Control Plane 部署使用。文件中的证书**仅**对 Control Plane 连接取代公共信任机构，因此它固定的是这个部署自己的证书，而不是往这台 Runner 到处生效的信任里再添一个机构。不填时，Control Plane 与其他主机一样按默认信任校验。文件读不出来会在加载期抛错——若悄悄退回公共信任，一个配置错误的部署要到很久以后才会以一次普通的 TLS 失败暴露出来。

默认 Team 流程调用 `signIn(loginName, secret)`：它开启设备 Transaction，经 Control Plane 认证，用 PKCE 与设备签名兑换一次性 Code，再把结果与返回的成员身份一起存储。`begin()` 与 `complete()` 继续供可选浏览器 Handoff 组合使用。`accessToken()` 提供已存 Token，并在它临近过期到会输掉自身竞态时先行刷新，同时保留成员字段；相互重叠的调用共享同一次读取与刷新，因为 Control Plane 在 Refresh Token 第一次出示时就将其用掉，第二次出示则吊销整个 Family。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### PKCE Verifier 只活在本进程中

它不被写到任何地方。因此一个 Transaction 无法由"能读这台电脑磁盘但不是这个 Runner"的东西完成，而在绑定中途重启的 Runner 会重新开始流程，而不是假装它能完成一个它无法证明自己开启过的流程。

### 两份记录都经过 Credential Provider

设备密钥与凭据以 Credential 记录的形式存放，而不是由本包自行写一个文件，因此部署给予 Credential 的任何保护同样覆盖它们，人也只有一处可供查看和清除。凭据记录包含本地登录返回的公开 `loginName` 与 `displayName`；本地账户端点可以展示它们而不暴露 Token 字段。两次写入都走 Provider 的读-决定-替换，因此两个 Runner 在首次启动时竞争的结果是一把钥匙，而不是两个身份。

### 退出保留这台电脑

它忘掉凭据，保留设备密钥、工作空间和 Session。这台电脑还是同一台电脑；它只是不再持有一个团队账户，而再次绑定会复用它的钥匙。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务本体：begin、complete、state、accessToken、signOut |
| [`src/storage.ts`](src/storage.ts) | 设备密钥与凭据存放在哪里 |
| [`src/types.ts`](src/types.ts) | Runner 所保管的内容，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [团队 Handoff 子系统](../../../docs/subsystems/team-handoff.zh.md)——两侧的完整流程。
- [`team-local-login`](../team-local-login/README.zh.md)——驱动这个客户端的默认本地账户表单。
- [`device-authorization`](../../account/device-authorization/README.zh.md)——Control Plane 用它收到的东西做什么。

<a id="model-experience"></a>
## 模型体验

无，因为账户保管是 Runner 侧基础设施，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **每个进程同时只有一次进行中的绑定** —— 待确认 Transaction 的 Verifier 是单个值，因此打开第二个配对页会放弃第一个。
- **没有 Policy 控制通道** —— 这个客户端获取凭据；"被告知某台设备已被撤销"而不是"在下次刷新时才发现"，随控制通道一起到来。
- **本进程中的插件可以读到设备密钥** —— 短有效期与撤销缩小窗口，但不隔离它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试是对着一个真实的 Control Plane 组合而不是一个桩来跑的。这个客户端发起的调用只有在另一侧接受时才是正确的，它产生的签名也只有在它自己生成的钥匙能对上 Control Plane 所存摘要时才是正确的。

</details>
