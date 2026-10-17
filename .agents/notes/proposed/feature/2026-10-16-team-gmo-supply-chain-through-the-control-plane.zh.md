# Agent Note: Team GMO supply-chain analysis through the Control Plane

Status: proposed

[English](2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) | 中文

## 问题

公司的 GMO供应链平台 excel-tools 把供应商的 Excel 处理成需求、供给、净缺口、分配等结果，并通过统计页回答计划员最常问的问题：缺多少、缺口在哪家供应商、落在哪一周、哪个料号缺得最多。Team 成员向 DSH 问这类问题，得到的是通用知识的回答，因为没有任何能力能抵达 excel-tools；即使模型抵达了它，也仍会误读数据：GB 与 GL、2030-12-31 这个占位日期、"缺口"的三种含义、分配顺序，都是公司自己的规则，模型无法从列名推断。[BI 分析](2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)和[私有知识](2026-09-01-team-private-knowledge-control-plane.zh.md)已经解决了访问这一半：控制面持有凭据，管理员按资源授权，会话记录成员的选择，模型只在做出选择之后才看到工具。缺的是 GMO 的对应物：一个贴合业务划分的受治理单元、excel-tools 目前没有的上游接口，以及把业务规则交给模型的办法。

## 提案

把 GMO供应链分析做成与 BI 并列的独立 Team 能力，而不是 BI 的第二个数据源。excel-tools 新增只读、令牌鉴权的网关；`team-control-plane` profile 挂载持有该令牌的提供方、受治理的分类目录、面向 Runner 的路由和管理路由；`team` profile 挂载 Runner 侧提供方、五个面向模型的工具与一个提示词章节、浏览器 Remote 和 composer 控件。

### 产品结果

- 管理员在 excel-tools 的 **管理 → 对话网关** 页面创建网关令牌，并把它存为 `gmo-source` 行的 `credentialRef`。
- 管理员在 **资源管理 → GMO供应链** 下看到 excel-tools 的每个分类，刷新目录，并逐个启用或停用。数据源新开始提供的分类以停用状态出现，所以被授予"全部分类"的角色不会在某条业务线刚出现时就自动获得它。
- 管理员打开角色的 **GMO供应链权限** 对话框，授予无、全部已启用分类或选定分类。
- 获得授权的角色的成员打开工作对话，从 composer 的 GMO 控件选择一个分类，然后用普通语言提问。模型列出该分类的结果，描述能回答问题的那份，向它取数，并据此作答，同时说明答案依据的是哪份结果、什么度量、什么筛选。
- 对话从 GMO 关闭开始。成员选定分类之前，模型看不到任何 GMO 工具，也没有任何 GMO 请求离开这台电脑。
- 撤销授权、停用分类、停用成员或吊销设备，都会让下一次操作随之改变，无需重新登录或新开对话。

### 第一阶段非目标

- 网关不提供导出、下载、删除、上传或工具运行，只读取统计数据。
- 没有行级或按结果的授权：分类是单位，被授予它的成员读取其中的全部结果。
- 没有跨分类的提问，一个对话也不能同时用几个分类。
- 成员界面不做原生看板面板；基于同一网关的面板放在后续阶段。
- 不做第二个 BI 数据源：`ctx.biSource` 是单例，而 BI 的问题是已保存图表，并不是计划员要问的。

## 安全不变量

