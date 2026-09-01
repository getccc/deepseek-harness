# Agent Note: Team 私有知识库始终经由 Control Plane

Status: proposed

[English](2026-09-01-team-private-knowledge-control-plane.md) | 中文

## 问题

Team Edition 已具备治理公司知识所需的身份、设备凭据、角色、授权、受治理资源、策略修订、审计、管理端和 Runner Transport 基础，但尚无将这些基础连接起来的知识能力。成员可以在 Runner 中安装外部 WeKnora 插件，使用固定 API Key 检索内容，但这条直连路径不知道已登录的 DSH 主体及其当前角色。

这类插件配置的知识库 id 是默认值，不是权限上限。其搜索工具接受调用方提供的知识库 id，文档工具接受未经 DSH 资源判定的文档 id，自定义 agent 路径还可能让 WeKnora 选择知识库。隐藏未授权条目的菜单或修改这些默认值的 `/knowledge` 指令能够改善发现体验，但无法阻止模型、其他本地插件或构造的 HTTP 请求指名另一个知识库。

把 WeKnora API Key 放在 Runner 上还会产生第二个问题。该进程中的任何插件都能直接访问凭据和上游服务器，从而绕过 Control Plane 撤权、资源停用和审计。把角色编码到长期 Key 或访问 Token 中，又会使管理员修改绑定后的权限保持陈旧。

用户体验仍然需要一个明确且易懂的控制。成员应能选择当前会话可以检索哪些已授权知识库，而且该选择必须传达给模型：模型看不见的选择等于没有选择。该选择会影响模型可见的检索结果，因此必须支持恢复、fork、回放和审计，同时不能成为权限来源。

## 提案

把私有知识作为内置 Team 能力交付。`team` profile 挂载 Runner 侧知识 Service Provider、面向模型的搜索工具和 Web 指令贡献；Team 用户不安装任何外部 WeKnora 插件。`team-control-plane` profile 挂载 WeKnora 提供方、持久化受治理目录、面向 Runner 的网关和管理路由。Control Plane 持有上游地址和凭据，并根据当前账户与授权状态审批每个操作。

第一阶段支持已授权目录和混合段落检索。它明确不包含分页阅读文档全文、WeKnora 成稿回答、自定义 agent、可恢复的 WeKnora 聊天会话、公开资源 URL、二进制下载、知识录入和远程修改。这些操作需要额外的权限、会话所有权、内容传输或审计决策，不能通过看似兼容的透传接口进入。

本提案扩展但不取代已经实现的[可解释访问控制判定](../../implemented/architecture/2026-08-29-access-control-evaluation.zh.md)、[无本地执行能力的 Control Plane](../../implemented/architecture/2026-08-29-control-plane-carries-no-local-execution.zh.md)、[封闭审计词汇](../../implemented/architecture/2026-08-29-audit-closed-vocabulary.zh.md)、[Team profile 分层](../../implemented/architecture/2026-08-29-team-profile-bundle.zh.md)、[Runner 版本强制](../../implemented/architecture/2026-08-30-a-runner-that-can-be-told-it-is-too-old.zh.md)和[管理控制台](../../implemented/feature/2026-08-30-control-plane-administration-console.zh.md)决策。这些决策都没有被取代：每项决策继续拥有本能力所使用的一条规则。

### 产品结果

- 管理员在**资源管理 → 知识库**下查看此 Control Plane 治理的 WeKnora 知识库，刷新目录，并启用或停用每个条目。
- 管理员打开角色的**知识库权限**编辑器，为角色授予全部知识库、选定知识库或无知识库权限。选定访问会在每个具名受治理资源上授予 `knowledge.search`。
- 成员使用 `/knowledge` 为当前会话选择`全部已授权`、当前已授权知识库的子集或`关闭`。该指令修改持久化会话偏好，不启动模型轮次。
- 会话从`关闭`开始。在成员做出选择之前，模型看不到任何知识工具，也没有任何知识请求离开这台电脑。
- 成员选择之后，系统提示词按名字说明所选范围，`knowledge_search` 随之出现。成员提出普通问题，agent 执行检索；每次调用都携带当前设备 Access Token 到达 Control Plane。
- 撤销角色授权、停用成员、撤销设备、停用知识库或移除上游目录条目，会在下一次操作生效，无需重新登录或新建会话。
- 打包的桌面 Runner 只绑定回环地址，并向公司的远程 Control Plane 发起出站 HTTPS 请求；远程服务绝不主动连接成员电脑。

### 第一阶段非目标

