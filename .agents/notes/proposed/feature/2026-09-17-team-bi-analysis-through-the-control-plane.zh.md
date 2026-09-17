# Agent Note: 经控制面的 Team BI 分析

Status: proposed

[English](2026-09-17-team-bi-analysis-through-the-control-plane.md) | 中文

## 问题

公司的 BI 系统 webi 以项目为单位保存着已经制作好的图表，它们本就回答着成员最常问的问题：各区域销售额、按月订单量、某个仪表盘为之而建的指标。Team 成员向 DSH 问这类问题，得到的却是通用知识的回答，因为没有任何能力能抵达 webi。webi 自身提供两条入口，REST API 和基于 SSE 的 MCP 服务，两者都用同一个个人访问令牌鉴权，令牌能到达的范围就是令牌主人的范围：把令牌放进 Runner，等于把公司凭据放到成员电脑上，把该令牌可见的每个项目交给使用这台电脑的任何人，且不留任何记录。[私有知识](2026-09-01-team-private-knowledge-control-plane.zh.md)为 WeKnora 恰好解决了这个问题：控制面持有凭据，管理员按资源授权，会话记录成员的选择，模型只在做出选择之后才看到工具。工作 composer 已经在 `feat/composer-placeholder-seats` 分支上放好了一个不可点击的 BI分析 徽章，等待这项能力到来。缺的是那套设计的 BI 对应物：词汇、受治理的项目目录、角色授权、会话范围、工具和控件。

## 提案

把 BI 分析作为内建的 Team 能力交付，形态与私有知识相同。`team-control-plane` profile 挂载持有 API key 的 webi 提供方、受治理的项目目录、面向 Runner 的网关和管理路由；`team` profile 挂载 Runner 侧提供方、两个面向模型的工具及其提示词段落、浏览器 Remote 和 composer 控件。webi 自身不做任何改动：第一阶段需要的每个操作都是已有的、接受 `Authorization: ApiKey` 的路由。

### 产品结果

- 管理员把一个 webi 个人访问令牌写入控制面的凭据库，并在 `bi-webi` 行的 `credentialRef` 里指名它，与 WeKnora 行的做法相同。该令牌属于专为 DSH 创建的 webi 组织管理员，因此能到达每个项目和每个空间，包括私有空间，且不牵涉任何个人的 key。
- 管理员在 **资源管理 → BI 项目** 下看到全部 webi 项目，刷新目录，逐个启用或停用项目。
- 管理员打开某个角色的 **BI 权限** 编辑器，授予全部项目、选定项目或不授予。一个项目授权覆盖该项目内的全部已保存图表，公共空间和私有空间一视同仁。
- 被授权角色的成员打开一个工作对话，在 composer 的 BI 控件里选定一个项目，然后提出普通的问题。agent 列出该项目的已保存图表，挑最接近的一张，执行它，并根据行数据作答：图用部署所装渲染器绘制的 `echarts` 围栏，表格用 Markdown，单个数字用文字。
- 对话以 BI 关闭开始。在成员选定项目之前，模型看不到任何 BI 工具，也没有任何 BI 请求离开这台电脑。
- 撤销角色授权、停用成员、吊销设备、停用项目或项目从 webi 消失，都会改变下一次操作，无需重新登录或新开对话。

### 第一阶段非目标

- 不做仪表盘、仪表盘筛选器或仪表盘范围内的图表执行。
- 不做基于 webi 语义层的即席查询，即它自带 MCP 服务暴露的数据模型、字段和表数据操作，也不做 SQL 运行器。模型按图表保存时的样子执行已保存图表。
- 除行数上限外，不对已保存图表做筛选、参数或排序覆盖；不创建、编辑图表或写入版本；不导出图片。
- 不做按空间授权：按产品决定，项目是授权的单位。
- 不做 `all` 模式，一个对话里也不做多个项目：一个对话分析一个项目。
- 不在控制台页面录入 key，不改动 webi 侧。

## 安全不变量

