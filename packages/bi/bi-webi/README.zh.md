---
description: "webi BI 数据源提供方：Control Plane 调用的四条固定路由、按操作解析 API key、行与单元格上界、异步执行，以及封闭的失败映射。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-webi

[English](README.md) | 中文

## 概述

`dsh-bi-webi` 在一个 webi 部署（源自 Lightdash 的 BI 服务器）之上提供 `ctx.biSource`。它是 Control Plane 中唯一持有 BI 凭据并说 BI 产品协议的地方：调用四条固定路由，按操作解析个人访问令牌，按保存时的样子执行已保存图表，限定返回内容，并把每个失败映射到封闭原因。它不知道谁在问；位于其前的受治理网关已经决定了这一点。只在 Control Plane 挂载它。

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

在 `team-control-plane` 组合中，把它挂载在消费它的受治理 BI 网关旁边。

### 何时选用

部署的 BI 系统是 webi 时选用它。使用其他 BI 产品的部署针对同一接缝编写另一个提供方；本包之上的一切都不变。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-bi-webi'
  config:
    sourceCode: prod
    baseUrl: http://127.0.0.1:8100
    credentialRef: WEBI_API_KEY
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `sourceCode` | — | 本部署对该数据源的代码，`BiProjectRef` 的第二段 |
| `baseUrl` | — | webi API 所在的源 |
| `credentialRef` | — | 解析为 webi 个人访问令牌的凭据引用 |
| `requestTimeoutMs` | `30000` | 一次上游 HTTP 调用最多可用的时间 |
| `maxRows` | `500` | 一次执行最多返回的行数 |
| `maxCellChars` | `200` | 一个文本单元格最多携带的字符数 |
| `maxCharts` | `500` | 一次项目列表最多读取的图表数 |
| `pollIntervalMs` | `500` | 两次读取未就绪执行之间的等待时间 |
| `queryTimeoutMs` | `60000` | 一次执行在被放弃并在上游停止之前最多可用的时间 |

`sourceCode`、`credentialRef` 与 `baseUrl` 在插件加载时校验。数据源代码以审计 token 字符集限制在 19 个字符内，因为它是 `BiProjectRef` 中由部署选择的部分，而引用整体必须装进审计存储所记录的内容。

### 使用为本部署创建的管理员令牌

webi 以 `Authorization: ApiKey <token>` 鉴权，这是一个个人访问令牌，能到达的范围就是其主人的范围。DSH 中的项目授权覆盖项目内的每个空间，包括私有空间，而 webi 把私有空间展示给其直接成员和组织管理员——因此令牌属于专为本部署创建的 webi 组织管理员，而不属于任何个人，提供方也不施加任何空间过滤。到达范围小于整个项目的令牌，会让授权悄悄地比管理员所做的更窄。

### 上界与成本

一次执行读取一页 `maxRows` 行，并报告数据源产出了多少行，因此读者知道这一页何时是截断的。文本单元格在 `maxCellChars` 处截断，结果会说明。图表列表读取一页 `maxCharts` 张图表，并说明数据源是否持有更多；成员用来收窄的关键词由网关在该列表上施加。

执行在上游是异步的：提供方启动一次执行，然后每隔 `pollIntervalMs` 读一次状态直到就绪，最多等到 `queryTimeoutMs`。未按时完成的执行，以及调用方不再等待的执行，都会尽力在上游停止，让数据仓库不为无人等待的东西继续工作。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

