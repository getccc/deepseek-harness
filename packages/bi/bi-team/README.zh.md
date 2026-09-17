---
description: "Runner 侧的 BI 分析提供方：一次携带当前设备令牌、不带任何 BI 地址或凭据的出站 Control Plane 请求。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-team

[English](README.md) | 中文

## 概述

`dsh-bi-team` 通过触达公司 Control Plane，在 Team Runner 上提供 `ctx.bi`。它发出的只有受治理的引用、关键词或行数上限，再无其他；它不发送——也不可能发送，因为协议没有为其留位置——BI 地址、凭据、上游项目或图表 id、过滤条件或自己的查询。谁可以执行什么，由另一侧在每次调用时判定。请在 `team` profile 中把它挂载在它所读取令牌的账户客户端旁边。

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

把它挂载在 `dsh-team-account-client` 之后，后者拥有本提供方读取的设备凭据。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-bi-team'
  config:
    controlPlaneUrl: https://dsh.company.com
    controlPlaneCa: /opt/company/control-plane-ca.crt
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `controlPlaneUrl` | — | 公司 Control Plane 的 origin |
| `controlPlaneCa` | — | 一个 PEM 文件，其中的证书是唯一被接受的证书 |

`controlPlaneCa` 指向一个 PEM 文件，是 Runner 触达证书未经公共机构签发的 Control Plane 的方式。其中的证书只在 Control Plane 连接上替换公共机构，因此部署自己的证书是被钉住的，而不是被加入到这台 Runner 处处信任的集合。缺省时，Control Plane 像任何其他主机一样被校验。无法读取的文件会在加载时抛错，因为一台悄悄退回公共信任的 Runner 会把配置错误的部署在很久之后报告成一次普通的 TLS 失败。

`controlPlaneUrl` 没有默认值，缺少它则该行无法加载。一台猜测自己属于哪家公司的 Runner，会去问一个陌生人它的成员可以执行哪些图表。桌面安装器生成的 profile 补丁会从同一个部署事实把它写进这里以及每一个需要它的行。

### 令牌按调用读取

账户客户端会刷新设备访问令牌，因此缓存的令牌会是过期副本。这也正是没有任何 BI 凭据来到这里的原因：本进程持有的唯一东西是一个短期的登录身份证明。

### 失败

每个失败都是 `BiError`。Control Plane 指名的拒绝会原样透传，因此当事实如此时，成员看到的是“找管理员”而不是“稍后再试”。其余一切——DNS、TLS、吞掉请求的代理、宕机的 Control Plane、本构建无法读取的应答——都变成 `control-plane-unreachable`，因为从成员的座位看，这些是同一个事实，且没有哪一个可以单独处置。

本构建不认识的原因词被视为不可达，而不是继续传递。一个说着本 Runner 无法据以行动的原因的 Control Plane，就是一个它无法据以行动的 Control Plane；编造一个含义会把成员引向错误的修复。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

应答的每个字段在成为 BI 值之前都在线路上校验。Control Plane 被信任来做判定，而不是被信任格式良好：被截断的响应、反向代理的错误页和更新的 Control Plane 更丰富的应答都会到达这段代码，只有最后一种应当仍然可用。本构建不认识的图表类型读作 `other`，无法读取的总数读作未知而绝不是零，因为类型只是提示，而总数是关于列表止于何处的承诺。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | 提供方：三个调用、线路校验与失败映射 |

<a id="further-exploration"></a>
## 延伸阅读

- [BI 子系统](../../../docs/subsystems/bi.zh.md)——本提供方所说的词汇。
- [Team BI 分析 Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)——为何凭据永远不会到达 Runner。

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-bi`——它把图表列表与行渲染给模型，并拥有范围提示词段。本提供方不贡献提示词，也不注册 schema。

#### KV Cache 影响

无直接失效；所述消费方拥有项目选择引起的请求前缀变化。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本提供方单独使用时何时不完整。它们是当前的包约束。

- **无离线缓存**——无法触达 Control Plane 的 Runner 完全没有 BI，这是有意为之：缓存的行集合会是一份未经当前授权判定就提供的数据。
- **没有自己的截止时间**——调用方的信号被转发，Control Plane 拥有操作的上限。Control Plane 接受连接却从不应答时，Runner 等待的是调用方自己的超时。
- **不重试**——每次调用一次尝试。瞬时失败是否值得重试，属于知道成员在等什么的调用方。
- **无免密钥快照通道**——Team profile 没有录制会话快照层，因此本提供方的证据是其记录请求的单元测试，而不是一段回放的 Session。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与未定方向。它明确不具权威性——已交付的行为、限制与理由在上面的章节中。

#### 调用形态与知识提供方共享

构造函数、按调用读取令牌，以及请求并解码的那一段，与 `dsh-knowledge-team` 携带的是同一套机制，只是在这里针对三条 BI 路由而不是知识路由书写。克隆检测器会报告这些共享片段。抽取一个由两个提供方参数化的 Control Plane 调用辅助函数是后续工作；它会触及知识提供方及其测试，这正是它没有随添加本包的变更一起进行的原因。

</details>

**运行时不变量：** 不发布伴随包：提供方在调用之间不持有状态，也不发布事件流；本进程中不存在可泄露的 BI 凭据或地址是一种“不存在”，包的测试通过检查它实际发出的请求来断言这一点。