1. Runner 不存储任何能授权直接上游调用的 webi 地址、API key、项目 id 或图表 id；Runner 请求只携带受治理引用。
2. 每个面向 Runner 的请求都校验当前设备访问令牌，并从已校验的声明而非请求字段中取得 `orgId`、`principalId` 和 `deviceId`。
3. 控制面对每个操作指名的项目评估 `bi.query`，每次调用都评估。未知项目与未授权项目产生相同的拒绝。
4. 图表经由 webi 声明它所属的项目授权，每次调用都在上游解析，因此来自其他项目的图表引用在读取任何行之前就被拒绝。
5. 会话范围只收窄当前授权；它在每次操作时重新评估，且只存活于会话日志。
6. 图表名称、描述、字段标签、行数据和上游错误正文永不进入控制面审计库或普通日志；审计行携带引用、计数和封闭原因。
7. 控制面只调用其配置的 webi 源和下文的固定端点集合。Runner 请求没有网关未定义的 URL、header、body 或操作字段。
8. 每个面向 Runner 的路由都携带 BI `protocolVersion`，在任何其他字段之前评估；不支持的版本回答 `426` 且不执行任何操作。
9. 模型能看到的关于所选项目的一切，都能仅凭会话日志重建。

## 运行时架构

```text
3090 Team Runner                                   3095 Control Plane                      webi

composer BI control                               administration API
        |                                                 |
bi/scope Session event                          governed project catalog
        |                                                 |
prompt section + tool visibility                        RBAC + audit
        |                                                 |
bi_list_charts / bi_query_chart                           |
        |                                                 |
Team BI Provider -- current device token --> BI Gateway -- fixed endpoints + ApiKey --> REST API
```

### 能力与包拓扑

| 包 | 角色与职责 |
|---|---|
| `packages/bi/bi` | 浏览器安全的 Service Definition `ctx.bi`、品牌化的 `BiProjectRef` 与 `BiChartRef`、请求与结果类型、`bi/scope` 会话事件，以及封闭的失败集合 |
| `packages/bi/bi-source` | 仅限控制面的上游 seam `ctx.biSource`：以上游 id 列项目、列某项目的图表、定位图表所属项目、执行图表 |
| `packages/bi/bi-webi` | 面向 webi 固定端点的 Service Provider；按操作解析凭据，并限定行数、单元格和时间 |
| `packages/bi/bi-gateway` | 受治理网关 seam `ctx.biGateway`：持久项目目录，以及已授权目录、图表列表和执行 |
| `packages/bi/bi-gateway-sqlite` | 持久目录、同步、访问控制注册、逐项目授权与审计 |
| `packages/bi/bi-gateway-http` | 面向 Runner 的路由，带令牌校验和 BI 协议版本 |
| `packages/bi/bi-team` | Runner 侧 `ctx.bi` 提供方，把当前设备令牌带到其配置的控制面 |
| `packages/bi/tool-bi` | `bi_list_charts`、`bi_query_chart`、`bi:scope` 提示词段落、随范围而定的可见性，以及工具的呈现 |
| `packages/api/bi-controller` | 仅 Team 的 Remote，向浏览器提供已授权项目并记录对话的选择 |
| `packages/client/ui-bi` | composer 控件：已就位的徽章变成已授权项目的单选 |

用两个 seam 而非一个，理由与知识库把它们分开相同：`ctx.bi` 命名成员想要什么，`ctx.biSource` 命名 webi 能做什么，两者之间的网关是唯一把受治理引用映射到上游 id 并决定是否允许的一方。

### 稳定引用

控制面为每个 webi 项目铸造一个 `BiProjectRef`，并在其下寻址图表：

```text
webi:<sourceCode>:<projectUuid>
webi:<sourceCode>:<projectUuid>/<chartUuid>
```

项目引用是持久目录的键，也是访问控制的 `ManagedResource.externalRef`；授权指名资源的代理 id，因此改名后的项目保留每一条授权。上限沿用知识库的上限，即审计令牌字母表上的 64 个字符和最多 19 个字符的来源代码，因为引用落在同一个 `resource_id` 列。图表引用是单独的品牌，正如文档引用那样，因为图表永远不是审计资源：操作记录的是项目。

## 受治理目录

### SQLite 记录

`bi.sqlite` 保存一条来源记录和每个项目一条记录，按仓库的 SQLite 打开序列使用 strict 表和单调递增的 schema 版本：

| 记录 | 字段 |
|---|---|
| 来源 | 组织 id、来源代码、提供方类型 `webi`、配置的源标识、最近一次成功同步、最近一次尝试，以及健康度 |
| 项目 | `BiProjectRef`、来源代码、上游 id、显示名、项目类型、仓库类型、管理员启用位、远端存在位，以及最近一次发现 |

数据库不存储 API key、图表、行数据或查询文本。图表不入目录：每次授权调用都从 webi 现列，因此目录说明有哪些项目，来源说明此刻项目里有什么。

### 同步

