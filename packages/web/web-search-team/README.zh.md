---
description: "Team Runner 的网页搜索提供方：一次携带当前设备令牌与查询的出站控制面请求，自身没有搜索凭据或地址。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-team

[English](README.md) | 中文

## 概述

`dsh-web-search-team` 在 Team Runner 的 `ctx.web` 上注册 `team` 搜索提供方。它发送的是工具要求的查询与来源上限，连同当前设备访问令牌；它不发送的——因为协议没有位置——是搜索凭据、提供方名称或地址。控制面决定该成员是否可以搜索，用公司的凭据执行搜索，并以 web 服务的结果作答。把它挂在 `team` profile 中、它读取令牌的账户客户端旁，并以 `searchProvider: team` 选中它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂在拥有本提供方所读设备凭据的 `dsh-team-account-client` 之后，并在 web 服务上固定选中它。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: team
    fetchProvider: http
- name: '@deepseek-ai/dsh-web-search-team'
  config:
    controlPlaneUrl: https://dsh.company.com
    controlPlaneCa: /opt/company/control-plane-ca.crt
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `controlPlaneUrl` | — | 公司控制面的 origin |
| `controlPlaneCa` | — | 持有唯一可接受证书的 PEM 文件 |

`controlPlaneCa` 指名一个 PEM 文件，是 Runner 抵达证书未经公共机构签发的控制面的方式。其证书仅在控制面连接上替代公共机构。缺省时控制面按普通主机校验。`controlPlaneUrl` 没有默认值，缺少它该行加载失败；桌面安装器生成的 profile patch 会从同一个部署事实把它写到这里。

### 令牌按调用读取

账户客户端会刷新设备访问令牌，缓存的副本必然是过期的那份。这也是为什么没有任何搜索凭据来到这里：本进程持有的唯一东西是"谁已登录"的短期证明。提供方始终报告自己可用；该成员能否搜索是控制面的决定，每次调用都重新做出。

### 失败

每个失败都是 `WebError`，由 `web_search` 工具转为模型可读的结构化错误。控制面指名的拒绝映射为告诉成员该做什么的代码：未绑定或已登出的电脑与 `unauthenticated` 为 `WEB_PROVIDER_CREDENTIAL_MISSING`，`not-allowed` 为说明管理员未允许联网搜索的 `WEB_PROVIDER_ERROR`，`upstream-unavailable` 为 `WEB_PROVIDER_UNAVAILABLE`，`upstream-invalid` 与 `update-required` 为 `WEB_PROVIDER_ERROR`，`cancelled` 为 `WEB_ABORTED`。无法抵达的控制面、反向代理错误页、非对象的答复以及本构建不认识的拒绝词都是 `WEB_PROVIDER_UNAVAILABLE`，因为从成员的座位看它们是同一个事实。缺少字段的成功答复为 `WEB_PROVIDER_ERROR`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

答复的每个字段都在线上校验后才成为搜索结果：没有字符串 URL 的来源使调用失败，而类型错误的可选标题、摘要或日期被丢弃。控制面被信任去做决定，而不是被信任格式良好。路径、头、协议版本与拒绝集合从 `dsh-web-search-gateway-http` 导入，因此两侧共享同一套词汇。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方：调用、线上校验与失败映射 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-web-search-gateway-http](../web-search-gateway-http/README.zh.md)——本提供方调用的路由及其做出的决策。
- [Web 子系统](../../../docs/subsystems/web.zh.md)——本提供方使用的词汇。
- [dsh-knowledge-team](../../knowledge/knowledge-team/README.zh.md)——私有知识的同形提供方。
- [Team 网页搜索 Agent Note](../../../.agents/notes/implemented/feature/2026-09-15-team-web-search-through-the-control-plane.zh.md)——凭据为何绝不到达 Runner。

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-web`：它拥有 `web_search` schema、指引与来源渲染。本提供方不贡献提示词，也不注册 schema。

#### KV Cache 影响

自身没有；工具的请求前缀影响归所命名的消费方所有。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了本提供方单独存在时的不完整之处。它们是当前包约束。

- **没有离线搜索**——抵达不了控制面的 Runner 没有网页搜索，这是有意的：凭据在那里。
- **不重试**——每次调用一次尝试；瞬时失败是否值得重试归知道成员在等什么的调用方。
- **不抓取**——页面抓取经 `dsh-web-fetch-http` 留在 Runner 上；只有搜索经过控制面。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 未发布伴随件：提供方在调用之间不持有任何东西，也不发布事件流；本进程中不存在可泄漏的搜索凭据或地址是一种缺失，包的测试通过检查它实际发送的请求来断言。
