# BI 分析

[English](bi.md) | 中文

BI 分析接缝——一个横跨**三个操作**（项目目录、图表列表与图表执行）、位于同一个 `ctx.bi` 服务上的[能力接缝](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)。Service Definition 是 [dsh-bi](../../packages/bi/bi)；它的 Team 提供方和面向模型的工具随 [Control Plane BI 能力](../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.zh.md)一起到来。BI 是**一个可选能力**，不属于 agent-loop 主干，因此它的词汇在这里，而不在 [core.zh.md](core.zh.md)。

接缝命名产品操作，绝不命名上游操作。持有 `ctx.bi` 的 Runner 无法指名地址、凭据、自己的查询或上游项目与图表 id，因为没有任何操作为它们留下位置。正是这一点，使受治理的部署能够把每一个 BI 判定——哪位成员、哪台设备、哪个项目、此时此刻——放在成员自己的进程绕不过去的服务背后。

来源：[`packages/bi/bi/src/types.ts`](../../packages/bi/bi/src/types.ts)

## 命名一个项目

`BiProjectRef` 是 `<providerKind>:<sourceCode>:<upstreamId>`——例如 `webi:prod:55d61de1-ed86-4ad4-b96e-205114de5245`。它是项目跨上游重命名的身份，也是唯一会离开 Control Plane 的项目标识符。其中的上游 id 只对铸造它的提供方有意义；Control Plane 之外没有任何东西能把引用还原成上游地址。

三条上界成立，且三条都在构造引用处失败，而不是在使用引用处：

| 上界 | 取值 | 原因 |
|---|---|---|
| 引用长度 | 64 个字符 | 审计存储的 `resource_id` 遵循 `AUDIT_TOKEN`；更长的引用是任何操作都无法记录的引用 |
| 分段字符集 | 字母、数字、`. _ @ -` | 审计 token 字符集去掉分隔分段的 `:`，以及分隔图表与其项目的 `/` |
| 数据源代码长度 | 19 个字符 | 私有知识推导出的上界，两边保持相等，让一个部署的数据源代码同时服务两个目录 |

`formatBiProjectRef` 抛出 `InvalidBiRefError` 并指名是哪条上界失败。`parseBiProjectRef` 则回答 `undefined`，因为它的调用方——wire 解码器、日志读取器、存储行验证器——是在决定是否接受一个值，而不是在诊断它。

来源：[`packages/bi/bi/src/brand.ts`](../../packages/bi/bi/src/brand.ts)

## 命名一张图表

`BiChartRef` 是一个项目引用、一个 `/` 和上游图表 id——`webi:prod:55d61de1-…/aa064703-…`。它是独立的品牌而不是更长的 `BiProjectRef`，因为两者受不同的东西约束：项目引用必须装进审计 token，而图表从不是审计资源。对图表的操作所记录的是它所属的项目，那也正是授权所命名、管理员所停用的对象。

图表 id 以同一套字符集限制在 64 个字符内。`formatBiChartRef` 抛出 `InvalidBiRefError`；`parseBiChartRef` 返回 `undefined`，理由与它的项目对应物相同。`projectRefOf` 与 `upstreamChartIdOf` 无需再次解析就能拆开一个已证明的引用。

## 会话 BI 范围

会话分析哪个项目，作为 `bi/scope` 记录在会话日志中——一个版本化的整值替换，最后一条生效：

```ts
import { BiProjectRef, type BiScope } from '@deepseek-ai/dsh-bi'

const ref = BiProjectRef('webi:prod:55d61de1-ed86-4ad4-b96e-205114de5245')

export const off: BiScope = { version: 1, mode: 'off' }
export const selected: BiScope = {
  version: 1,
  mode: 'selected',
  project: { ref, displayName: 'Demo YH' },
}
```

没有该事件的日志折叠为 `off`，因此每个会话都以 BI 不可用开始，并保持到成员做出选择为止。`foldBiScope(events, end?)` 执行该折叠；可选的 `end` 折叠一个前缀，这正是 rewind 和 fork 读取日志在某一点所说内容的方式。`projectOf` 回答记录的项目，`off` 时回答 `undefined`。

范围在两个层面上都是模型可见输入——它决定写出所选项目的提示词段落，也决定 BI 工具是否被提供——因此它存在于日志中，且仅存在于日志中。这也是 `selected` 分支在引用旁记录显示名的原因：只能把日志持有的名字告诉模型。这个名字是选择那一刻的快照，因此之后重命名项目不会改变已记录会话的提示词所说的内容，而 composer 控件则从已授权目录解析当前名字。

范围命名一个项目或不命名。没有表示“全部项目”的分支，因为不同项目的图表回答互不相关的问题，一个对话分析一个项目；需要另一个项目的对话改变其范围。

范围只会收窄当前授权。它从不添加项目，过期或伪造的引用仍会到达一个无法从会话日志扩大的授权判定。

