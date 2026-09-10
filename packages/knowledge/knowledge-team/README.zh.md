---
description: "Runner 侧私有知识提供方：携带当前设备 Token 向 Control Plane 发出的出站请求，不持有任何知识地址或凭据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-team

[English](README.md) | 中文

## 概述

`dsh-knowledge-team` 通过访问公司 Control Plane，在 Team Runner 上提供 `ctx.knowledge`。它发送的是一个查询和本会话范围解析出的引用；它不发送——也不可能发送，因为协议没有位置——知识地址、凭据、租户或上游 id。谁可以读什么，由另一侧在每次调用时判定。在 `team` profile 中，与它读取 Token 的账户客户端并排挂载。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 `dsh-team-account-client` 之后挂载——设备凭据由它拥有，本提供方读取它。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-knowledge-team'
  config:
    controlPlaneUrl: https://dsh.company.com
    controlPlaneCa: /opt/company/control-plane-ca.crt
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `controlPlaneUrl` | — | 公司 Control Plane 的来源 |
| `controlPlaneCa` | — | PEM 文件，其中的证书是它唯一被接受的证书 |

`controlPlaneCa` 指向一个 PEM 文件，供证书未经公共机构签发的 Control Plane 部署使用。文件中的证书**仅**对 Control Plane 连接取代公共信任机构，因此它固定的是这个部署自己的证书，而不是往这台 Runner 到处生效的信任里再添一个机构。不填时，Control Plane 与其他主机一样按默认信任校验。文件读不出来会在加载期抛错——若悄悄退回公共信任，一个配置错误的部署要到很久以后才会以一次普通的 TLS 失败暴露出来。

`controlPlaneUrl` 没有默认值，缺少它该配置项就无法加载。猜测自己属于哪家公司的 Runner，会去问一个陌生人它的成员可以读什么。桌面安装器生成的 profile 补丁从同一个部署事实出发，把它写进这里以及其他每一个需要它的配置项。

### Token 逐次读取

账户客户端会刷新设备 Access Token，因此缓存下来的那个会是陈旧副本。这也是这里根本不放任何知识凭据的原因：本进程持有的唯一东西，是一份短期的、关于谁已登录的证明。

### 失败

每个失败都是 `KnowledgeError`。Control Plane 指名的拒绝原样传递，因此当事实确实如此时，成员看到的是「去找管理员」而不是「稍后再试」。其余一切——DNS、TLS、吃掉请求的代理、宕机的 Control Plane、本构建读不懂的应答——都变成 `control-plane-unreachable`，因为从成员的位置看这些是同一个事实，而且没有一个是可以分别采取行动的。

本构建不认识的理由词被当作不可达处理，而不是原样传递。说着本 Runner 无法据以行动的理由的 Control Plane，就是它无法据以行动的；编造一个含义只会让成员去追错误的修复方向。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

应答的每个字段都在 wire 处校验之后才成为知识值。Control Plane 被信任来做判定，而不是被信任为格式良好：被截断的响应、反向代理错误页，以及更新版 Control Plane 更丰富的应答都会到达这段代码，而只有最后一种应当仍然可用。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方：两个调用、wire 校验和失败映射 |

<a id="further-exploration"></a>
## 延伸阅读

- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 本提供方所说的词汇。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 凭据为何绝不到达 Runner。

<a id="model-experience"></a>
## 模型体验

间接影响，通过 `dsh-tool-knowledge`：它向模型渲染段落并拥有范围提示词章节。本提供方不贡献提示词，也不注册 schema。

#### KV Cache 影响

无直接失效；范围选择造成的请求前缀变化由具名消费方拥有。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本提供方自身在何处不完整。它们是当前的包约束。

- **没有离线缓存** —— 到不了 Control Plane 的 Runner 完全没有知识，这是有意的：缓存的私有段落是一份未经当前授权判定就交付出去的内容。
- **没有自己的截止时间** —— 调用方的信号会被转发，操作的上界由 Control Plane 拥有。若 Control Plane 接受连接却永不应答，Runner 等待的是调用方自己的超时。
- **不重试** —— 每次调用只尝试一次。一次瞬时失败是否值得重试，属于知道成员在等什么的那个调用方。
- **没有文档阅读** —— 接缝还没有这个操作，因此这里也没有。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>

**运行时不变量：**不发布伴随文件：该 provider 在调用之间不持有任何状态，也不发布事件流；本进程中不存在可泄漏的知识凭据或地址是一种“缺席”，本包测试通过检查实际发出的请求来断言它。