1. Runner 不保存任何能授权直接访问上游的 excel-tools 地址、令牌、分类键或结果 id；Runner 请求只携带受治理的引用。
2. 每个面向 Runner 的请求都校验当前设备访问令牌，`orgId`、`principalId` 和 `deviceId` 取自已验证的声明，绝不取自请求字段。
3. 控制面在每次调用上，对每个操作所指名的分类评估 `gmo.query`。未知、已停用和未授权的分类得到同一种拒绝。
4. 结果通过 excel-tools 所说的所属分类获得授权，该分类在每次调用上从上游解析，因此来自另一分类的结果引用在读取任何数字之前就被拒绝；数据源把答案归给另一个分类时，该答案不被读取即丢弃。
5. 会话范围只会收窄当前授权；它在每次操作上重新评估，且只存在于会话日志中。
6. 结果名称、列值、筛选条件、数字和上游错误体绝不进入控制面审计库或普通日志；审计行只携带引用、提问的种类、数量和封闭的原因。
7. 控制面只调用其配置的 excel-tools 源和下文固定的端点集合。Runner 请求里没有网关未定义的 URL、头、语句或操作字段；提问是一个封闭词汇，其中的列和取值由数据源对照该结果自己的列来校验。
8. 每个面向 Runner 的路由都携带 GMO `protocolVersion`，且先于任何其他字段被评估；不支持的版本回答 `426`，不执行任何操作。
9. 模型能看到的关于所选分类的一切，都能仅凭会话日志重建：提示词里的分类名取自日志，业务规则则以工具结果的形式到达模型，而工具结果会被日志记录。

## 运行时架构

```text
3090 Team Runner                                   3095 Control Plane                  excel-tools

composer GMO control                              administration API
        |                                                 |
gmo/scope Session event                         governed category catalog
        |                                                 |
prompt section + tool visibility                        RBAC + audit
        |                                                 |
gmo_list_results / describe / aggregate /                 |
gmo_overview / gmo_rows                                   |
        |                                                 |
Team GMO Provider -- current device token --> GMO Gateway -- fixed endpoints + token --> /api/gateway
```

### 能力与包拓扑

| 包 | 角色与职责 |
|---|---|
| `packages/gmo/gmo` | 浏览器安全的 Service Definition `ctx.gmo`、带品牌的 `GmoCategoryRef` 与 `GmoResultRef`、提问词汇及其读取器、`gmo/scope` 会话事件，以及封闭的失败集合 |
| `packages/gmo/gmo-source` | 仅控制面使用的上游接口 `ctx.gmoSource`：列出分类和结果、定位并描述一份结果、向它提问，全部使用上游 id |
| `packages/gmo/gmo-excel-tools` | excel-tools 网关的提供方；按次解析令牌，并限制条数、时间和字节数 |
| `packages/gmo/gmo-gateway` | 受治理网关 `ctx.gmoGateway`：持久的分类目录，以及经授权的目录、列表、描述和提问 |
| `packages/gmo/gmo-gateway-sqlite` | 持久目录、同步、access-control 注册、逐分类授权和审计 |
| `packages/gmo/gmo-gateway-http` | 面向 Runner 的路由，含令牌校验和 GMO 协议版本 |
| `packages/gmo/gmo-team` | Runner 侧的 `ctx.gmo` 提供方，携带当前设备令牌访问其配置的控制面 |
| `packages/gmo/tool-gmo` | 五个工具、`gmo:scope` 提示词章节、随范围变化的可见性，以及范围投影 |
| `packages/api/gmo-controller` | 仅 Team 的 Remote，向浏览器提供其获授权的分类并记录对话的选择 |
| `packages/client/ui-gmo` | composer 控件：在获授权的分类上单选 |

沿用 BI 的包形态，Runner 与 excel-tools 之间同样保留两个接缝，原因与 BI 相同：`ctx.gmo` 说成员想要什么，`ctx.gmoSource` 说 excel-tools 能做什么，二者之间的网关是唯一把受治理引用映射到上游 id、并决定是否允许的一方。

### 授权单位

单位是 excel-tools 的**分类**，即其工具页顶部以 tab 显示的业务线（`gb`，之后是 `mfc`、客供料、MTS），既不是工具，也不是结果。一个分类下有多个工具，一键结果又已包含其下各工具的阶段，按工具授权会把一个流程拆开；结果在每次处理时不断产生，按结果授权永远不会是最新的。分类登记在 excel-tools 的 `backend/app/categories.py`；已登记但没有工具的分类不对外提供，工具所属的分类若未登记（如已停用的四步旧版工具），则通过显式的旧版映射解析，否则不解析。

### 稳定引用

