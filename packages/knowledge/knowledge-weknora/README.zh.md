---
description: "WeKnora 知识源提供方：Control Plane 调用的两个固定端点、逐操作凭据解析、结果上界，以及封闭失败映射。"
kind: "package-reference"
---

# @deepseek-ai/dsh-knowledge-weknora

[English](README.md) | 中文

## 概述

`dsh-knowledge-weknora` 在一个 WeKnora 部署之上提供 `ctx.knowledgeSource`。它是 Control Plane 中唯一持有知识凭据并讲知识产品协议的地方：调用两个固定端点，按操作解析 API 密钥，限定返回内容的规模，并把每个失败映射到封闭的原因。它对提问者一无所知；前面受治理的 gateway 已经做出了决定。只在 Control Plane 中挂载它。它的契约钉在一个真实部署自己的 OpenAPI 文档与响应上，而不是上游的 Markdown——后者描述了部署并不提供的端点。

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

在 `team-control-plane` 组合中，与消费它的受治理知识网关并排挂载。

### 何时选用

当部署的私有知识存放在 WeKnora 时选用。使用其他知识产品的部署针对同一接缝再写一个提供方；本包之上的任何东西都不需要改。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-knowledge-weknora'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8080
    credentialRef: WEKNORA_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sourceCode` | — | 本部署对该数据源的代码，`KnowledgeRef` 的第二个分段 |
| `baseUrl` | — | WeKnora API 所在的来源 |
| `credentialRef` | — | 解析为 WeKnora **空间** Key 的凭据引用 |
| `requestTimeoutMs` | `30000` | 一次上游调用可用的时长 |
| `maxSearchResults` | `20` | 一次检索最多返回的段落数 |
| `maxPassageChars` | `4000` | 一个段落最多携带的字符数 |

`sourceCode`、`credentialRef` 和 `baseUrl` 在插件加载时校验。数据源代码被限制为审计 token 字符集下的 19 个字符，因为它是 `KnowledgeRef` 中由部署选择的部分，而整个引用必须放得进审计存储会记录的内容。

### 使用空间 Key，不要用平台 Key

WeKnora 以 `X-API-Key` 认证。**空间** Key 固定访问其所属空间；**平台** Key 能访问任意空间，并通过 `X-Tenant-ID` 请求头指定是哪一个。持有平台 Key 的 Control Plane 可以读到它所治理空间之外的知识，因此部署配置的是空间 Key——这也是本提供方没有租户字段的原因：使用空间 Key 时无需指名任何租户。

### 上界与成本

`maxSearchResults` 被应用两次：作为上游的 `match_count`，以及在解码结果之后再应用一次。第二次不是多此一举。在 WeKnora 的上下文增强开启时——本提供方保持它开启，因为周边上下文正是本阶段所没有的文档阅读的部分替代——`match_count` 不是硬上限：端点返回最佳命中及其父级、邻近和关联分片，因此请求十条会返回十一条。

`match_count` 同时是跨所检索知识库的全局预算而非逐库预算，因此一个知识库可能占满整个结果集，把其余的挤出去。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

任何未经决定放进去的上游内容都不被转发。提供方读取 `content`、`score`、`knowledge_title` 和 `knowledge_base_id`，丢弃 WeKnora 返回的其余全部字段。某个字段仅仅因为出现在响应里就到达模型或审计行——这正是本形状要防止的失效模式。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/wire.ts`](src/wire.ts) | 端点、信封、错误码和两个信封读取器 |
| [`src/index.ts`](src/index.ts) | 提供方：配置校验、两个操作、上界和失败映射 |

### 两个端点

`GET /api/v1/knowledge-bases` 列出该空间的知识库。`POST /api/v1/knowledge-bases/{id}/hybrid-search` 检索段落；其请求体的 `knowledge_base_ids` 覆盖范围，但路径仍要求一个 id，且该 id 必须是列表的成员——列表之外的路径 id 会以 `ErrNotFound` 被拒。因此提供方把一个已授权 id 放在路径上、把完整已授权集合放在请求体里，使路径永远无法扩大范围。