来源：[`packages/bi/bi/src/scope.ts`](../../packages/bi/bi/src/scope.ts)

## 目录、图表与执行

`catalog()` 回答当前主体此刻可分析的项目——引用与显示名。它是按权限成形的视图，不是存在之物的清单：主体一无所有的项目是缺席的，而不是被标记的。

`charts()` 回答一个项目已保存图表的一页，每张都是携带受治理引用、名称、空间、描述、类型和最近更新的 `BiChartSummary`。可选的关键词只保留名称、空间或描述含有它的图表。页只在数据源给出时才报告 `total`；缺失表示“数据源没说”，不得读作零。

`query()` 按保存时的样子执行一张已保存图表并回答一个 `BiQueryResult`：按行顺序排列的字段、作为一行文本的已保存筛选、作为原始单元格的行、数据源报告的行数，以及行或单元格是否被截断。请求携带行数上限，别无其他——调用方自己的筛选、参数、排序或 SQL 都到不了数据仓库。图表所属项目每次调用都从数据源解析并授权，因此来自其他项目的图表引用在读取任何行之前就被拒绝。

没有操作返回部分答案。无法授权的目录、被拒绝项目上的列表、被错放图表上的执行都会抛出，因为悄然收窄的结果对读取它的模型而言与正确结果无法区分。

## 失败

每个失败都是携带封闭集合中一个原因的 `BiError`，因此 Runner、工具结果和 UI 无需解析消息就能区分“重新登录”、“找管理员”和“稍后重试”。

| 原因 | 含义 |
|---|---|
| `unauthenticated` | 没有有效设备令牌、成员未激活或设备已吊销 |
| `not-allowed` | 没有授权允许该操作，或指名的项目未知或已停用 |
| `scope-unavailable` | 对话的项目已不在主体的已授权目录中 |
| `chart-unavailable` | 数据源没有这张图表，或它已不属于对话的项目 |
| `query-failed` | 数据源执行了图表而数据仓库拒绝或出错 |
| `upstream-unavailable` | BI 服务未及时应答或完全没有应答，或拒绝了凭据 |
| `upstream-invalid` | BI 服务应答了此构建无法读取的内容 |
| `control-plane-unreachable` | 从这台电脑无法抵达 Control Plane |
| `update-required` | Control Plane 拒绝该操作的协议版本；它仍然服务的操作照常工作 |
| `cancelled` | 调用方中止了操作 |

`not-allowed` 有意同时覆盖未知引用与未授权引用，这样拒绝永远不会向一无所有的主体证实项目存在。任何上游响应正文都到不了这些原因：原因就是产品界面收到的全部诊断。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbi--bi-abstract-seam"></a>

### `ctx.bi` — `Bi` (abstract seam)

BI analysis, as a Runner sees it. A provider mounts this service; consumers inject `bi`.

Every method fails with BiError carrying a closed reason. None returns a partial answer: a directory that could not be authorized, a listing on a refused project, and a run on a chart outside its project all raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

```ts cordis-catalog
/**
 * The projects the current principal may analyze right now.
 * @param signal - aborts the operation.
 * @returns the authorized directory, empty when the principal holds nothing.
 * @throws {BiError} when the principal cannot be established or the directory cannot be read.
 */
abstract catalog(signal?: AbortSignal): Promise<readonly BiProjectEntry[]>

/**
 * One page of the saved charts in one authorized project.
 *
 * The project is authorized on this call, like every other operation: a
 * reference that was in the directory a moment ago is not standing
 * permission to list it now.
 * @param request - the project, an optional keyword, and which page.
 * @returns the page, empty when the project holds no matching chart.
 * @throws {BiError} when the project is refused or the upstream does not answer usably.
 */
abstract charts(request: BiChartsRequest): Promise<BiChartPage>

/**
 * Run one saved chart as it was saved and answer its rows.
 *
 * The chart's project is resolved from the source and authorized on this
 * call, and a chart the source places in another project is refused before
 * any row is read: holding a reference proves nothing.
 * @param request - the chart, and the most rows the caller wants.
 * @returns the chart's definition summary, its fields, and its bounded rows.
 * @throws {BiError} when the project is refused, the chart is unknown or
 * misplaced (`chart-unavailable`), the warehouse fails (`query-failed`), or the
 * upstream does not answer usably.
 */
abstract query(request: BiQueryRequest): Promise<BiQueryResult>
```

Source: [`packages/bi/bi/src/index.ts`](../../packages/bi/bi/src/index.ts)

<a id="ctxbigateway--bigateway-abstract-seam"></a>

### `ctx.biGateway` — `BiGateway` (abstract seam)

The governed catalog and the decision in front of it. A provider mounts this service; consumers inject `biGateway`.

Administration methods take an organization because an administrator has already been authorized by the route that called them. Member-facing methods take a principal because they authorize it themselves, per project, on every call.