没有任何决定放进去的上游内容都不会被转发。提供方读取项目的 id、名称、类型和仓库；图表的 id、名称、空间、描述、类型和时间戳；执行的字段、筛选和原始单元格。webi 返回的其他每个字段都被丢弃。一个字段仅因为碰巧在响应里就到达模型或审计行，正是这种形态要防止的失败模式。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/wire.ts`](src/wire.ts) | 路由、信封与信封读取器 |
| [`src/index.ts`](src/index.ts) | 提供方：配置校验、各操作、执行循环、上界与失败映射 |

### 这些路由

`GET /api/v1/org/projects` 列出令牌所属组织持有的项目。`GET /api/v2/content?projectUuids=&contentTypes=chart&page=1&pageSize=` 按最新在前列出一个项目的已保存图表，带现成的 `chartKind` 和一个分页块，其 `totalResults` 说明上界是否截短了列表。`GET /api/v1/saved/{uuid}` 是一张图表自己的记录，也是持有它的项目的唯一来源；其 `chartConfig` 经由 `chartKindOf` 决定类型，后者像列表一样读取笛卡尔图表的系列与布局。

`POST /api/v2/projects/{project}/query/chart` 启动一次执行。其请求体只命名图表，别无其他——本进程自己的筛选、参数、排序或行数限制都到不了数据仓库——并回答执行 id、已保存的查询和字段映射。随后 `GET /api/v2/projects/{project}/query/{query}?page=1&pageSize=` 回答 `pending`、带行的 `ready`、`error` 或 `cancelled`；`POST …/cancel` 停止一次无人等待的执行。

列顺序遵循已保存的查询：维度，然后指标，然后表计算，然后字段映射里剩下的一切；查询与字段映射都无话可说的执行取第一行自己的键。单元格是值的 `raw`，文本则受上界限制；webi 格式化了却未指定类型的值以其 `formatted` 字符串呈现。已保存的筛选被渲染成一行，`field operator values`，组以命名它的词连接，作者关闭的规则被略去。

### 失败

两种信封都被解码：成功时 `{ status: 'ok', results }`，失败时 `{ status: 'error', error: { statusCode, name, message } }`。只读 `statusCode`。`name` 与 `message` 是可能指名内部地址的上游文字，永远不会离开本包。

`401`、`403`、`429` 或 `5xx` 是 `upstream-unavailable`：配置错误的令牌、被吊销的令牌和速率限制，对等待的成员而言都是"这个数据源此刻没有应答我们"。`404` 在图表路由上是 `chart-unavailable`，在其他地方是 `upstream-invalid`。数据仓库失败或数据源取消的执行是 `query-failed`。调用方自己的中止是 `cancelled`，与数据源失败区分开来。

<a id="further-exploration"></a>
## 延伸阅读

- [BI 子系统](../../../docs/subsystems/bi.zh.md)——本提供方所供给的受治理词汇。
- [Team BI 分析 Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)——凭据与上游地址为何留在这里。

<a id="model-experience"></a>
## 模型体验

无，因为提供方运行在 Control Plane，而 Control Plane 不挂载 agent 与工具注册表，模型永远触及不到它。

#### KV Cache 影响

这里没有请求前缀的变化。行数据只有在网关授权、Runner 侧工具渲染之后才对模型可见，其前缀成本落在那里。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了提供方何时单靠自身并不完整。它们是当前的包约束。

- **夹具是一次录制，而非数据源承诺的契约**——单元夹具携带录制时部署所应答的信封与行，真实 e2e（`tests/webi.e2e.ts`，由 `WEBI_BASE_URL` 与 `WEBI_API_KEY` 把门）对着它回放四条路由。webi 升级需要一位指名的负责人运行该 e2e 并重读这些路由。
- **一次执行读一页**——超过 `maxRows` 的行只作为计数报告，从不读取；这里没有任何东西携带偏移量。
- **已保存图表自己的限制仍然运行**——数据仓库按保存时的样子执行图表，无论多少行，本提供方读取结果中有界的一页。保存时没有限制的图表，对数据仓库来说该花多少就花多少。
- **不做仪表盘、参数或即席查询**——执行路由只接受图表 id；仪表盘范围内的执行、参数值和调用方自己的指标查询是本阶段不做的独立授权决定。
- **没有增量列表**——项目与图表在上界之内整体读取，没有变更游标。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放问题与未决方向。它明确不具权威——已发布的行为、限制与理由在上面各节。

#### 列表把一种类型拼作 `watefall`

webi 的 `ChartKind` 枚举把瀑布图类型拼作 `watefall`。提供方把该词读作 `waterfall`，因此读本构建词汇的人不会继承这个拼写错误；纠正它的 webi 版本不会改变这里的任何东西。

</details>

**运行时不变量：** 不发布伴随包：提供方在调用之间不持有可变状态，也不发布事件流；"返回的每一行都来自请求指名的那一张图表"在 `runChart` 内部强制执行，并由本包的契约测试断言。