同步在明确的管理请求、控制台页面打开、控制面启动以及配置的周期上运行。一次成功的完整列表应用知识库的规则：新项目注册一个已启用的 `bi_project` 受管资源；已知项目更新名称而不改变其引用、资源或授权；在成功列表中缺失的项目连同其资源和指名它的每条授权一起退役；手动停用永远不被同步覆盖。失败的列表保留上一份快照，并把失败记录在来源上。

## 权限与角色组合

权限目录在新的资源类型上新增三对：

| 权限 | 持有者 |
|---|---|
| `bi_project` / `bi.query` | 成员角色：列出并执行指名项目的已保存图表 |
| `bi_project` / `bi.catalog.read` | 管理员角色：读取项目目录 |
| `bi_project` / `bi.catalog.manage` | 管理员角色：同步目录并启用或停用项目 |

管理 API 把 `urn:dsh:admin:bi-catalog` 注册为 `bi_project` 受管资源，并在这个确切的资源上检查两个目录权限；角色分配仍检查 `role.grant.manage`。因为管理资源与成员资源共享类型，每条面向成员的路径，即 Runner 目录和角色编辑器的可选列表，都枚举持久项目目录并按引用关联到受管资源，永不对该类型调用 `listResources`，这正是知识库目录已经遵循的规则。

角色编辑器提交 `none`、`all` 或 `selected`；保存时撤销该角色既有的 `bi.query` 类型授权和资源授权，写入请求的集合，不触碰任何其他权限。角色取并集，没有拒绝规则。

## Control Plane API

### 管理 API

| 方法与路径 | 权限 | 行为 |
|---|---|---|
| `GET /team/api/bi-projects` | `bi.catalog.read` | 持久目录、生效的启用状态、来源健康度和最近同步状态 |
| `POST /team/api/bi-projects/sync` | `bi.catalog.manage` | 一次串行化的完整同步；并发调用者加入同一次 |
| `PATCH /team/api/bi-projects/:biProjectRef` | `bi.catalog.manage` | 管理员对单个项目的启用 |
| `POST /team/api/roles/:roleId/bi-projects` | `role.grant.manage` | 把角色的 `bi.query` 授权替换为 `none`、`all` 或选定集合 |

这些路由使用知识库路由所用的管理会话、同源与 CSRF 检查、有界 JSON 读取器和带类型的拒绝词。

### Runner API

| 方法与路径 | 操作 | 行为 |
|---|---|---|
| `POST /team/bi/catalog` | 目录 | 校验令牌，对每个已启用目录条目评估 `bi.query`，返回引用和显示名 |
| `POST /team/bi/charts` | 图表列表 | 授权项目，从 webi 列出其已保存图表，按可选关键词过滤，返回一个有界的页 |
| `POST /team/bi/query` | 图表执行 | 在上游解析图表所属项目，授权它，执行已保存图表，返回定义摘要、字段和有界的行 |

Runner 请求不提供组织、主体、设备、源、key、项目 uuid 或图表 uuid；网关在解析器处拒绝多余字段。

## webi 提供方

`bi-webi` 只说已部署 webi（一个源自 Lightdash 的服务）的四条路由，别无其他：

| 操作 | webi 路由 |
|---|---|
| 列项目 | `GET /api/v1/org/projects` |
| 列某项目的已保存图表 | `GET /api/v2/content?projectUuids=&contentTypes=chart&page=&pageSize=` |
| 读图表定义及所属项目 | `GET /api/v1/saved/:chartUuid` |
| 执行已保存图表 | `POST /api/v2/projects/:projectUuid/query/chart`，然后分页轮询 `GET /api/v2/projects/:projectUuid/query/:queryUuid` 直到查询就绪 |

每次调用都携带按操作从 `credentialRef` 解析出的 `Authorization: ApiKey <token>`。令牌属于 webi 组织管理员，这正是提供方能列出私有空间的原因：webi 把私有空间展示给其直接成员和组织管理员，而产品决定是 DSH 的项目授权覆盖整个项目。因此提供方不施加任何空间过滤。

已保存图表按保存时的样子执行：提供方只转发图表 uuid 和行数上限，绝不转发筛选、参数、排序或 SQL。执行在上游是异步的，因此提供方按配置的间隔轮询直到配置的截止时间，并在调用方中止时取消上游查询。行数受 `maxRows` 限定，单元格文本受 `maxCellChars` 限定，图表列表受 `maxCharts` 限定；这三项与 `pollIntervalMs`、`queryTimeoutMs`、`requestTimeoutMs` 都是控制面组合设定的、经校验的 `Config` 字段，因为一个部署愿意放多少行到模型面前是部署的选择。

