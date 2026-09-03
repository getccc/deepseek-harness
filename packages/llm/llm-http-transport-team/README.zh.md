---
description: "团队 Transport：一次公司模型请求经由 Control Plane 出去，自身既没有地址也没有凭据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-http-transport-team

[English](README.md) | 中文

## 概述

`dsh-llm-http-transport-team` 是公司模型目录与模型请求从成员电脑到达 Control Plane 的方式。发现操作只返回当前设备主体可以看见的模型。调用操作发送一个操作、一个模型引用，以及适配器构造的请求体。两个请求都不携带上游地址或凭据，因此公司密钥留在与 Runner 进程共享的插件无法触及的地方。

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
  '@deepseek-ai/dsh-llm-http-transport-team':
    controlPlaneUrl: https://dsh.company.com
    controlPlaneCa: /opt/company/control-plane-ca.crt
```

`controlPlaneCa` 指向一个 PEM 文件，供证书未经公共机构签发的 Control Plane 部署使用。文件中的证书**仅**对 Control Plane 连接取代公共信任机构，因此它固定的是这个部署自己的证书，而不是往这台 Runner 到处生效的信任里再添一个机构。不填时，Control Plane 与其他主机一样按默认信任校验。文件读不出来会在加载期抛错——若悄悄退回公共信任，一个配置错误的部署要到很久以后才会以一次普通的 TLS 失败暴露出来。

它注入 `teamAccountClient`，因此这台电脑必须先完成绑定，公司模型调用才能离开它。从未绑定电脑发起的调用以 `not-bound` 失败，而这与 `refused` 对成员是两件不同的事：一个是"连接这台电脑"，另一个是"去问管理员"。

`listModels()` 使用当前设备访问 token 读取 `/team/model/catalog`。Control Plane 会先在每个活跃模型资源上评估 `model.discover`，再返回稳定模型引用与显示名。DeepSeek 适配器在独立的 `built-in` 提供方路由上公开这些条目，让成员配置的 `deepseek-official` 路由继续直连。`send()` 使用同一份当前 token 调用 `/team/model/invoke`，网关会在那里独立评估 `model.invoke`、预留配额、解析上游端点与凭据，并把提供方响应流式传回。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### Access Token 按调用读取

Account Client 会刷新它，因此这里缓存一份就会是陈旧的那份。这也正是凭据本身根本不来这台电脑的同一个理由。

### 预算周期是 UTC 月

不同时区的两位成员花的是同一个组织的同一个月。用月而不是可配置窗口，是因为账本只需要两侧以相同方式命名周期。

### 答案被流式转发，而不是缓冲

Adapter 边到达边解析一份 completion，而在这里留住它会把那件事抵消掉。Provider 的拒绝连同其状态一并透传而不被翻译：构造了该请求的 Adapter 才是能读懂那个答案的一方。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 目录发现、调用传输、token 读取与周期 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`llm-http-transport`](../llm-http-transport/README.zh.md) —— 本包所实现的接缝。
- [`model-gateway-http`](../model-gateway-http/README.zh.md) —— 它所调用的端点。
- [`team-account-client`](../../team/team-account-client/README.zh.md) —— Access Token 的来源。

<a id="model-experience"></a>
## 模型体验

无，因为 Transport 承载的是 Adapter 构造的请求，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

Transport 不改变 Adapter 构造的字节，因此它自身没有请求前缀。Control Plane 在调用上行之前覆盖 model 字段，缓存影响来自那里。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **周期不可配置** —— 以 UTC 月之外的口径计费的部署，需要改的是两侧，而不只是这一侧。
- **不重试** —— `TransportFailedError` 被报告而不是被重试，因为是否重试取决于 Agent 步骤，那由 `llm-retry` 拥有。
- **不支持流式请求体** —— 请求体在调用前被完整序列化，而这正是本构建所承载的每一种 Provider 格式所预期的。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试通过读取被记录下来的请求来断言"什么离开了 Runner"，包括线上不含 `http`、不含 endpoint、不含 key。那条断言正是本包存在的全部理由，而面对一个从未见过真实请求的 mock，它会空洞地通过。

</details>