### 不可能返回可加载 URL

`hybrid-search` 不接受 `resource_urls` 参数。该开关只存在于 WeKnora 的聊天与会话端点，在那里 `public` 会把 `resource://` 引用改写为可加载链接，而这些端点都不在本路径上。因此不变量 10 依托的是检索端点根本无法产生可加载上游 URL，而不是本提供方请求它不要产生。一条约定测试断言任何被转发字段都不携带 `http` 或 `https` URL，因为后续 WeKnora 版本可能加入该参数或改变其默认值。

段落中确实带有 `resource://` 引用，而本阶段没有任何东西能兑换它们，因此提供方把它们替换为中性占位符，而不是向模型展示一个它用不了的协议，并丢弃 `chunk_type` 不为 `text` 的分片。

### 失败

两种信封都会被解码：成功为 `{ data, success: true }`，失败为 `{ error: { code, message, details }, success: false }`——后者把 `AppError` 嵌套起来，而不是像 OpenAPI 文档声明的那样平铺返回。只读取 `code`。`message` 和 `details` 是可能指名内部地址的上游散文，它们绝不离开本包。

可用性与可读性是调用方唯一能据以行动的两个区分：对于正在等待的成员，配置错误的 Key、被撤销的 Key 和限流都是「这个数据源现在没有回应我们」。

<a id="further-exploration"></a>
## 延伸阅读

- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 本提供方供给的受治理词汇。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 凭据和上游地址为何留在这里。

<a id="model-experience"></a>
## 模型体验

无，因为提供方运行在 Control Plane，而 Control Plane 不挂载 agent 也不挂载工具注册表，模型永远到不了它。

#### KV Cache 影响

这里不会改变任何请求前缀。检索到的段落只有在网关授权、且 Runner 侧工具渲染之后才成为模型可见内容，前缀开销落在那里。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本提供方自身在何处不完整。它们是当前的包约束。

- **多库检索需要同一个 embedding 模型** —— WeKnora 的 `knowledge_base_ids` 只在各知识库共享同一 embedding 模型时跨越多个库，而 API 没有为不满足该条件的集合声明任何错误。提供方上报 `embeddingModelId`，使网关能在调用之前拒绝混合集合；它不按模型扇出再合并，因为不同调用的分数各自在自己的 rerank 内归一化，不可比较。
- **未知知识库 id 在上游被静默忽略** —— 一个真实 id 与一个未知 id 混在一起的列表会以 `success` 返回，且结果只来自那个真实知识库。提供方会丢弃请求未指名的知识库的命中，但存在性与授权必须在调用之前定下来，而不是之后。
- **没有文档阅读** —— `list` 与 `search` 就是全部接口面。WeKnora 的分片端点不会被调用。
- **不带分片计数** —— 列表接口的 `chunk_count` 在检索明明能返回分片的知识库上读作零，因此本提供方不再读取它，下游也不再携带该计数。`knowledge_count` 与 `processing_count` 按列表给出的值原样采用。
- **没有增量列表** —— `list()` 取回全部内容；WeKnora 在该端点上不提供分页或变更游标。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文为准。

#### 已发布的 API 文档与部署不一致

WeKnora 仓库的 markdown 描述了一个接受 `knowledge_base_ids` 的顶层 `POST /knowledge-search`，而部署并不提供它；其搜索结果少列了部署实际返回的字段；它还把 `AppError` 呈现为平铺结构，而不是嵌套在 `error` 之下。这里的 fixture 依据部署自身的 OpenAPI 文档与响应固定。升级负责人重读该文档，而不是散文。

</details>

**运行时不变量：**不发布伴随文件：该 provider 在调用之间不持有可变状态，也不发布事件流；返回的每个段落都来自请求指定的知识库，这一点在 `search` 内强制执行，并由本包的契约测试断言。