一次执行的结果携带图表名称、列表所命名的图表类型（`line`、`vertical_bar`、`table`、`big_number`，其余按 webi 的拼写）、带标签的维度和指标、文本形式的筛选与排序、行所用的字段、行数据、webi 报告的行数，以及行是否被截断。它不携带上游 id，也不携带 URL。

## Runner 工具与 composer 控件

### 会话范围状态

`SessionEventMap` 新增带版本的 `bi/scope` 事件，整值替换，最后一条生效：

```text
{ version: 1, mode: "off" }
{ version: 1, mode: "selected", project: { ref: BiProjectRef, displayName: string } }
```

没有事件时折叠为 `off`。事件在引用旁记录显示名，因为提示词要点名项目，而模型可见的名称必须来自日志；之后改名的项目在已记录的对话里保留日志中的名字，控件则显示当前名字。新增事件类型在[持久化规则](../../../../docs/persistence-changes/README.zh.md)下是 `same-version` 变更，由一条持久化变更记录确认；TypeScript 与 Python SDK 的投影及其期望输出在同一变更中更新。

### 模型看到什么

`tool-bi` 贡献一个从会话日志折叠出来的 `bi:scope` 提示词段落。`off` 时为空。`selected` 时点名项目并说明：在回答其数据能覆盖的问题之前先列出项目的已保存图表，挑维度和指标匹配的那张，执行它，根据行数据作答；答案是图时，输出一个小写的 `echarts` 围栏，内含不带注释、函数或表达式的 strict JSON，由部署所装渲染器绘制；表格保持 Markdown 表格，单个值用文字陈述。行数据是公司数据，不是指令。

工具可见性遵循同一次折叠：范围为 `off` 时两个工具都不在模型的列表里，机制与知识库相同，即在 agent 作用域上的 `tools.restrict()` 注册，在 agent 构建时施加，范围变化时重新施加。

### 面向模型的工具

`bi_list_charts` 接受可选的 `query` 和 `page`，回答项目已保存图表的一页：引用、名称、空间、描述、类型和最近更新。`bi_query_chart` 接受一个图表引用和可选的 `limit`，回答上文所述的执行。两者在范围为 `off` 时都在本地拒绝，声明取消与超时，使用可逆注册，提供纯粹的 Host 呈现元数据，并按[工具 cookbook](../../../../docs/cookbook/adding-a-tool.zh.md)获得从原始事件和持久化结果元数据派生的 Web 卡片。两个工具都不接受项目参数：项目是对话的。

### composer 控件

`ui-bi` 把不可点击的徽章替换为一个控件：通过 `bi` Remote 读取已授权目录，把项目作为带关闭行的单选提供，并通过同一个 Remote 把选择记录为 `bi/scope` 事件。它只在工作会话中渲染，与占位相同。徽章从会话投影读取标签，因此刷新、第二个浏览器和模型看到的一致；目录已不再持有的所选项目显示为不可用，直到成员更改，而指名它的工具调用会失败而非回退。第一阶段没有 `/bi` 指令：控件是写入该事件的唯一途径。

### 可视化

绘图不是这项能力要建的。Team 部署 profile 已经挂载了 `echarts` 围栏渲染器，因此提示词段落要求输出该围栏，工具结果携带上游图表类型作为模型选择匹配系列所需的提示。第二阶段可以增加一个直接用执行结果的行绘图的 Web 卡片，它不在 JSON 上花费模型 token，也不会抄错数字；该卡片与围栏并存，而不取代提示词。

### 成本

一次执行的行数据在成员下一次模型请求中变成提示词 token，公司模型网关已经对该请求做配额预留，因此 BI 网关不调用 `quota.reserve`。成本控制是行数和单元格上限；webi 自身的结果缓存服务同一图表的重复执行。

## 审计与运行可见性

每次网关操作写一条审计事件，`bi.catalog`、`bi.charts` 或 `bi.query`，携带项目引用、执行时的图表引用、返回的行数，以及拒绝或上游失败的封闭原因。控制台的 BI 页面显示来源健康度、最近一次成功同步和最近一次失败词；审计日志是谁执行了什么的账本。

## 失败语义

每个失败都是携带封闭集合中一个原因的 `BiError`，因此工具结果、Runner 和 UI 无需解析消息就能区分“重新登录”、“找管理员”和“稍后重试”：