```ts cordis-catalog
/**
 * Reconcile the durable catalog against one successful full listing.
 *
 * Serialized: concurrent callers join the operation already in flight rather
 * than racing two reconciliations over the same rows. A source that does not
 * answer leaves the last successful snapshot in place and records the
 * failure, because one failed listing must not disable every project an
 * organization governs.
 * @param orgId - the organization whose catalog is reconciled.
 * @returns the catalog as it stands after the attempt, successful or not.
 */
abstract sync(orgId: OrgId): Promise<BiCatalogView>

/**
 * Read the durable catalog without contacting the source.
 * @param orgId - the organization to read.
 * @returns every governed entry and the source's health.
 */
abstract catalogView(orgId: OrgId): Promise<BiCatalogView>

/**
 * Switch one entry on or off for the whole organization.
 *
 * Synchronization never overrides this choice: an administrator who disabled
 * a project finds it still disabled after the next listing.
 * @param orgId - the organization the entry belongs to.
 * @param ref - the entry to change.
 * @param enabled - whether it may be analyzed at all.
 * @throws {BiError} `not-allowed` when the catalog holds no such entry.
 */
abstract setEnabled(orgId: OrgId, ref: BiProjectRef, enabled: boolean): Promise<void>

/**
 * The projects this principal may analyze right now.
 * @param principal - who is asking, from a verified token.
 * @returns the authorized directory, empty when the principal holds nothing.
 */
abstract directory(principal: BiPrincipal): Promise<readonly BiProjectEntry[]>

/**
 * Authorize one chart listing and perform it.
 *
 * The project is evaluated on this call, as a run's is. A member who may
 * run a project's charts may see which charts are in it: the decision is
 * the same permission, asked separately so it can be tightened without a
 * new authorization path.
 * @param request - who is asking, which project, a keyword, and which page.
 * @returns the page, with the charts addressed by governed references.
 * @throws {BiError} with the reason the operation was refused or failed.
 */
abstract charts(request: GovernedChartsRequest): Promise<BiChartPage>

/**
 * Authorize one chart run and perform it.
 *
 * Two things are proved before any row is read: the project the reference
 * names admits this principal now, and the source agrees that the chart
 * belongs to that project. The second is what makes an unsigned reference
 * safe: a reference whose halves disagree is refused, and possession of one
 * is never authority.
 * @param request - who is asking, which chart, and the caller's row bound.
 * @returns the chart's definition summary, its fields, and its bounded rows.
 * @throws {BiError} with the reason the operation was refused or failed.
 */
abstract query(request: GovernedQueryRequest): Promise<BiQueryResult>
```

Types: [OrgId](account.zh.md)

Source: [`packages/bi/bi-gateway/src/index.ts`](../../packages/bi/bi-gateway/src/index.ts)

<a id="ctxbisource--bisource-abstract-seam"></a>

### `ctx.biSource` — `BiSource` (abstract seam)

One upstream BI product. A provider mounts this service; the governed gateway injects `biSource`.

Failures are raised as `BiError` with `upstream-unavailable`, `upstream-invalid`, `chart-unavailable`, or `query-failed`. A provider never raises an authorization reason: it does not know who is asking, which is the point.

```ts cordis-catalog
/**
 * Every project the configured source holds.
 * @param signal - aborts the operation.
 * @returns every project, in whatever order the source lists them.
 * @throws {BiError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listProjects(signal?: AbortSignal): Promise<readonly UpstreamProject[]>

/**
 * The saved charts of one already-authorized project.
 * @param request - the authorized upstream id.
 * @returns the listing, empty when the project holds no chart.
 * @throws {BiError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listCharts(request: UpstreamChartsRequest): Promise<UpstreamChartListing>

/**
 * Where one chart sits, so the gateway can authorize the project that holds
 * it before running anything in it.
 * @param upstreamChartId - the source's own chart id.
 * @param signal - aborts the operation.
 * @returns the project it belongs to, and the chart.
 * @throws {BiError} `upstream-unavailable`, `upstream-invalid`, or
 * `chart-unavailable` when the source holds no such chart.
 */
abstract describeChart(upstreamChartId: string, signal?: AbortSignal): Promise<UpstreamChartPlacement>

/**
 * Run one already-authorized saved chart as it was saved.
 * @param request - the project, the chart, and the caller's row bound.
 * @returns the fields, the saved filters, and the bounded rows.
 * @throws {BiError} `upstream-unavailable`, `upstream-invalid`,
 * `chart-unavailable` when the source no longer holds the chart, or
 * `query-failed` when the source ran it and the warehouse refused or failed.
 */
abstract runChart(request: UpstreamRunRequest): Promise<UpstreamRun>
```

Source: [`packages/bi/bi-source/src/index.ts`](../../packages/bi/bi-source/src/index.ts)
<!-- END GENERATED cordis-surface -->
