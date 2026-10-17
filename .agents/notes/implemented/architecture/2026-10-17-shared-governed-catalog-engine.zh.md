# Agent Note: One governed catalog engine and one governed wire for knowledge, BI, and GMO

Status: implemented

[English](2026-10-17-shared-governed-catalog-engine.md) | 中文

## Problem

知识库、BI 与 GMO 三种能力各自发布了同一份 Control Plane 目录：一张 SQLite 表记录数据源所治理的内容，一套把每行注册为 access-control 资源的对账，一次逐操作的访问判定，以及一条审计记录。它们还各自发布了同一组 Runner 端点：先于身份检查版本的请求开启、封闭的拒绝信封，以及把每种失败映射为封闭词的设备令牌调用。BI 复制知识库，GMO 复制 BI，是有意为之，这样新增一种能力不必编辑别人已发布的包（[GMO 提案](../../proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)记录了这一选择）。克隆检测器报告了 42 处涉及这三个家族的克隆，其中 14 处在 SQLite 网关之间；对账或授权的一处修复必须落三遍，除了评审没有任何东西保证三份副本保持一致。

## Decision

两个包拥有共用代码。凡是指名表、词、路径或字段的内容，仍留在能力里。

`dsh-governed-catalog-sqlite`（`packages/access/governed-catalog-sqlite`）持有 `GovernedCatalog` 类。能力用一个 `GovernedCatalogSpec` 构造它：表名、引用列、受治理资源类型、审计动作与失败键、新发现的条目是否以启用状态开始、列表写入的列，以及五个把能力自己的类型映射到目录行的函数。该类拥有数据库的打开与 pragma、并发同步的合并、写入任何东西之前先描述每个列出的条目、先于行撤下被丢弃的条目、在一个事务里写入列表、注册资源、数据源状态、准入、授权列表与审计记录。`applyCatalogSchema` 是版本与 application id 检查。每个网关保留自己的 DDL、行类型、`applySchema` 与各操作。

`dsh-team-governed-wire`（`packages/team/team-governed-wire`）持有 Runner 传输的两端。`governedHandler` 按固定顺序（方法、请求体上限、版本范围、设备令牌）开启一个 POST，在失败处理之外运行能力的解码函数，所以本构建读不懂的字段是 400，并通过能力的原因映射来应答失败。`governedClient` 带着当前令牌提交版本与字段，并把失败的 fetch、不是 JSON 对象的响应体、不认识的拒绝词与读不到的令牌映射为能力自己的错误。`COMMON_REFUSAL_STATUS` 拥有所有能力共用的八个拒绝词及其状态；各能力把自己的词加到一份副本里。

三个家族的 `*-gateway-sqlite`、`*-gateway-http` 与 `*-team` 包委托给这两个包。本次变更保持每张 SQLite 表与列、application id 与 schema 版本、路由路径与协议版本、权限、审计动作与 metadata 键、错误信息以及对模型可见的字符串不变。`startsEnabled` 仍是各能力自己的值，因为知识库与 BI 以启用状态开始，GMO 以停用状态开始。Control Plane 的各包引用 `dsh-team-governed-wire`，它不含 `node:sqlite` 的导入，所以为取路径常量而引用 HTTP 包的 Runner 不会加载 SQLite 引擎。

## Recorded evidence

三个家族现有的测试套件不加改动全部通过：变更前后都是 29 个文件、1,115 个测试。两个新包带着自己的测试套件，语句、分支、函数与行覆盖率均为 100%。同一棵树上，`pnpm run duplication` 从 64 处克隆降到 40 处。涉及这三个家族的克隆从 42 处降到 17 处：SQLite 网关之间的 14 处全部消失，HTTP 网关从 11 处降到 2 处，Runner 提供方从 4 处降到 2 处。

## Alternatives considered

**三个网关共用一个基类。** 每个网关都继承自己的 Service Definition（`KnowledgeGateway`、`BiGateway`、`GmoGateway`），后者带有能力的各个操作与 Cordis 服务键。再加一个基类需要多重继承，所以引擎以组合方式持有。

**SQLite 引擎与传输放进一个包。** Runner 为取路径而引用 HTTP 包，单一入口会在 Runner 上加载 `node:sqlite`。`.` 之外的包入口在本仓库需要特殊的发布处理，所以两个包是更小的变更。

**把 Runner 调用放进 `dsh-team-account-client`。** 该包拥有 fetch 与令牌，所以调用放在那里合适。但 Control Plane 端在那里没有归处，而且两端重复着同样的事实（承载令牌的请求头、版本检查、拒绝信封）；放在一起让每个事实只有一个归属。

**把目录做成抽象存储，SQLite 只是其中一个提供方。** 现在只有一个后端，也没有计划中的第二个。只有一个实现的接缝要付出一个 Service Definition 与一个提供方包的代价；带 SQLite 字样的名字 `governed-catalog-sqlite` 说明了机制，等出现第二个后端时再拆分。

**同时抽取 Typert 控制器与输入框控件。** Typert 生成器要求每个控制器都是有自己构造函数与装饰方法的具体 `TypertRemoteService`，所以控制器无法共用基类，而且它们的传输类型按名称区分是有意的（`categoryRef`、`projectRef`、`knowledgeRefs`）。它们共有的 `parseRequest` 同样存在于 office 与 settings 控制器里，这使它成为整个 Typert 的辅助函数。输入框控件共用的触发器也在 `ui-office` 里，这使它成为一项带有自己的 locale 与 CSS 归属的客户端原语变更。两者都是各自独立的变更。

**保留副本，并让测试互相比对。** 比对三份同一规则实现的测试，发现的是分歧发布之后的事；共用的类则让分歧不会发生。

## Consequences

- 对账、准入、审计记录、请求开启或拒绝解码的一处修复只落一次，就同时到达知识库、BI 与 GMO。新的受治理能力只需提供一个 spec 与一份协议，而不是第四份副本。
- 能力的表名与列名由引擎写入 SQL 文本。它们来自能力里的常量，从不来自请求数据；引擎 README 写明了这一点。
- BI 与 GMO 目录里原本带覆盖率豁免的旧 schema 拒绝（只有版本提升之后才可达）现在由引擎自己的测试套件执行。
- 剩下的 17 处克隆是 Typert 控制器（四处）、输入框控件（五处）、BI 与 GMO 的 `scope` 折叠、两个数据源提供方 `bi-webi` 与 `gmo-excel-tools`（两处）、HTTP 网关的插件 `Config` 样板（两处，其中一处与网页搜索网关共有）、Runner 提供方的构造函数（两处），以及 `knowledge-weknora` 内部的一处。
- `dsh-web-search-gateway-http`、`dsh-model-gateway-http` 与 `dsh-team-release-http` 仍带着自己的请求开启；让它们迁到传输包上是可行的，但不属于本次决定。