| 原因 | 含义 |
|---|---|
| `unauthenticated` | 没有有效设备令牌、成员未激活或设备已吊销 |
| `not-allowed` | 没有授权允许该操作，或指名的项目未知或已停用 |
| `scope-unavailable` | 对话的项目已不在主体的已授权目录中 |
| `chart-unavailable` | webi 没有这张图表，或它已不属于对话的项目 |
| `query-failed` | webi 执行了图表而数据仓库拒绝或出错 |
| `upstream-unavailable` | webi 未及时应答或完全没有应答，或拒绝了凭据 |
| `upstream-invalid` | webi 应答了此构建无法读取的内容 |
| `control-plane-unreachable` | 从这台电脑无法抵达控制面 |
| `update-required` | 控制面拒绝该操作的协议版本 |
| `cancelled` | 调用方中止了操作 |

被拒绝的凭据在成员的座位上读作 `upstream-unavailable`，在来源上读作 `failing` 健康度，因为修复是管理员的事，不是成员的。任何上游响应正文都不会进入这些原因。

## 管理 UI

随附的控制台导航在资源管理下新增 **BI 项目**，类型为 `menu`，打开 `resources/BiProjectsPage`，由 `bi_project|bi.catalog.read` 把守。页面列出每个项目的名称、引用、项目与仓库类型和启用状态，带有知识库页面同样的同步按钮和启用或停用操作。角色编辑器新增 **BI 权限** 对话框，沿用知识库对话框的树：一个整目录行勾选全部项目，存储为 `all`。

## 交付计划

五个相互依赖的 PR，各自通过自己的聚焦检查，经仓库的 stacked-PR 工作流自底向上落地：

1. **领域、权限与会话词汇。** 带双语 README 和 `docs/subsystems/bi.md` 的 `packages/bi` 组；`bi` Service Definition、引用、类型与失败；三条权限；`bi/scope` 事件及其持久化变更记录、折叠测试和两个 SDK 的投影。
2. **提供方与受治理目录。** `bi-source`、按已部署 webi 自身响应录制契约夹具的 `bi-webi`、`bi-gateway`，以及带 schema、同步对账、覆盖 none、all、selected 与多角色并集的授权测试、管理资源永不作为项目出现、任何名称或行都无法满足的审计条目的 `bi-gateway-sqlite`。
3. **控制面 HTTP 与管理。** 协议优先拒绝的 `bi-gateway-http`；管理路由；控制台页面、角色对话框、菜单条目及其本地化文案；`team-control-plane` 的行，且每条无本地执行的组合断言仍然通过。
4. **Runner 提供方、工具与提示词。** `bi-team`；带提示词段落、可见性、呈现和 Web 卡片的 `tool-bi`；用桩提供方的免密钥录制会话快照，覆盖 `off` 不可见、一次列表、一次执行、截断、拒绝，以及范围事件的 fork 与 rewind；`team` 的行和桌面 profile 补丁。
5. **浏览器 Remote 与控件。** `api/bi-controller`、在已就位徽章上的 `ui-bi` 单选、组件测试、组装后的浏览器 e2e，以及从该 PR 真实服务与模型流程录制的 GIF。

控件所替换的占位位于 `feat/composer-placeholder-seats` 分支，该分支先落地，或作为第五个 PR 的基底。

## 考虑过的替代方案

**把 Runner 接到 webi 自带的 MCP 服务。** webi 提供 `/mcp/:apiKey/sse`，Runner 可以把它作为外部工具服务器挂载。不予采纳：key 会以 URL 的形式留在成员电脑上，工具能到达该 key 可见的每个项目，不做任何按成员的决策，也不留任何记录。这正是知识库提案为 Runner 侧 WeKnora 插件所拒绝的设计。

**按空间而非按项目授权。** webi 的私有空间是它自己更细的单位。按产品决定不予采纳：项目是管理员思考的单位，被授予项目的角色可以读取其私有空间，与 webi 的管理员完全一样。其后果在不变量和风险中写明。

**把私有空间排除在提供方服务之外。** 这是初稿建议的更安全默认。在同一决定下不予采纳：悄悄隐藏项目部分图表的项目授权，是管理员没有做出的授权。

**允许 `all` 模式或一个对话多个项目。** 不予采纳：不同项目的图表回答互不相关的问题，每个工具都需要项目参数，而提示词无法不靠枚举就从日志中点名范围。一个对话一个项目让工具不带参数，也让提示词诚实。