- 不交付 `knowledge_read`、分页文档全文，以及为其寻址的签名文档引用。检索段落就是模型可见检索面的全部；[阅读文档全文](#deferred-full-document-reading)是一个具名的第二阶段。
- 不在 DSH 中公开 WeKnora 管理、上传、删除、分片编辑、共享或 API Key 管理。
- 不公开成稿回答、自定义 `agentId`、WeKnora 会话续聊或服务端 Web 搜索。
- 不代理任意 WeKnora 路径、请求头、请求体、文件 URL 或提供方错误。
- 不授予 `knowledge.read` 或 `knowledge.download`，也不返回可直接加载的上游资源 URL。
- 不把会话范围选择持久化到会话日志之外。新会话从`关闭`开始，而不是继承某个用户设置。
- 不支持一个 Control Plane 中的多个组织或多个 WeKnora 数据源，但稳定引用包含数据源代码，避免此限制成为持久化身份的一部分。

## 安全不变量

只有在以下不变量全部成立时，实现才算完整。

1. Runner 不存储 WeKnora 地址、API Key、租户凭据或能够授权直接上游调用的上游文档 id。
2. 每个面向 Runner 的请求都验证当前设备 Access Token，并从验证后的声明获得 `orgId`、`principalId` 和 `deviceId`，而不是从请求字段读取。
3. Control Plane 对操作指名的每个知识库判定 `knowledge.search`。不存在的资源与未授权资源对外返回相同拒绝。
4. `all` 模式的请求只展开为主体当前已授权且已启用的资源，绝不展开为 Control Plane 凭据可见的全部知识库。
5. 请求只要包含一个未授权、未知、缺失或已停用条目，就整体失败。网关绝不静默丢弃被拒条目并返回部分结果。
6. 每条面向成员的知识路径都枚举持久化知识目录并与受治理资源做 join。没有任何这类路径针对 `knowledge_scope` 枚举 `listResources`，因为管理目录资源与知识库共用该类型。
7. 会话知识范围只能缩小当前权限。它绝不新增资源，只通过会话事件日志持久化，并在每次操作时重新判定。
8. 搜索问题、返回段落、包含自然语言的文件名、工具参数、上游错误体和上游 URL 绝不进入 Control Plane 审计存储或普通日志。
9. Control Plane 只调用其配置的 WeKnora 来源和固定端点集合。Runner 请求中不存在 URL、租户、API Key、请求头覆盖或任意操作字段。
10. WeKnora 提供方请求句柄模式资源，网关只返回文本和 DSH 引用。任何响应都不包含公开或携带凭据的上游 URL。
11. 桌面 Runner 只监听回环地址。知识流量是 Runner 到 Control Plane 的出站请求，任何 Control Plane 路由都不要求从外部连入成员电脑。
12. 生产 Runner 只接受其打包指定的公司 Control Plane HTTPS 来源。它绝不关闭 TLS 校验、跟随服务器下发的来源或提供可编辑的任意知识网关。
13. 每个面向 Runner 的知识请求都携带 `protocolVersion`。网关在解码任何其他操作字段前判定该字段；不支持的版本以 `426 Upgrade Required` 失败，并且不执行知识操作。
14. 桌面包不包含 WeKnora 地址或凭据。WeKnora 运行在 Control Plane 主机上，通过回环地址访问。
15. 模型能看到的关于所选范围的一切，都能仅从会话日志重建。只有会话日志持有知识库名字时，提示词章节才写出名字。

## 运行时架构

```text
3090 Team Runner                                      3095 Control Plane                         WeKnora

Web /knowledge command                               administration API                    (same host, loopback)
        |                                                     |
knowledge/scope Session event                       governed knowledge catalog
        |                                                     |
prompt section + tool visibility                            RBAC + audit
        |                                                     |
knowledge_search                                              |
        |                                                     |
Team Knowledge Provider -- current device token --> Knowledge Gateway -- fixed endpoints + key --> REST API
```

Runner 和 Control Plane 使用精简的 DSH 协议，而不是透明的 WeKnora 代理。协议命名产品操作和 DSH 引用；只有提供方知道 WeKnora 路径与上游 id。

### 部署拓扑与网络归属

3095 端口是部署在远程的 Control Plane 来源。生产反向代理终止 TLS，并在同一个公司来源下暴露现有管理、设备、模型和新增的 `/team/knowledge/*` 路由。代理保留请求取消与响应状态，应用与有界知识协议兼容的请求体和超时限制，并且不把 Bearer 请求头改写到查询参数或日志中。Control Plane 进程及其持久化 SQLite 卷位于可信服务器网络；首个 SQLite 版本只支持单个活动 Control Plane 实例，不支持多个实例各自使用独立文件。

WeKnora 运行在同一台远程主机上。Control Plane 通过回环 base URL 访问它，WeKnora 监听器绑定回环地址，因此除 Control Plane 进程外没有任何网络对端能够到达它。这正是让不变量 14 成为部署事实而非愿望的原因：不存在供成员发现的 WeKnora 来源，也没有凭据跨网段传输。未来若把两者拆到不同主机，必须在把 base URL 移出回环之前恢复等效限制——一个私有网段和一个服务身份。

3090 端口是每台成员电脑上的 Electron 打包 Team Runner。它只绑定 `127.0.0.1` 或等价 IPv6 回环地址，服务本地浏览器 UI，并向打包指定的 `controlPlaneUrl` 发起每个知识调用。知识提供方以自己经过校验的配置字段携带该来源，与公司模型 Transport 完全一致，而桌面安装器生成的 profile 补丁是写入该来源的唯一位置。浏览器 CORS 不属于知识路径，因为本地浏览器调用本地 Runner，再由 Runner 发起经过身份验证的服务器侧 HTTPS 请求。管理页面仍与远程 3095 同源，并保留现有 Session、同源和 CSRF 控制。

一个桌面构建只分配给一个公司 Control Plane 来源，且不嵌入公司 Secret。设备私钥保留在本地应用数据中；Runner 为每个操作读取当前 Access Token，并且只通过 HTTPS `Authorization` 请求头发送。企业代理、DNS 和私有 CA 支持必须使用明确的部署配置与平台信任存储；任何生产选项都不得关闭证书校验。

每个面向 Runner 的知识路由携带由知识 HTTP 包拥有的 `protocolVersion` 字段，拥有自己的当前值与最小值，并复用 `team-control-plane-http` 已导出的 `ProtocolSupport` 与 `ProtocolRefusal` 词汇。知识不共用设备绑定的版本常量：只涉及知识的协议变更不应顶高绑定版本，抬高知识最小值也不应把老 Runner 挡在绑定之外。网关在解码任何其他字段前检查 `protocolVersion`，版本不匹配返回现有包含支持范围的 `426` 响应，Runner 把它投影为既有的需要升级体验。因此交付本功能需要为每个受支持平台发布新的签名桌面产物，而不是运行时安装插件。公司模型路由目前不做版本协商，这是一处已知的不对称，应在它自己的变更中解决，而不是在这里。

WAN、DNS、TLS、代理或远程 Control Plane 不可用时，本地会话和非 Team 本地功能仍可使用，但目录和搜索返回封闭的 `control-plane-unreachable` 或 `update-required` 结果。Runner 不持久化私有段落，也不持久化可离线搜索的目录。它只保留会话日志中的不透明选择；重连后刷新已授权显示元数据，并重新授权下一个操作。

### 能力与包拓扑

| 包 | 角色与职责 |
|---|---|
| `packages/knowledge/knowledge` | 浏览器安全的 Service Definition，以及目录、搜索和会话范围使用的 DSH 品牌化引用类型 |
| `packages/knowledge/knowledge-source` | 仅 Control Plane 的上游接缝：列出数据源、检索其中一个已授权知识库集合，使用上游 id |
| `packages/knowledge/knowledge-weknora` | Control Plane Service Provider，负责固定的 WeKnora 列表与搜索端点；每次操作解析凭据 |
| `packages/knowledge/knowledge-gateway` | 受治理网关接缝：管理员维护的持久化目录，以及 Runner 访问的已授权目录与检索 |
| `packages/knowledge/knowledge-gateway-sqlite` | 持久化目录和受治理操作 Service Provider；同步受治理资源、判定访问并记录审计事件 |
| `packages/knowledge/knowledge-gateway-http` | 基于 Bearer Token 的面向 Runner HTTP 适配器；拥有知识 `protocolVersion` 并验证每个解码后的请求和响应 |
| `packages/knowledge/knowledge-team` | Runner 侧 `ctx.knowledge` Service Provider；每次操作读取当前 `teamAccountClient` Token 并调用其配置的 Control Plane |
| `packages/knowledge/tool-knowledge` | 注册 `knowledge_search`、范围提示词章节、范围驱动的工具可见性、原生渲染和 Web 展示元数据 |
| `packages/api/knowledge-controller` | 仅 Team 的 Typert 远程，为浏览器提供已授权目录并记录范围选择；只由 `team` bundle 挂载 |
| `packages/client/ui-knowledge` | `/knowledge` 指令装饰、已授权多选、已本地化会话 Chip、范围投影和重连失效处理 |
| `packages/bundle/team` 和 `packages/bundle/team-control-plane` | 随产品交付的组合配置项；Runner 不获得上游凭据，Control Plane 保留无本地执行排除规则 |
| `apps/team-runner-desktop` | 为一个远程 Control Plane 来源打包仅回环的 3090 Runner；携带版本元数据但不包含 WeKnora 配置 |

Runner 不安装也不应用任何外部 WeKnora 插件，`knowledge-weknora` 也不依赖它。它自有一个最小 REST 适配器和约定 fixture，因为在持有公司凭据的 Control Plane 进程里引入第三方运行时 scope，会是该进程中唯一的非 `@deepseek-ai` 包，而且固定的两端点面比包装它的客户端还小。

上游接缝与面向 Runner 的接缝是分开的，因为两者回答不同的问题：`ctx.knowledge` 命名成员想要什么，`ctx.knowledgeSource` 命名数据源能做什么。把它们分开，才使夹在中间的网关成为唯一把受治理引用映射到上游 id 的一方，也是唯一判定它是否可以这样做的一方。

`packages/api/knowledge-controller` 存在的原因是浏览器无法直接访问 `ctx.knowledge`。模型目录也是这样到达浏览器的，走 session controller 上的 `@Remote('modelCatalog')`。知识不并入那个 controller：`ctx.llm` 在每个 Web build 都挂载，而 `ctx.knowledge` 只在 Team 存在；一个容忍服务缺席的 controller 会让漏挂载看起来像空目录，而不是大声失败。

`team-control-plane` 的组合注释目前把这个槽位预留为「Knowledge MCP Gateway」。该名称早于本提案，描述的是另一套设计；插入这些配置项的同一个变更负责改正该注释。

### 稳定知识引用

Control Plane 为每个上游知识库创建一个稳定的 `KnowledgeRef`：

```text
weknora:<sourceCode>:<upstreamKnowledgeBaseUuid>
```

`sourceCode` 是经过验证的部署配置值。`KnowledgeRef` 同时成为持久化目录键和访问控制 `ManagedResource.externalRef`；授权继续指向受治理资源的替代 `ResourceId`。显示名称或描述改变时，所有授权因此保持不变。目录单独存储上游 id，且只有 WeKnora 提供方使用它。

该引用必须满足审计存储对 `resource_id` 的规则 `AUDIT_TOKEN`：至多 64 个字符，取自字母、数字和 `. _ : @ -`。在八字符前缀、一个分隔符和 36 字符 UUID 之后，`sourceCode` 被限制为同一字符集下的 19 个字符，提供方在插件加载时以该规则为明示理由校验它。审计存储会拒绝的引用，也就是任何操作都无法记录的引用，因此该失败属于加载期，而不是首次拒绝时。

搜索结果携带 `KnowledgeRef`、段落文本、分数和标题。它们不携带上游文档 id，也不携带任何能够授权后续取回的引用，因为第一阶段没有需要授权的后续取回。

## 受治理目录

### SQLite 记录

目录拥有一条数据源记录和每个知识库一条记录。其 schema 只记录运行元数据：

| 记录 | 必填字段 |
|---|---|
| 数据源 | 组织 id、数据源代码、提供方类型、已配置来源标识、最后成功同步、最后尝试和健康状态 |
| 知识库 | `KnowledgeRef`、数据源代码、上游 id、显示名称、描述、类型、文档／分片／处理中数量、embedding 模型 id、管理员启用位、远程存在位、最后发现时间和上游提供时的最后更新时间 |

数据库不存储 API Key、查询文本、段落、文件名或搜索结果。它使用仓库 SQLite 打开顺序、application id、单调 schema 版本、严格表和针对数据源与知识引用唯一性的显式索引。

访问控制数据库仍然是角色、资源、授权和策略修订的权威。知识目录不能声明主体已获授权。跨数据库协调遵循现有 Control Plane 做法：目录注册调用 `accessControl.registerResource`，目录启停调用 `setResourceEnabled`，第二次写入失败的状态可由下次同步发现并修复。

### 同步

同步通过显式管理请求运行，在服务挂载后的 Control Plane 启动阶段运行，并可按配置的周期运行。远程不可用是运行故障，不是自身配置格式错误：启动时保留最后一次成功快照并公开故障状态，而不是删除或停用所有条目。

一次成功的完整 WeKnora 列表先在单个目录事务中应用以下规则，再执行幂等访问控制对账：

- 新上游 id 创建目录行，并在管理员启用位为 true 时注册一个已启用的 `knowledge_scope` 受治理资源。
- 已知上游 id 更新显示元数据和计数，不改变 `KnowledgeRef`、`ResourceId` 或任何授权。
- 在成功完整列表中缺失的条目变成 `remotePresent = false`，其受治理资源变成已停用。目录行和授权保留，因此临时移除或恢复不会静默替换身份。
- 缺失条目重新出现时恢复远程存在状态，并且只有管理员启用位仍为 true 时才在访问控制中重新启用。
- 手动停用改变管理员启用位和受治理资源状态。同步绝不覆盖该选择。

管理员只能通过第一阶段之后新增的独立显式操作清理缺失条目。第一版 UI 不提供清理，因为 `deleteResource` 还会删除所有指向该资源的授权；这是不可逆的策略变更，而不是目录整理。

## 权限与角色组合

现有 `knowledge_scope` 资源类型已经带有 `knowledge.search`、`knowledge.read` 和 `knowledge.download`。第一阶段只强制并授予 `knowledge.search`。在阅读文档全文交付之前，`knowledge.read` 留在目录中，任何编辑器都不授予它。

向封闭目录添加两个管理权限：

- `knowledge.catalog.read`
- `knowledge.catalog.manage`

管理 API 把 `urn:dsh:admin:knowledge-catalog` 注册为 `knowledge_scope` 受治理资源。菜单和页面读取路由在该精确资源上检查 `knowledge.catalog.read`；同步及启停路由检查 `knowledge.catalog.manage`。角色分配仍检查 `role.grant.manage`，因为它会改变另一个角色的授权。

管理目录资源与面向成员的知识库共用 `knowledge_scope` 类型，这带来一个实现必须处处应对的后果。`listResources(orgId, 'knowledge_scope')` 会把管理资源和真实知识库一起返回，而 `all` 模式在 `knowledge.search` 上的类型授权会连它一起放行。因此每条面向成员的路径——Runner 目录路由、`all` 模式展开和角色编辑器的可选列表——都枚举持久化知识目录并按 `KnowledgeRef` 与受治理资源做 join，模型目录本来就用这个办法把自己的管理资源挡在模型列表之外。无论什么授权指名它的类型，管理资源都不是可检索的知识库。

角色编辑器提交一个显式模式：

| 模式 | 存储的授权 |
|---|---|
| `none` | 不存储 `knowledge.search` 的类型或资源授权 |
| `all` | 存储一条 `knowledge.search` 类型授权 |
| `selected` | 在每个选中的知识资源上存储一条 `knowledge.search` 资源授权 |

保存该编辑器会撤销此角色针对该操作的现有类型与资源授权，写入请求集合，并在结果窄于完整权限目录时清除 `coversCatalog`。它不改变 `knowledge.read`、`knowledge.download`、目录管理权限或其他资源类型的授权。响应使用现有协议形式返回完整角色列表。

多个角色继续取并集。直接持有全知识权限的角色加选定角色会得到全部已启用知识库；两个选定角色得到其资源并集。系统没有拒绝规则，因此 UI 不得提供该选项。

## Control Plane API

### 管理 API

| 方法与路径 | 权限 | 行为 |
|---|---|---|
| `GET /team/api/knowledge-bases` | `knowledge.catalog.read` | 返回持久化目录、有效启用状态、远程健康状态、计数和最后同步状态；绝不返回上游凭据或 URL |
| `POST /team/api/knowledge-bases/sync` | `knowledge.catalog.manage` | 运行一次串行化完整同步并返回新目录；并发调用方加入同一个进行中操作 |
| `PATCH /team/api/knowledge-bases/:knowledgeRef` | `knowledge.catalog.manage` | 解析精确受治理资源后改变管理员启用状态 |
| `POST /team/api/roles/:roleId/knowledge-bases` | `role.grant.manage` | 使用 `none`、`all` 或选定集合替换角色的知识搜索授权 |

这些路由使用现有管理会话、同源检查、写操作的 CSRF 检查、有界 JSON 读取器、类型化拒绝词和逐路由访问判定。UI 权限投影只负责隐藏控件；每条路由仍再次强制执行。该投影把 `knowledge_scope` 权限映射到管理目录资源，与它已经把每个 `model` 权限映射到模型目录资源的做法一致。

### Runner API

| 方法与路径 | 操作 | 行为 |
|---|---|---|
| `POST /team/knowledge/catalog` | 目录 | 只接受 `protocolVersion`，验证设备 Token，对每个存在且已启用的目录条目判定 `knowledge.search`，只返回 `KnowledgeRef`、显示名称、描述和类型 |
| `POST /team/knowledge/search` | 搜索 | 解析请求的会话子集，逐项审批 `knowledge.search`，使用精确上游 id 调用 WeKnora，限制结果和文本，并返回段落 |

Runner 请求体绝不提供组织、主体、设备、上游来源、租户、API Key、上游知识库 id 或上游文档 id。网关只接受已注册操作，并在 HTTP 解析器拒绝额外字段。

目录和 `all` 模式授权会遍历目录，这与知识范围的访问控制设计一致。只有当缓存键包含组织、主体和精确 `policyRevision`，在目录有效状态改变时失效，并保持相同拒绝行为时，才可以选择加入缓存。在性能分析证明需要前，首个实现应优先使用无缓存判定。

## Runner 工具与 `/knowledge`

### 会话范围状态

使用版本化 `knowledge/scope` 事件扩展 `SessionEventMap`，其载荷为以下之一：

```text
{ version: 1, mode: "off" }
{ version: 1, mode: "all" }
{ version: 1, mode: "selected", bases: [{ ref: KnowledgeRef, displayName: string }] }
```

没有事件表示 `off`。因此会话以知识不可用开始，直到成员做出选择为止。投影单元折叠最新事件，将选定引用验证为品牌化协议值，并向 Host 与 Web 客户端公开该值。fork 和 rewind 从结果事件日志派生该值。该事件是模型可见输入，因为它同时决定提示词说什么和存在哪些工具；TypeScript 和 Python SDK 事件投影及预期输出必须在同一个变更中更新。

`selected` 载荷在每个引用旁携带显示名称，在选择的那一刻快照下来。这正是让具名提示词章节在「模型可见即已记录」规则下合法的原因：只能把日志持有的名字告诉模型。它有一个应当直说的后果——管理员重命名知识库之后，已记录会话的提示词保留当时记下的名字，而输入框 Chip 和选择器显示从已授权目录解析出的当前名字。日志不会被改写为与之一致。

`all` 模式不记录名字，因为它指代的集合是主体在每次调用时的授权范围，无法诚实地快照。因此它的提示词章节只说明模式，不逐个列出知识库。

`selected` 的值是从已授权目录响应取得的偏好。陈旧或伪造引用仍会到达 Control Plane 判定，无法扩大权限。当选定引用不再可发现时，UI 将选择标记为不可用并要求成员更新；工具调用会失败，而不是静默退回到更小集合或 `all`。

### 模型看到什么

`tool-knowledge` 在新的 `FIRST_PARTY_SECTION_ORDER` 槽位贡献一个 `knowledge:scope` 系统提示词章节，按装配从折叠后的会话范围解析。`off` 时章节文本为空，不贡献任何内容。`selected` 时它用记录的显示名称写出所选知识库，并说明公司相关问题应先检索再回答。`all` 时它说明全部已授权知识库都在范围内。这与 plan 模式让一个已记录的会话模式到达模型所用的机制相同。

工具可见性遵循同一份折叠状态。范围为 `off` 期间，`knowledge_search` 根本不在模型的工具列表里：`tool-knowledge` 在 agent 的作用域上下文上施加一条 `tools.restrict()` 拒绝，并在范围事件打开会话时释放它。这是一条绑定到 agent 作用域的活注册，而不是逐次装配的过滤器，因此恢复的会话必须在 agent 构造时按同一份折叠施加它，范围变化时必须重新施加。模型看不见的工具不会消耗 schema token，也不会发起一次只会被拒绝的调用。

### 指令行为

`/knowledge` 是带 Web `popupSelect` 装饰的 Host 指令，在指令列表中与 `/model` 并列。裸调用打开`全部已授权`、`关闭`和当前已授权目录的多选项。保存会追加一个 `knowledge/scope` 事件并返回可见确认；它不启动模型轮次。第一阶段的指令不接受查询，因为人工指令不经过模型轮次，而把状态修改与隐藏提示词组合会形成第二条输入路径。

输入框为`知识库：全部`、`知识库：关闭`或选定名称显示本地化 Chip。Chip 读取会话投影和目录元数据；它绝不直接读取角色授权。重连和策略修订失效会刷新目录名称与可用性，而不重写已记录的选择。

该选择只存在于会话日志中。它不写入用户设置，新会话也不继承它，因此每个会话都从`关闭`开始，成员每个会话表明一次意图。

### 面向模型的工具

`knowledge_search` 接受自然语言 `query` 和可选的有界 `max_results`。它读取会话范围，模式为 `off` 时在本地拒绝——这是模型不应到达的状态，因为那时工具不可见——并把 `all` 或精确选定的 DSH 引用发送给 Team 提供方。其规范结果包含查询、已搜索 DSH 引用与显示名称、有界段落结果、分数、截断标记和标题。它绝不公开上游 id。

该工具声明取消和超时，使用可逆注册，提供纯 Host 展示元数据，并获得从原始事件和持久化结果元数据派生的具名 Web 卡片。原生文本对 headless 和不支持的客户端保持足够完整。工具描述说明何时检索，不在 schema 中列出当前知识库或动态权限——那由提示词章节承担，而且它从已记录的事实中承担。

### 成本与配额

检索到的段落计入组织预算，无需知识专属账本。段落会在成员下一次模型请求中成为提示词 token，而该请求已经通过公司模型网关向 `quota` 预留额度，其预留以 `modelRef` 为键。知识检索没有模型，因此知识网关不得调用 `quota.reserve`——那样做需要编造一个 `modelRef`，并会污染模型用量账本。

因此真正的成本控制是结果上限，而不是第二块表：WeKnora 提供方的 `maxSearchResults` 和 `maxPassageChars` 决定有多少检索文本能进入提示词。本部署把它们设得很高，而这些值仍是经过校验的 `Config` 字段，觉得开销大的部署无需改代码就能调低。

<a id="deferred-full-document-reading"></a>

### 延后：阅读文档全文

第二阶段加入 `knowledge_read` 以分页读取文档全文。它是延后而不是砍掉，因为它是本设计中最大、运维代价最高的一块，而第一阶段的产品结果并不需要它：签名 `KnowledgeDocumentRef` 需要一个签名密钥凭据、一份轮换手册、一个上下界对某些会话都不合适的有效期窗口、多一条 Runner 路由、多一个审计动作，以及 `document-unavailable` 这一类失败。

第一阶段零成本地为它留门：现在就定死 `KnowledgeRef` 格式，不在 `knowledge.read` 上授予任何权限，并把该权限留在目录中。第二阶段加入签名引用、阅读路由、同一个角色编辑器中的 `knowledge.read` 授予，以及「持有搜索结果不构成持续权限」这条规则：一次阅读必须证明该引用由某个知识库签发，并再次对该知识库判定 `knowledge.read`。

## WeKnora 提供方行为

提供方配置拥有每项随部署变化的选择：数据源代码、基础 URL、API Key 凭据引用、请求超时、最大搜索结果数和最大段落字符数。凭据必须是 WeKnora 的空间 Key，而不是平台 Key：空间 Key 固定访问其所属空间，平台 Key 则能访问任意空间并通过 `X-Tenant-ID` 请求头指定是哪一个，因此持有平台 Key 的 Control Plane 可以读到本部署治理范围之外的知识。这也是提供方没有租户字段的原因——使用空间 Key 时无需指名任何租户。无效 URL、数据源代码、边界或凭据引用语法在插件加载时失败；缺失运行凭据和上游不可用使操作失败，但不公开 Secret 值。

第一阶段提供方只使用以下 WeKnora 操作：

- `GET /api/v1/knowledge-bases`，从每个条目读取 `id`、`name`、`description`、`type`、`knowledge_count`、`chunk_count`、`processing_count`、`embedding_model_id` 和 `updated_at`；
- `POST /api/v1/knowledge-bases/{id}/hybrid-search`，`SearchParams` 请求体携带 `query_text`、`match_count` 和显式非空的已授权上游 `knowledge_base_ids` 数组。

该端点有三个性质决定了提供方的写法，每一条都由针对真实部署的约定 fixture 钉住。即便请求体覆盖了范围，其路径仍要求一个知识库 id，且该 id 必须是 `knowledge_base_ids` 的成员——列表之外的路径 id 会以 `ErrNotFound` 被拒——因此提供方把一个已授权 id 放在路径上、把完整已授权集合放在请求体里，绝不让路径 id 扩大范围。`match_count` 是跨所选知识库的全局预算而非逐库预算，因此一个知识库可能占满结果集、把其余的完全挤出去。而在上下文增强开启时 `match_count` 不是硬上限：端点返回最佳命中及其父级、邻近和关联分片，因此请求十条会返回十一条。提供方保留增强，因为周边上下文正是延后的文档阅读的部分替代，并在解码之后把 `maxSearchResults` 作为硬上限强制执行。

WeKnora 会静默忽略它不认识的知识库 id：一个真实 id 与一个未知 id 混在一起的列表会以 `success` 返回，且结果只来自那个真实知识库。这使不变量 5 成为必需而非偏好——网关不能把存在性或授权判定委托给上游，上游对无法识别的范围给出的答案是一个被悄悄收窄的答案。每个引用都在构造请求之前于 Control Plane 解析并授权，其中任何一个失败都拒绝整个请求。

`hybrid-search` 不接受 `resource_urls` 参数。该参数只存在于聊天与会话端点，在那里 `public` 返回可加载直链，而这些端点都不在知识路径上。因此不变量 10 依托的是检索端点根本无法产生可加载上游 URL，而不是提供方请求它不要产生——这一立足点更强，并由一条约定测试钉住：断言任何被转发字段都不携带 `http` 或 `https` URL，因为后续 WeKnora 版本可能加入该参数或改变其默认值。第一阶段没有任何东西能兑换 `resource://` 引用，而本部署的段落中确实带有这类引用，因此提供方把段落文本中残留的引用替换为中性占位符，并丢弃 `chunk_type` 不为 `text` 的分片及其 `image_info`。

提供方转发 `content`、`score`、`knowledge_title` 和 `knowledge_base_id`，丢弃 `SearchResult` 的其余全部字段：`knowledge_filename`、`knowledge_source`、`knowledge_description`、`knowledge_channel`、`knowledge_custom_metadata`、`matched_content`、`metadata`、`chunk_metadata`、`chunk_index`、`parent_chunk_id`、`sub_chunk_id`、`match_type`、`start_at`、`end_at` 和 `seq`。保留 `knowledge_base_id` 是因为它把每条命中映射回一个 `KnowledgeRef`，使网关能够校验每条返回命中都来自它已授权的知识库——当范围是通过一个上游可自由解释的请求体字段传过去时，这个校验值得有。

提供方发送新的请求关联 id，转发取消信号，应用有限超时，验证解码后的 JSON 和必填响应字段，并通过读取 `AppError.code` 把失败映射为封闭 DSH 原因——该数值枚举的成员包括 `ErrBadRequest`、`ErrUnauthorized`、`ErrForbidden`、`ErrNotFound`、`ErrTooManyRequests`、`ErrInternalServer`、`ErrServiceUnavailable`、`ErrTimeout` 和 `ErrValidation`。它绝不转发 `AppError.message` 或 `AppError.details`。约定 fixture 依据真实部署固定每个上游路径、方法、请求头名称和读取字段，包括它实际返回的两种信封：成功为 `{ "data": …, "success": true }`，失败为 `{ "error": { "code", "message", "details" }, "success": false }`，后者把 `AppError` 嵌套在 `error` 之下，而不是像 OpenAPI 文档声明的那样平铺返回。可选真实 WeKnora e2e 在没有部署凭据时自行跳过。

WeKnora 在该字段自身的定义中就给多库检索加了前置条件：`knowledge_base_ids` 允许一次检索调用跨越多个共享同一 embedding 模型的知识库，而 API 没有为不满足该条件的集合声明任何错误。未定义的上游行为不得变成静默的产品行为，因此目录记录每个条目的 `embedding_model_id`，网关在任何上游调用之前拒绝成员不共享同一模型的多库操作，理由为封闭的 `scope-incompatible`。单库选择不受影响。`all` 模式展开为已授权集合，因此同样可能被这条规则拒绝——这正是拒绝要指名不兼容知识库、而管理页面要显示 embedding 模型的原因：成员据此收窄选择，管理员据此看到他们为何必须收窄。

## 审计与运行可见性

向 `AUDIT_ACTIONS` 添加带封闭元数据的 `knowledge.search` 和 `knowledge.catalog.sync`。搜索在授权后为每个指向的知识资源记录一行，通过现有 `itemCount` 键携带结果与有界结果数；同步记录目录管理资源、结果和条目数。拒绝使用现有封闭原因，绝不使用上游文本。

上游失败类别通过一个新的 `label` 类元数据键表达，而不是新的 `AuditReason`。这不是风格偏好：`AUDIT_REASONS` 被编译进审计表的 `CHECK` 约束，而存储用 `CREATE TABLE IF NOT EXISTS` 应用其 DDL 且没有重建路径，因此加进代码列表的原因对已有数据库会静默不生效。动作和元数据键在每次打开时由 insert 重新 seed，可以安全添加。因此上游失败以 `error` 结果加一个指名失败类别的 label 记录。

运行日志可以携带请求关联 Token、HTTP 状态类别、耗时、计数和已验证的知识引用。它们不得携带问题、段落、文件名、上游 URL、凭据或原始响应体。遥测遵循相同排除规则。

知识目录页面显示最后尝试、最后成功、数据源健康状态和本地化失败类别。它不显示原始上游错误。运维人员在 WeKnora 部署或受限基础设施日志中诊断详细上游故障，而不是使用成员工作的审计轨迹。

## 失败语义

| 条件 | Runner 可见结果 | 状态改变 |
|---|---|---|
| 无有效设备 Token | `unauthenticated` | 无 |
| 非活跃成员或已撤销设备 | `unauthenticated` | 无 |
| 无匹配授权、未知引用或资源已停用／缺失 | `not-allowed` | 仅拒绝审计 |
| 已选会话范围陈旧 | `scope-unavailable` | 无；保留选择，等待成员显式修正 |
| 所选知识库不共享同一 embedding 模型 | `scope-incompatible` | 仅拒绝审计；不发起任何上游调用 |
| WeKnora 不可用或超时 | `upstream-unavailable` | 失败审计；保留目录快照和授权 |
| WeKnora 响应畸形 | `upstream-invalid` | 失败审计；不产生部分模型可见值 |
| WAN、DNS、代理、TLS 或 Control Plane 故障 | `control-plane-unreachable` | 无；不提供陈旧私有结果 |
| Runner 协议版本不受支持 | `update-required` | 无；不处理其他请求字段或操作 |
| 取消 | `cancelled` | 仅当操作已到达受治理网关时记录取消审计 |

拒绝不区分未知资源与未授权资源。当一个请求范围未通过授权，或一个必需上游响应未通过验证时，搜索不返回部分段落。

## 管理 UI

在`资源管理`下添加随产品交付的`知识库`菜单，路由为 `/resources/knowledge-bases`，并由 `knowledge_scope|knowledge.catalog.read` 保护。页面遵循模型页面的加载／错误／写入模式和类型化本地化字典。

表格显示名称、DSH 引用、上游类型、文档数、分片数、处理中数量、embedding 模型、有效状态、远程存在状态、最后成功同步和数据源健康状态。成员持有 `knowledge.catalog.manage` 时，操作包含`刷新`和`启用／停用`。缺失条目保持可见且已停用，使管理员能够理解角色选择失效的原因。

角色行新增`知识库权限`。对话框显示`无`、`全部已启用知识库`和`选定知识库`；选定模式显示持久化目录，并停用缺失条目，同时保留已经选中的缺失行供检查。对话框说明多个角色取并集，而且该选择只授予检索——不授予阅读、下载或管理权限。

每条产品文本、可访问性名称、空状态、错误、确认和工具卡片标签都归本地化字典所有。改变用户可见 GUI 行为的 PR 按仓库浏览器 GIF 工作流，从 PR 的真实服务器与模型流程录制 GIF。

## 交付计划

使用依赖 PR stack 交付本功能。底层分支不包含 UI 依赖，每个分支都通过自身聚焦检查。

### PR 1 — 领域、权限和会话词汇

- 添加 `packages/knowledge` 组及其双语组 README、两份 `packages/README` 中的条目，以及一个被链接的 `docs/subsystems/` 页面；新组不得静默继承子系统页豁免。
- 添加 `knowledge` Service Definition、品牌化引用、请求与结果类型、可区分失败、与配置无关的验证器和包文档。
- 按审计 token 规则校验 `KnowledgeRef` 的长度与字符集，并证明过长的数据源代码在加载期失败。
- 使用 `knowledge.catalog.read` 和 `knowledge.catalog.manage` 扩展权限目录；暂不注册路由。
- 添加带显示名称快照的版本化 `knowledge/scope` 事件、投影单元、TypeScript 与 Python SDK 投影、预期输出和折叠测试。
- 证明畸形引用、未知联合分支、无效范围载荷、fork／rewind 投影和默认 `off` 行为。

### PR 2 — WeKnora 提供方与受治理目录

- 添加 `knowledge-weknora` 和 `knowledge-gateway-sqlite`、SQLite schema、数据源配置、凭据解析、同步对账和访问控制受治理资源注册。
- 为列表和显式范围混合检索添加依据真实部署响应固定的上游约定 fixture；拒绝每个未注册路径和畸形响应。
- 证明上下文增强返回多于 `match_count` 时提供方自行截断，且未知引用在 Control Plane 被拒绝，而不是交给会忽略它的上游。
- 证明成员不共享同一 embedding 模型的多库请求在任何上游调用之前被拒绝，且单库请求不受影响。
- 添加类型授权、资源授权、多角色并集、已停用／缺失资源、整请求拒绝、当前策略修订和角色改变后下一次调用的授权测试。
- 证明在 `all` 模式类型授权下，管理目录资源绝不会作为可检索知识库返回。
- 添加审计动作项和上游失败 label 键，并证明问题、段落、文件名、URL 和原始错误无法满足或进入审计 schema。
- 添加可选且自行跳过的真实 WeKnora e2e，不让 CI 依赖私有部署。

### PR 3 — Control Plane HTTP 与管理 API

- 添加带 Bearer Token 验证、在任何其他字段之前判定知识自有 `protocolVersion`、严格请求解析、有界请求体、取消、稳定拒绝映射且无任意代理字段的 Runner 端点。
- 添加管理目录／同步／启停路由和精确的角色知识授权替换。
- 在 Control Plane 启动时注册目录管理资源，并为其特殊资源更新已持有权限投影。
- 向 `team-control-plane` 插入提供方、目录、网关、凭据和 HTTP 配置项，改正预留的「Knowledge MCP Gateway」注释，同时保留每条无本地执行组合断言。
- 使用账户、设备授权、访问控制、审计、伪 WeKnora、已撤销 Token、角色改变、协议不匹配、反向代理路径保留和上游失败测试真实 HTTP 组合。
- 记录单个活动 3095 进程、持久卷备份、TLS 终止、代理超时和请求体限制、同主机回环 WeKnora 可达性及企业证书配置。

### PR 4 — Runner 提供方、工具与模型看到什么

- 添加逐操作读取 Token、自有经校验 `controlPlaneUrl`、协议版本上报、Control Plane 响应验证和封闭离线错误的 `knowledge-team`；在 `team-account-client` 之后把它插入 `team`。
- 添加 `tool-knowledge`、原生渲染、规范输出、展示元数据、取消、工具 UI 设计和工具描述。
- 添加带新章节顺序槽位的 `knowledge:scope` 提示词章节，并证明 `off`、`all`、`selected` 各自仅凭日志渲染出预期文本。
- 通过 agent 作用域上的 `tools.restrict()` 添加范围驱动的工具可见性，并证明恢复会话时在 agent 构造期施加、范围变化时重新施加。
- 在现有 headless 泳道用 stub 知识提供方添加无 Key 录制会话快照，覆盖 `off` 不可见、`selected` 搜索输出、截断、空结果、拒绝以及范围事件的 fork／rewind。
- 更新 `apps/team-runner-desktop`，使生成的 profile 补丁携带知识配置项的 `controlPlaneUrl`，并使产物携带一个公司来源与 Runner 版本、不含 WeKnora 设置、3090 仅绑定回环。
- 更新工具目录、包 README、模型体验章节、部署指南、配置目录和 Team bundle 组合测试。

### PR 5 — `/knowledge`、API 远程、管理页面与角色编辑器

- 添加带已授权目录与范围选择远程的 `packages/api/knowledge-controller`，只由 `team` bundle 挂载。
- 添加随产品交付的菜单条目、知识目录页面、同步／启停操作、角色知识编辑器、类型化 API 模型和本地化文本。
- 添加 `ui-knowledge` 指令装饰、已授权目录加载器、多选器、投影驱动输入框 Chip、陈旧选择状态、重连刷新和权限驱动控件可见性。
- 为 `off` 默认、选定、全部、陈旧、撤权、缺失、同步失败和角色并集行为添加浏览器组件测试与组装 e2e。
- 从 PR 的真实服务器与模型／工具流程录制要求的 GIF。
- 只在交付行为可观察后更新用户与管理员文档。

### Stack 完成

每个分支发布或重写后，针对该分支待推送 diff 运行仓库预推送选择工作流。落地前使用仓库 stacked-PR 工作流，把同仓依赖保持在官方 stack 中，从底部开始合并，并让 GitHub 重定向剩余分支。

## 验证矩阵

| 关注点 | 必需证据 |
|---|---|
| 引用和协议验证 | 聚焦单元测试，覆盖每个无效判别字段、额外字段、畸形 Token、超长数据源代码和响应不匹配 |
| RBAC | 真实访问控制提供方测试，覆盖无／全部／选定、多角色并集、资源停用、账户停用、设备撤销、即时授权撤销，以及管理目录资源绝不作为知识库出现 |
| 目录持久性 | SQLite 重启、重命名、缺失、重新出现、手动停用、同步失败、并发同步和跨存储对账测试 |
| 上游兼容性 | 确定性伪 WeKnora 约定套件，覆盖两种响应信封、`resource://` 引用、非文本分片、混合 embedding 模型、错误码、静默忽略未知知识库的上游、增强超出 `match_count`，以及任何被转发字段都不携带 http(s) URL，加可选凭据 e2e |
| Runner Transport | 真实设备 Access Token 流、逐操作 Token 刷新、严格响应解码、取消，以及捕获请求中无上游凭据／地址 |
| 远程部署 | 3090 仅绑定回环、向打包指定的 3095 来源发送出站 HTTPS、协议 `426`、反向代理路由／状态／取消保留、TLS 失败、超时和重连测试 |
| 桌面打包 | macOS arm64 与 Windows x64 产物元数据包含一个 Control Plane 来源和 Runner 版本、不含 WeKnora Secret 或端点，并使用既有签名更新路径 |
| 模型可见行为 | headless 泳道用 stub 提供方的无 Key 录制会话快照：`off` 工具不可见、各模式提示词章节文本、搜索输出、截断、空结果和拒绝 |
| 会话持久性 | 折叠、恢复、fork、rewind、压缩／回放兼容性、TypeScript SDK 和 Python SDK 预期输出 |
| 管理安全 | 浏览器会话、同源、CSRF、路由权限、陈旧写入，以及隐藏控件不等于权限的测试 |
| GUI 行为 | 组件测试、组装浏览器 e2e、本地化门禁、可访问性查询和真实流程 GIF |
| 包与文档 | 聚焦包测试、类型检查、lint、发布路径构建冒烟、manifest 改变时的 hygiene、子系统页与组 README 门禁、`test:docs`、`doc-sync` 和 `git diff --check` |

两个角色对同一查询得到不相交结果，由网关的访问控制测试证明，而不是由录制会话快照证明。快照语料只有 `acp`、`sdk`、`session` 和 `web` 四条泳道，没有 Team 泳道，而把无 Key Control Plane、预置角色、已绑定设备和伪 WeKnora 立进那套 harness 是它自己的工程。快照泳道证明模型看到什么；网关测试证明谁被允许看到。

实现只报告实际运行的命令。除非确实运行，否则不声称完整测试套件通过；CI 负责穷尽覆盖率和平台矩阵。

## 验收标准

- Team Runner 启动时内置知识工具和 `/knowledge`，无需安装或配置任何外部 WeKnora 插件。
- 新会话从`关闭`开始，`knowledge_search` 不在模型工具列表中，在成员选择范围之前没有任何知识请求离开这台电脑。
- 做出 `selected` 选择后，系统提示词恰好写出会话日志中记录的知识库名字，之后管理员重命名不会改变该已记录会话的提示词。
- 打包的 3090 Runner 只监听回环地址，只通过经过校验的 HTTPS 向分配的远程 3095 来源发送出站知识请求，并且不要求 Control Plane 向其建立入站路由。
- 桌面产物标识一个公司 Control Plane 来源和 Runner 版本，同时不包含 WeKnora 地址、凭据、租户或可独立编辑的知识网关。
- WeKnora 只能通过 Control Plane 主机的回环接口访问，不存在成员可达的网络路径。
- 每个面向 Runner 的知识端点在解码其他操作字段或执行任何操作前，以既有需要升级响应拒绝不受支持的协议版本。
- WAN、DNS、TLS、代理或 3095 不可用时返回封闭不可用结果，绝不提供缓存的私有段落；重连会触发当前目录和授权检查。
- 捕获的 Runner 配置、凭据、请求、工具结果和浏览器状态都不包含 WeKnora API Key 或可调用的上游 URL。
- Control Plane 目录镜像成功的 WeKnora 列表，在重命名时保留身份，对确认缺失的条目停用但不删除授权，并在同步失败后保留最后成功快照。
- 只有持有 `knowledge.catalog.read` 的主体才能在管理页面列出目录状态；每个修改操作独立强制其写权限、同源证明和 CSRF 证明。
- 角色保存为无、全部或选定后，恰好持有所述的 `knowledge.search` 授权，在 `knowledge.read` 上不持有任何授权，其他权限保持不变，且多个角色取并集。
- 管理目录资源绝不会作为可检索知识库返回给 Runner，包括持有 `knowledge_scope` 上 `all` 模式类型授权的角色。
- 两个持有不相交选定授权的主体针对同一查询形式获得不相交的目录和搜索结果；同时持有两个角色的主体获得并集。
- 显式未授权或未知知识引用会拒绝完整请求，不确认其存在，也不返回已授权的部分结果。
- 成员不共享同一 embedding 模型的多库检索在任何上游调用之前被拒绝，不为它产生任何工具结果、段落或上游 URL。
- `/knowledge` 在会话日志中持久化关闭、全部、选定，支持恢复／fork／回放，不能扩大当前权限，并报告陈旧选择而不是静默改变它。
- 搜索审计行只包含身份、受治理资源、操作、结果、有界计数和关联信息；测试证明成员内容与上游详情在结构上不可接纳，且未引入任何新的 `AuditReason`。
- 检索到的段落通过下一次请求上既有的模型预留计费，知识网关自身不持有任何配额预留。
- Control Plane 组合配置项不挂载新的 Agent、文件系统、Shell、子进程、沙箱、代码运行时或其他本地执行能力。
- 生产部署文档要求 TLS、具有持久备份卷的单个活动 SQLite 3095 实例、反向代理限制，以及 Control Plane 主机上仅回环的 WeKnora。
- 面向模型的行为有无 Key 录制会话快照，两个 SDK 投影覆盖新会话事件，用户可见 GUI 行为有组装 e2e 证据和要求的 GIF。
- 提案转为 implemented 时重新记录完整双语文档配对，而且 implemented Agent Note 描述实际交付的包和协议，不保留本交付清单。

## 考虑过的替代方案

**在每个 Runner 安装外部 WeKnora 插件并设置角色特定默认值。** 不予采纳，因为默认值是调用方可覆盖的范围选择，API Key 会到达成员进程，而且撤权将依赖配置或凭据轮换，而不是下一次访问判定。

**只添加 `/knowledge` 指令。** 不予采纳，因为指令负责发现和会话偏好，不是检索实现或权限边界。agent 仍需要面向模型的工具，网关必须在不依赖指令的情况下强制每个操作。

**在浏览器隐藏未授权知识库。** 不予采纳，因为其他插件、模型或构造请求可以绕过浏览器状态。UI 过滤仍然有用，但绝不批准操作。

**会话默认自动使用知识。** 不予采纳，改用显式 `off` 默认。自动检索会为与公司知识毫无关系的问题搜索每一个已授权知识库，把延迟和提示词预算花在没人要的段落上，而且会在成员从未表达该意图的情况下让私有内容进入模型请求。`all` 作为显式选择保留下来，真想要广度的成员说一次即可，不必勾十二个复选框。

**把范围选择放进用户设置，让新会话继承。** 不予采纳，因为那会在会话日志之外制造第二个状态源，日志将不再足以重建模型看到过什么。每个会话选一次，是让 fork、rewind 和回放保持完全可派生的代价。

**范围为 `off` 时仍注册 `knowledge_search`。** 不予采纳，因为一个永远可见却总是拒绝的工具会在每次请求上消耗 schema token，并诱发成员从未要求的被拒调用。工具可见性遵循与提示词章节相同的折叠，因此两者回答同一个关于会话的问题。

**在装配时解析当前目录，从而在提示词中写出知识库名字。** 不予采纳，因为那些名字会是会话日志并不持有的模型可见输入，破坏「模型可见即已记录」规则，并让回放会话的提示词依赖 Control Plane 的当前状态。把名字快照进事件的代价是重命名后出现陈旧名字，而这只在已记录的会话中可见。

**第一阶段就交付 `knowledge_read`。** 是延后而非否决。它是本设计中运维代价最高的部分——一个签名密钥、它的轮换，以及一个对某些会话总有一端不合适的有效期窗口——而第一阶段的产品结果仅靠检索段落即可满足。现在定死 `KnowledgeRef` 格式可以让第二阶段不必返工身份。

**按 embedding 模型分组扇出多次检索并合并结果。** 第一阶段不予采纳，因为不同 WeKnora 检索调用的分数各自在自己的 rerank 内归一化，跨调用不可比较，合并会造出一个提供方从未产生过的排序。它还与整请求规则冲突：成员问一个问题，得到的会是被静默重排的并集，而不是网关能够解释的结果。拒绝把问题指到管理员能够修复的地方。

**在知识网关中对检索计入 `quota`。** 不予采纳，因为 `ReservationRequest` 以 `modelRef` 为键，而知识检索没有模型；合成一个 ref 会污染模型用量账本。段落已经在随后的模型请求中作为提示词 token 计费，第二块表只会把已经算过的东西再算一遍。

**为上游失败类别新增 `AuditReason`。** 不予采纳，因为 `AUDIT_REASONS` 被编译进通过 `CREATE TABLE IF NOT EXISTS` 应用的 `CHECK` 约束，新原因不会到达已有数据库，失败还会是静默的。`label` 类元数据键在每次打开时重新 seed，并承载同样的封闭词汇。

**让知识路由共用设备绑定的 `protocolVersion` 常量。** 不予采纳，因为那会耦合两个独立演进的协议：只涉及知识的变更会顶高绑定版本，抬高知识最小值还会把老 Runner 一并挡在绑定之外。知识拥有自己的版本，并复用既有拒绝词汇。

**从 `teamAccountClient` 读取 Control Plane 来源，而不是第二个配置字段。** 不予采纳，因为账户客户端并不公开它的来源，而公司模型 Transport 本就携带自己经过校验的字段。桌面安装器生成的补丁是写入所有配置项的唯一位置，唯一事实来源应当在那里。

**在 `knowledge-weknora` 内依赖外部 WeKnora 客户端包。** 不予采纳，因为它会成为持有公司凭据的进程中唯一的非 `@deepseek-ai` 运行时 scope，而第一阶段固定的两端点面比包装它的客户端还小。

**在 Control Plane 挂载完整外部插件。** 不予采纳，因为 Control Plane 有意不具备 Agent 或工具注册表，也不得获得其中任何一项。它挂载固定上游提供方和受治理 HTTP 服务，而不是面向模型的工具。

**公开透明 WeKnora 反向代理。** 不予采纳，因为任意路径和字段会让 Runner 选择权限目录和审计词汇未治理的操作。DSH 协议明确列出精确操作和字段。

**让 WeKnora 自定义 agent 选择知识库。** 第一阶段不予采纳，因为服务端选择可能扩大到 DSH 判定之外，可恢复聊天会话还需要独立的主体与范围所有权。后续提案只有在提供显式已授权 id 和 DSH 自有会话句柄时，才能加入成稿回答。

**知识库从上游消失时删除目录和授权。** 不予采纳，因为一次失败或不完整的列表会造成不可逆策略丢失。缺失只停用访问；未来的显式清理负责删除。

## 风险

- 使用不同 embedding 模型创建的知识库无法一起检索，部署中一旦出现这样的集合，持有宽泛权限的角色使用 `all` 模式就会被拒绝。管理页面公开 embedding 模型使其可诊断，但让公司的知识库保持同一个 embedding 模型是 DSH 无法强制的部署纪律。
- WeKnora 已发布的 API markdown 与部署的 OpenAPI 文档不一致：markdown 描述了一个本构建并不提供的顶层 `POST /knowledge-search`，其搜索结果少列了部署实际返回的字段，而部署的失败信封把 `AppError` 嵌套在 `error` 之下，并非平铺返回。fixture 依据部署自身的文档固定，具名升级负责人在每次 WeKnora 升级时重读该文档，而不是上游仓库的散文。
- WeKnora API 可能独立变化。约定 fixture 和可选真实 e2e 能检测漂移，但提供方仍需要明确升级负责人。
- 目录和 `all` 模式授权会为每个知识库执行一次判定。这对初始完整列表部署可接受；未来批量访问控制操作必须保留逐资源判定和策略修订语义，不能一次授权后执行多个操作。
- 用已记录显示名称构建的提示词章节会在重命名后陈旧。引用保留含义，UI 显示当前名字，但长期运行的会话其提示词可能用一个管理员已经认不出的名字称呼某个知识库。会话长度是实际上界。
- 会话中途变化的工具可见性，会改变模型在轮次之间看到的工具列表。提供方能够容忍这一点，但读到过更早轮次工具列表的模型仍可能发起调用；本地拒绝仍是兜底。
- 独立 SQLite 数据库无法原子提交目录和访问控制变更。幂等对账修复中断写入，而一个请求在下次对账前可能短暂看到较早状态。
- 成员仍可能通过 DSH 之外的凭据或网络路径直接访问 WeKnora。把 WeKnora 运行在 Control Plane 主机的回环接口上，为本部署关闭了网络路径；未来若把两者拆到不同主机，在恢复等效限制之前该路径会重新打开。DSH 无法撤销 WeKnora 独立授予的权限。
- 返回私有原文段落会提高模型上下文敏感性。本部署有意把结果和段落上限设得很高，因此提供方与模型的数据处理策略比 RBAC 承担了相对更重的分量。
- 远程 3095 延迟和暂时 WAN 故障可能使本地 3090 工具调用变慢或不可用。有限端到端截止时间、取消转发、封闭离线结果和不回退到陈旧内容使行为保持明确。
- 企业代理、私有证书颁发机构、DNS 策略和反向代理超时因部署而异。实现需要经过测试的配置点与运维诊断，同时不能引入证书校验绕过。
- 由于客户端升级可能晚于服务器，桌面与 Control Plane 版本可能漂移。协议优先的 `426` 处理和签名平台产物会在执行任何知识操作前明确所需升级。
- SQLite 目录与访问控制文件使首个 3095 部署仅限使用持久存储和备份的单个活动实例。横向副本需要后续共享数据库和同步设计，而不能复制这些文件。
- 包 stack 范围较广，还新增一个包组，带来自身的 README、子系统页和逐文件覆盖率义务。按领域、提供方、HTTP、工具和 UI 排序 PR 能缩小评审范围，但在 Control Plane 强制和 Runner 路径都存在前，本功能不得暴露。