```text
exceltools:<sourceCode>:<categoryKey>
exceltools:<sourceCode>:<categoryKey>/<resultId>
```

分类引用是持久目录的键，也是 access-control 的 `ManagedResource.externalRef`；授权指名的是资源的代理 id，因此分类改名后所有授权保持不变。64 字符、审计 token 字符集的边界沿用 BI。excel-tools 把一键结果的某一步称为 `<id>~<阶段>`；`~` 不在引用字符集内，所以提供方自己的 id 把分隔符写成 `.`，只在拼路径时才转换回来，并拒绝任何不匹配 `[0-9a-f]{32}(.[a-z0-9-]+)?` 的 id。

<a id="excel-tools-gateway"></a>
## excel-tools 网关

excel-tools 新增 `/api/gateway`，只读且端点固定：

| 操作 | 路由 |
|---|---|
| 列出至少有一个工具的分类 | `GET /categories` |
| 列出某分类的结果，最新在前 | `GET /categories/{key}/results` |
| 不读数字，只定位一份结果所属的分类 | `GET /results/{id}/placement` |
| 描述一份结果：带含义的列、看板维度、今天的日期、分类的规则 | `GET /results/{id}` |
| 在白名单列上做自由聚合 | `POST /results/{id}/aggregate` |
| 现成看板、明细行、候选值、供需视图 | `POST …/insights/{widget}`、`POST …/query`、`GET …/facets/{field}`、`GET …/balance*` |

网关只接受 `Authorization: Bearer <令牌>`，从不接受登录 Cookie；令牌在管理员页面创建，以 SHA-256 哈希存储，只显示一次，可撤销，也可用环境变量设置。每个响应都带 `category`。状态码区分四种含义：`404` 结果不存在，`409` 结果存在但没有这个视图，`400` 提问有误，`413` 答案超过字节上限。条数和字节数的上限是环境变量设置，超过字节上限的答案被拒绝而不是被截断。

`aggregate` 让模型的提问不被预设又不打开 SQL：一个指标（`sum`、`count`、`distinct`），最多两个来自该结果自己列白名单的分组列，一个日期粒度，筛选、排序和上限。现有看板保留给模型不该重新推导的计算，例如相对今天的已过期、本周、未来 N 周分桶。

## 让模型懂业务

模型懂通用的供应链词汇，不懂这家公司的规则。含义随数据一起走，由 excel-tools 持有并通过它的 `describe` 提供：

- 每个结果列带一条 `description`，写在声明该列的地方，因此字典不会与表结构脱节。
- 每个分类有一份 Markdown 口径说明 `backend/app/glossary/<key>.md`，涵盖结果的各阶段、"缺口"的三种含义（净缺口、剩余缺口、供需平衡里的缺口）、含 2030-12-31 占位日期和需求时间调整的日期规则、供应商与品牌映射，以及分配顺序。
- `gmo_describe_result` 同时返回两者，提示词章节要求模型先描述结果再选列，并把写明的规则当作权威。

规则以工具结果的形式到达，所以新增分类不需要发布 Runner：excel-tools 增加该分类、口径说明和列说明，管理员再启用它。提示词章节保持简短且固定，请求前缀因此稳定。

### 模型看到什么

五个工具，范围为 `off` 时都不可见：`gmo_list_results`、`gmo_describe_result`、`gmo_aggregate`、`gmo_overview`（看板）、`gmo_rows`。没有任何工具带分类参数：分类属于对话，结果引用落在它之外时，在本地和控制面上都会被拒绝。缺少视图（`409`）作为一条说明如此的答案返回，并告诉模型不要用别的办法去算；被拒绝的提问会指明去 `gmo_describe_result` 查列键。聚合以总量之下的表格呈现，让模型从总量引用占比，而不是自己把行加起来。

### 会话范围状态

`SessionEventMap` 新增 `gmo/scope`，整值替换，以最后一个事件为准：

```text
{ version: 1, mode: "off" }
{ version: 1, mode: "selected", category: { ref: GmoCategoryRef, displayName: string } }
```