**把 BI 作为 `ctx.knowledge` 上的另一种类型。** 知识 seam 已经有目录、范围和搜索。不予采纳：它的操作返回段落，而图表执行返回模型以不同方式阅读的字段和行；把一个折进另一个，会给模型一个有时以表格作答的搜索工具。同一治理设计下的两个 seam，比带两种结果形式的一个 seam 代价更低。

**把图表与项目一起录入 SQLite 目录。** 不予采纳：图表在 webi 里每天都在变，且从不单独授权，持久副本只会过时。项目入目录是因为授权指名它们。

**第一阶段就用工具卡片绘图。** 作为次序而非价值不予采纳：部署已经渲染 `echarts` 围栏，因此第一阶段靠一句提示词就能得到图，卡片是工具结果稳定之后的第二阶段。

**在控制台录入 API key。** 第一阶段不予采纳：它需要经由管理 API 的凭据写入路径和控制台尚不具备的密钥处理，而 `credentialRef` 加凭据库正是 WeKnora 行已经在做的。

**让模型在语义层上运行即席指标查询。** webi 的 MCP 服务暴露数据模型、字段和表数据。第一阶段不予采纳：即席查询是另一种授权决定，即模型在数据仓库上自行组合查询，而产品结果由人们已经建好的图表即可达成。

## 验收标准

- Team Runner 启动时即内建 BI 工具和 composer 控件，成员电脑上无需配置任何 webi 地址、key 或插件。
- 新的工作对话以 `off` 开始，两个 BI 工具都不在模型的工具列表里，在成员选定项目之前没有任何 BI 请求离开这台电脑。
- 选定之后，系统提示词精确点名会话日志中记录的项目；之后在 webi 里改名不会改变该对话的提示词。
- 被授予项目的角色的成员能列出并执行其中的每一张已保存图表，公共空间和私有空间一视同仁；未被授予的角色的成员以 `not-allowed` 被拒绝，且永远不会得知项目是否存在。
- 已保存图表按保存时的样子执行：工具调用不会让任何筛选、参数、排序或 SQL 抵达 webi，行和单元格按部署的上限截断并报告截断。
- 撤销授权、停用项目、停用成员或吊销设备都会拒绝下一次操作，无需重新登录。
- 目录镜像一次成功的 webi 列表，跨改名保持项目引用，退役 webi 不再列出的项目，并在同步失败后保留上一份快照且失败在控制台页面可见。
- 每条面向 Runner 的 BI 路由在解码任何其他字段之前以 `426` 拒绝不支持的协议版本。
- 抓取到的任何 Runner 配置、请求、工具结果或浏览器状态都不含 webi key、uuid 或 URL。
- 只有持有 `bi.catalog.read` 的主体能读取目录页面；每条写路由独立执行其权限、同源和 CSRF 检查。
- 免密钥快照钉住模型在 `off` 和 `selected` 下看到的内容，两个 SDK 的期望输出都携带 `bi/scope` 事件。

## 风险

- 项目授权把私有空间暴露给该角色的每个成员。这是产品决定，控制台必须在做出授权的地方说明这一点，因为习惯了 webi 空间共享的管理员会预期更细的单位。
- webi 的路由是一个分支的路由：内容列表、异步查询和图表定义是某一版本的 Lightdash 路由，webi 升级可能改变它们。契约夹具按已部署的服务器录制，提供方需要一位指名的升级负责人。
- 没有行数限制的已保存图表可能很大，对慢数据仓库的执行可能超过成员愿意等待的时间。行与单元格上限、轮询截止时间和上游取消让单次调用有界，但不能让慢查询变快。
- 模型可能为一个问题挑错图表，或写出一个数字有误的 `echarts` option。在回答中点名所执行的图表，以及第二阶段直接绘制行数据的卡片，是缓解措施；卡片不在第一阶段。
- 提示词段落的围栏指令假定部署挂载了 `echarts` 渲染器。没有渲染器的部署得到的是 JSON 块而非图表；今天 Team bundle 不携带该渲染器，部署 profile 携带。
- 目录与 `all` 模式的角色授权按项目逐个评估，与知识库按知识库逐个评估相同。几十个项目的规模下没有问题；之后的批量访问控制操作必须保留逐资源评估。
- 分离的 SQLite 文件无法原子地提交目录与访问控制的变更。幂等对账修复被中断的写入，与知识库相同。
- 该 stack 新增一个包组，带来 README、子系统页面和逐文件覆盖率义务。按领域、提供方、HTTP、工具、UI 排序让每次评审都小，但在控制面强制执行和 Runner 路径都存在之前，不得暴露该能力。