显示名与引用一起记录，因为提示词要指名分类，而模型可见的名字必须来自日志。该事件在持久化规则下属于 `same-version`，由一条 persistence-change 记录确认。

## Control Plane API

### 管理 API

| 方法与路径 | 权限 | 行为 |
|---|---|---|
| `GET /team/api/gmo-categories` | `gmo.catalog.read` | 持久目录、实际启用状态、数据源健康度和上次同步状态 |
| `POST /team/api/gmo-categories/sync` | `gmo.catalog.manage` | 一次串行化的完整同步；并发调用方加入同一次同步 |
| `PATCH /team/api/gmo-categories/:categoryRef` | `gmo.catalog.manage` | 管理员对单个分类的启用或停用 |
| `POST /team/api/roles/:roleId/gmo-categories` | `role.grant.manage` | 把角色的 `gmo.query` 授权替换为 `none`、`all` 或选定集合 |

权限目录新增 `gmo_category`，含 `gmo.query`、`gmo.catalog.read` 和 `gmo.catalog.manage`，随 BI 同样的方式发布。审计目录新增 `gmo.results`、`gmo.describe`、`gmo.ask` 和 `gmo.catalog.sync`，元数据仅限提问的种类、条数和封闭的失败标签。

### Runner API

`POST /team/gmo/catalog`、`/results`、`/describe` 和 `/ask`，每个都携带 `protocolVersion`，且只引用受治理的引用。提问由域包里的读取器解析，Runner 的工具和控制面共用它；词汇未定义的键被拒绝而不是被忽略，因为 Runner 以为筛选生效、控制面却把它丢掉，会得出一个自信的错误数字。

## 失败语义

一个封闭的原因集合：沿用 BI 的并把图表用语换掉，再增加三个：`result-unavailable`、`unsupported`（该结果没有这个视图）、`invalid-query`（数据源拒绝了某个列、筛选或取值）和 `too-large`。`unsupported` 在工具里是一个答案，不是故障。令牌被拒绝或被撤销，在成员那里读作 `upstream-unavailable`，在数据源上读作 `failing` 健康度。

## 交付计划

相互依赖的变更，各自有聚焦的检查：

1. **excel-tools 网关**：分类登记表、令牌及其管理员页面、`describe`、`aggregate`、列说明与口径说明；它自己的测试集，加上在生产库副本上的运行，复现统计页的数字。
2. **领域、权限与会话词汇**：`gmo` 包、三个权限、审计动作、带 persistence 记录和 SDK 投影的 `gmo/scope` 事件。
3. **提供方与受治理目录**：`gmo-source`、`gmo-excel-tools`、`gmo-gateway`、`gmo-gateway-sqlite`。
4. **控制面 HTTP 与管理**：`gmo-gateway-http`、管理路由、控制台页面、角色对话框、`team-control-plane` 的行。
5. **Runner 提供方、工具与提示词**：`gmo-team`、`tool-gmo`、`team` 的行、桌面部署行。
6. **浏览器 Remote 与控件**：`api/gmo-controller`、`ui-gmo`、一个装配后的浏览器测试。

## 考虑过的替代方案

**第二个 BI 数据源。** 让 excel-tools 成为 `biSource`，其"项目"是分类、"图表"是预设视图。否决：`ctx.biSource` 是网关注入的单例，两个数据源需要先有注册表；已保存图表按保存时的样子运行，答不了"只看 Hungo、下周"；BI 的"不带筛选"非目标与计划员的提问恰好相反。一个有自己词汇的独立能力，多花一个包组，换来的是不预先固定的提问。

**按工具授权。** 工具是 excel-tools 代码里的单位，但一键结果已包含三个工具的阶段，旧版工具之间还共享结果，边界与数据对不上。否决，改用分类。

**按结果授权。** 结果在每次运行时产生，授权永远不会是最新的。

**把 excel-tools 的统计页嵌进成员界面。** 否决：该页依赖 Cookie 和整套 `/api`，嵌入就意味着要么通过控制面暴露那套 API，要么桥接会话，这就放弃了固定端点的规则。之后可以在网关之上做原生面板。

**让模型写 SQL 或传语句。** 否决：那是另一种授权决定，而白名单列加固定指标已覆盖统计页自己能回答的问题。

**把业务规则放进提示词章节。** 否决：提示词会随每个分类增长，且每增加分类都要发 Runner，规则也不会作为模型可见输入进入会话日志。工具结果会被记录，并由数据的所有者持有。

**在控制台里填写令牌。** 与 BI 否决密钥输入框同理否决：`credentialRef` 加凭据存储是现有路径。

**在加入 GMO 之前，先把目录代码抽成知识库、BI、GMO 共用的助手。** 现在三份目录重复了同步和授权代码。先抽取会动到已发布的知识库与 BI 代码，而它们没有任何已录制会话的测试覆盖；重复在各包的 Dev Note 中说明，抽取是第一个后续项。

## 验收标准

- Team Runner 启动时内置 GMO 工具和 composer 控件，成员电脑上没有需要配置的 excel-tools 地址、令牌或插件。
- 新的工作对话从 `off` 开始，五个工具都不在模型的工具列表里，成员选定分类之前没有任何 GMO 请求离开这台电脑。
- 选定之后，系统提示词所指名的正是会话日志里记录的分类；之后在 excel-tools 里改名不会改变该对话的提示词。
- 被授予某分类的角色的成员，可以列出、描述并向其中每份结果提问；没有该授权的角色的成员以 `not-allowed` 被拒绝，且无从得知该分类是否存在；数据源新开始提供的分类，在管理员启用之前不会触达任何成员。
- 数据源不认可其所属分类的结果引用，在读取任何数字之前被拒绝；被归到另一分类的答案被丢弃。
- 一次提问返回的数字，与统计页对同一份结果和同样筛选的数字一致：总剩余缺口、已过期和未来 N 周的分桶，以及按料号的排名。
- 撤销授权、停用分类、停用成员、吊销设备或撤销网关令牌，都会让下一次操作被拒绝，无需重新登录。
- 每个面向 Runner 的 GMO 路由在解码任何其他字段之前，用 `426` 拒绝不支持的协议版本，并拒绝词汇未定义的提问键。
- 任何被捕获的 Runner 配置、请求、工具结果或浏览器状态，都不包含 excel-tools 的地址、令牌，或受治理引用之外的结果标识。
- 只有持有 `gmo.catalog.read` 的主体能读取目录页；每个会改变状态的路由独立执行其权限、同源和 CSRF 检查。
- 一次真实模型的会话，针对一组数字已知来自统计页的问题作答，指明所用结果和度量，并把缺少的视图当作答案。

## 风险

- 分类授权让该角色的每个成员都能看到其结果里的全部供应商、料号和数量。excel-tools 没有行级控制，控制台必须在授权的地方说明这一点。
- 模型可能选错度量，或混用"缺口"的三种含义。口径说明和"说明依据"的规则能降低这个风险；只有已知答案的真实模型运行才能度量它，而本仓库没有覆盖 Team 能力的无密钥快照通道。
- 列说明和口径说明是根据已写明的规则手写的，处理代码里的规则改了而没有同步修改它们，模型读到的就是过期的规则。分类的所有者必须让它们与实现规则的代码保持一致。
- 一份结果是某次处理的快照；跨期问题需要两个答案由模型自己合并，第一阶段没有对比工具。
- 网关令牌的权限范围是 excel-tools 的全部读取面。它不能写入或导出，但能读取每个分类，所以控制面的逐分类授权是分类之间唯一的隔离；令牌不得离开控制面。
- 部署必须在控制面启动前写明 `sourceCode`、`baseUrl` 和 `credentialRef`，与 BI 相同；升级后没有它们的控制面会加载失败。
- 这一系列变更带来一个新的包组，以及 README、子系统页和逐文件覆盖率的义务，还有第三份目录同步代码。
