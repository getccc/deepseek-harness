# GMO供应链分析

[English](gmo.md) | 中文

GMO供应链分析接缝——一个横跨**四个操作**（分类目录、结果列表、结果描述与提问）、位于同一个 `ctx.gmo` 服务上的[能力接缝](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)。Service Definition 是 [dsh-gmo](../../packages/gmo/gmo)；它的 Team 提供方是 [dsh-gmo-team](../../packages/gmo/gmo-team)，面向模型的工具是 [dsh-tool-gmo](../../packages/gmo/tool-gmo)，两者都在 [Control Plane GMO 能力](../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)中设计。GMO 分析是**一个可选能力**，不属于 agent-loop 主干，因此它的词汇在这里，而不在 [core.zh.md](core.zh.md)。

接缝命名产品操作，绝不命名上游操作。持有 `ctx.gmo` 的 Runner 无法指名地址、令牌、自己的语句或上游分类与结果 id，因为没有任何操作为它们留下位置。正是这一点，使受治理的部署能够把每一个 GMO 判定——哪位成员、哪台设备、哪个分类、此时此刻——放在成员自己的进程绕不过去的服务背后。

来源：[`packages/gmo/gmo/src/types.ts`](../../packages/gmo/gmo/src/types.ts)

## 命名一个分类

`GmoCategoryRef` 是 `<providerKind>:<sourceCode>:<upstreamId>`——例如 `exceltools:gmo:gb`。它是分类在上游改名之后仍保持不变的身份，也是唯一离开 Control Plane 的分类标识。分类是数据源的一条业务线，例如 GB / GL 分配；引用里的上游键只对铸造它的提供方有意义。

有三个边界，且都在引用被构造的地方失败，而不是在使用的地方：

| 边界 | 取值 | 原因 |
|---|---|---|
| 引用长度 | 64 个字符 | 审计库的 `resource_id` 使用 `AUDIT_TOKEN`；更长的引用是任何操作都无法记录的 |
| 段的字符集 | 字母、数字、`. _ @ -` | 审计 token 字符集去掉分隔各段的 `:`，也去掉分隔结果与分类的 `/` |
| 数据源代码长度 | 19 个字符 | 私有知识与 BI 推导出的边界，保持一致，让一个部署的数据源代码适用于所有目录 |

`formatGmoCategoryRef` 抛出 `InvalidGmoRefError`，指明哪个边界失败。`parseGmoCategoryRef` 则回答 `undefined`，因为它的调用方——线路解码器、日志读取器、已存行校验器——是在决定是否接受一个值，而不是诊断它。

来源：[`packages/gmo/gmo/src/brand.ts`](../../packages/gmo/gmo/src/brand.ts)

## 命名一份结果

`GmoResultRef` 是分类引用、一个 `/`，再加上上游结果 id——`exceltools:gmo:gb/09032da5…`。它是独立的品牌，而不是更长的 `GmoCategoryRef`，因为两者受不同的东西约束：分类引用必须容得进审计 token，而结果从不是审计资源。对结果的操作所记录的是它所属的分类，这也是授权指名、管理员启用的对象。

多步结果的一步本身就是一份结果：数据源的 `<id>~<阶段>` 在引用里写作 `<id>.<阶段>`，因为 `~` 不在字符集内，只有提供方负责转换它。`categoryRefOf` 与 `upstreamResultIdOf` 无需再次解析就能拆开一个已证明的引用。

## 会话 GMO 范围

一个会话分析哪个分类，记录在会话日志里的 `gmo/scope`，这是带版本的整值替换，以最后一个事件为准：

```ts
import { GmoCategoryRef, type GmoScope } from '@deepseek-ai/dsh-gmo'

const ref = GmoCategoryRef('exceltools:gmo:gb')

export const off: GmoScope = { version: 1, mode: 'off' }
export const selected: GmoScope = {
  version: 1,
  mode: 'selected',
  category: { ref, displayName: 'GB / GL 分配' },
}
```

没有这个事件的日志折叠为 `off`，所以每个会话开始时 GMO 分析都不可用，并一直如此，直到成员做出选择。`foldGmoScope(events, end?)` 执行这个折叠；可选的 `end` 折叠一个前缀，回退与分叉就是这样读到日志在某一点上说了什么。`categoryOf` 回答已记录的分类，`off` 时回答 `undefined`。

范围对模型可见两次——它决定指名所选分类的提示词段，也决定 GMO 工具是否提供——所以它只存在于日志里，别处没有。`selected` 分支在引用旁记录显示名，因为只能告诉模型日志里有的名字；分类之后改名，不会改变已记录会话的提示词。范围命名一个分类或没有分类，没有表示"全部分类"的分支，并且只会收窄当前授权。

来源：[`packages/gmo/gmo/src/scope.ts`](../../packages/gmo/gmo/src/scope.ts)

## 目录、结果、描述与提问

`catalog()` 回答当前主体此刻可以分析的分类——引用与显示名。它是权限视角的视图，不是对现有内容的列举：主体什么都没被授予的分类，或管理员尚未启用的分类，是缺席而不是被标记。

`results()` 回答一个分类的一页处理结果，最新在前，每条是一个 `GmoResultSummary`，携带受治理引用、名称、工具、期间、行数、创建时间，以及多步结果的各步骤。

`describe()` 回答读者向一份结果提出好问题所需的内容：每列的键、类型、筛选方式，以及其所有者写下的业务含义；看板的度量、日期列和维度；数据源的当前日期；以及该分类用 Markdown 写下的业务规则。含义随数据而行，所以新增分类不需要发布 Runner。

`ask()` 回答一个来自封闭词汇 `GmoQuery` 的提问：

| 种类 | 问什么 |
|---|---|
| `aggregate` | 对最多两个分组列做数值列求和、行数或去重计数，带日期粒度、排序、上限和筛选 |
| `overview` | 数据源现成的看板之一：总量与按周分桶、时间轴、排名、穿透、热力图、需求结构、数据质量或供需视图 |
| `rows` | 一页经筛选和排序的明细行 |

词汇由 `readGmoQuery`、`readGmoFilters` 与 `readGmoCount` 读取，Runner 的工具和 Control Plane 都会应用它们：词汇未定义的键被拒绝而不是被忽略。提问中的列和取值由数据源对照结果自己的列来校验，所以这里无法指名结果没有的列。答案是数据源自己的、有界的 JSON，连同它所回答的引用；数字由数据源计算。

没有任何操作返回部分答案。无法授权的目录、对被拒绝分类的列表，以及对错位结果的提问都会抛出，因为被悄悄收窄的结果对读它的模型来说与正确结果无法区分。

## 失败

每个失败都是携带封闭集合中一个原因的 `GmoError`，让 Runner、工具结果和 UI 无需解析消息，就能区分"请重新登录""请联系管理员"与"请稍后再试"。

| 原因 | 含义 |
|---|---|
| `unauthenticated` | 没有有效的设备令牌、成员未启用，或设备已被吊销 |
| `not-allowed` | 没有授权放行该操作，或所指名的分类未知、已停用或尚未启用 |
| `scope-unavailable` | 对话的分类已不在主体的已授权目录里 |
| `result-unavailable` | 数据源没有这份结果，或它已不属于对话的分类 |
| `unsupported` | 结果存在但没有这个视图，例如分配结果上的需求结构 |
| `invalid-query` | 数据源拒绝了某个列、筛选或取值 |
| `upstream-unavailable` | GMO 服务没有及时应答或根本没有应答，或拒绝了令牌 |
| `upstream-invalid` | GMO 服务回答了本构建读不懂的东西 |
| `too-large` | 答案超过数据源的大小上限；更窄的提问可以放下 |
| `control-plane-unreachable` | 从这台电脑无法访问 Control Plane |
| `update-required` | Control Plane 拒绝该操作的协议版本；它能服务的操作继续工作 |
| `cancelled` | 调用方中止了操作 |

`not-allowed` 有意同时覆盖未知引用和未授权引用，因此拒绝不会向什么都没被授予的主体确认某个分类存在。上游的响应体不会进入其中任何一个：原因就是产品界面收到的全部诊断。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgmo--gmo-abstract-seam"></a>

### `ctx.gmo` — `Gmo` (abstract seam)

GMO supply-chain analysis, as a Runner sees it. A provider mounts this service; consumers inject `gmo`.

Every method fails with GmoError carrying a closed reason. None returns a partial answer: a directory that could not be authorized, a listing on a refused category, and a question about a result outside its category all raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

```ts cordis-catalog
/**
 * The categories the current principal may analyze right now.
 * @param signal - aborts the operation.
 * @returns the authorized directory, empty when the principal holds nothing.
 * @throws {GmoError} when the principal cannot be established or the directory cannot be read.
 */
abstract catalog(signal?: AbortSignal): Promise<readonly GmoCategoryEntry[]>

/**
 * One page of the processing results in one authorized category, newest first.
 *
 * The category is authorized on this call, like every other operation: a
 * reference that was in the directory a moment ago is not standing
 * permission to list it now.
 * @param request - the category and which page.
 * @returns the page, empty when the category holds no result.
 * @throws {GmoError} when the category is refused or the upstream does not answer usably.
 */
abstract results(request: GmoResultsRequest): Promise<GmoResultPage>

/**
 * Describe one result: its columns with their business meaning, its
 * dashboard dimensions, the upstream's current date, and the category's
 * written business rules.
 *
 * The result's category is resolved from the source and authorized on this
 * call, so holding a reference proves nothing.
 * @param request - the result to describe.
 * @returns the description.
 * @throws {GmoError} when the category is refused, the result is unknown or
 * misplaced (`result-unavailable`), or the upstream does not answer usably.
 */
abstract describe(request: GmoDescribeRequest): Promise<GmoDescription>

/**
 * Ask one question of one result: a free-form aggregation, one of the
 * ready-made dashboards, or a page of detail rows.
 *
 * The result's category is resolved from the source and authorized on this
 * call, and a result the source places in another category is refused
 * before any figure is read.
 * @param request - the result and the question.
 * @returns the upstream's bounded answer.
 * @throws {GmoError} when the category is refused, the result is unknown or
 * misplaced (`result-unavailable`), the result has no such view
 * (`unsupported`), the source refuses the question (`invalid-query`), the
 * answer is too large (`too-large`), or the upstream does not answer usably.
 */
abstract ask(request: GmoAskRequest): Promise<GmoAnswer>
```

Source: [`packages/gmo/gmo/src/index.ts`](../../packages/gmo/gmo/src/index.ts)

<a id="ctxgmogateway--gmogateway-abstract-seam"></a>

### `ctx.gmoGateway` — `GmoGateway` (abstract seam)

The governed catalog and the decision in front of it. A provider mounts this service; consumers inject `gmoGateway`.

Administration methods take an organization because an administrator has already been authorized by the route that called them. Member-facing methods take a principal because they authorize it themselves, per category, on every call.

```ts cordis-catalog
/**
 * Reconcile the durable catalog against one successful full listing.
 *
 * Serialized: concurrent callers join the operation already in flight rather
 * than racing two reconciliations over the same rows. A source that does not
 * answer leaves the last successful snapshot in place and records the
 * failure, because one failed listing must not disable every category an
 * organization governs. A category the source newly lists starts disabled:
 * a role granted every category must not gain a business line the moment the
 * source starts serving it.
 * @param orgId - the organization whose catalog is reconciled.
 * @returns the catalog as it stands after the attempt, successful or not.
 */
abstract sync(orgId: OrgId): Promise<GmoCatalogView>

/**
 * Read the durable catalog without contacting the source.
 * @param orgId - the organization to read.
 * @returns every governed entry and the source's health.
 */
abstract catalogView(orgId: OrgId): Promise<GmoCatalogView>

/**
 * Switch one entry on or off for the whole organization.
 *
 * Synchronization never overrides this choice: an administrator who enabled
 * or disabled a category finds it still so after the next listing.
 * @param orgId - the organization the entry belongs to.
 * @param ref - the entry to change.
 * @param enabled - whether it may be analyzed at all.
 * @throws {GmoError} `not-allowed` when the catalog holds no such entry.
 */
abstract setEnabled(orgId: OrgId, ref: GmoCategoryRef, enabled: boolean): Promise<void>

/**
 * The categories this principal may analyze right now.
 * @param principal - who is asking, from a verified token.
 * @returns the authorized directory, empty when the principal holds nothing.
 */
abstract directory(principal: GmoPrincipal): Promise<readonly GmoCategoryEntry[]>

/**
 * Authorize one result listing and perform it.
 *
 * The category is evaluated on this call, as every other operation's is. A
 * member who may ask a category's results may see which results are in it:
 * the decision is the same permission, asked separately so it can be
 * tightened without a new authorization path.
 * @param request - who is asking, which category, and which page.
 * @returns the page, with results addressed by governed references.
 * @throws {GmoError} with the reason the operation was refused or failed.
 */
abstract results(request: GovernedResultsRequest): Promise<GmoResultPage>

/**
 * Authorize one description and perform it.
 *
 * Two things are proved before anything is read: the category the reference
 * names admits this principal now, and the source agrees that the result
 * belongs to that category. The second is what makes an unsigned reference
 * safe: a reference whose halves disagree is refused, and possession of one
 * is never authority.
 * @param request - who is asking and which result.
 * @returns the description, with references in place of upstream ids.
 * @throws {GmoError} with the reason the operation was refused or failed.
 */
abstract describe(request: GovernedDescribeRequest): Promise<GmoDescription>

/**
 * Authorize one question and perform it, on the same two proofs as
 * {@link describe}, and refuse an answer the source attributes to a
 * different category than the one authorized.
 * @param request - who is asking, which result, and the question.
 * @returns the source's bounded answer.
 * @throws {GmoError} with the reason the operation was refused or failed.
 */
abstract ask(request: GovernedAskRequest): Promise<GmoAnswer>
```

Types: [OrgId](account.zh.md)

Source: [`packages/gmo/gmo-gateway/src/index.ts`](../../packages/gmo/gmo-gateway/src/index.ts)

<a id="ctxgmosource--gmosource-abstract-seam"></a>

### `ctx.gmoSource` — `GmoSource` (abstract seam)

One upstream GMO service. A provider mounts this service; the governed gateway injects `gmoSource`.

Failures are raised as `GmoError` with `upstream-unavailable`, `upstream-invalid`, `result-unavailable`, `unsupported`, `invalid-query`, or `too-large`. A provider never raises an authorization reason: it does not know who is asking, which is the point.

```ts cordis-catalog
/**
 * Every category the configured source holds that has at least one tool.
 * @param signal - aborts the operation.
 * @returns every category, in whatever order the source lists them.
 * @throws {GmoError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listCategories(signal?: AbortSignal): Promise<readonly UpstreamCategory[]>

/**
 * One page of an already-authorized category's results, newest first.
 * @param request - the authorized upstream id and the page.
 * @returns the page, empty when the category holds no result.
 * @throws {GmoError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listResults(request: UpstreamResultsRequest): Promise<UpstreamResultListing>

/**
 * Where one result sits, cheaply and without reading any figure, so the
 * gateway can authorize the category that holds it before asking anything.
 * @param upstreamResultId - the source's own result id.
 * @param signal - aborts the operation.
 * @returns the category it belongs to.
 * @throws {GmoError} `upstream-unavailable`, `upstream-invalid`, or
 * `result-unavailable` when the source holds no such result.
 */
abstract placeResult(upstreamResultId: string, signal?: AbortSignal): Promise<UpstreamPlacement>

/**
 * Describe one already-authorized result.
 * @param upstreamResultId - the source's own result id.
 * @param signal - aborts the operation.
 * @returns the description, with the category the source says holds it.
 * @throws {GmoError} `upstream-unavailable`, `upstream-invalid`,
 * `result-unavailable`, or `too-large`.
 */
abstract describeResult(upstreamResultId: string, signal?: AbortSignal): Promise<UpstreamDescription>

/**
 * Ask one already-authorized result one question.
 * @param request - the category, the result, and the question.
 * @returns the bounded answer and the category the source says answered.
 * @throws {GmoError} `upstream-unavailable`, `upstream-invalid`,
 * `result-unavailable`, `unsupported` when the result has no such view,
 * `invalid-query` when the source refuses a column, filter, or value, or
 * `too-large` when the answer exceeds the source's size bound.
 */
abstract ask(request: UpstreamAskRequest): Promise<UpstreamAnswer>
```

Source: [`packages/gmo/gmo-source/src/index.ts`](../../packages/gmo/gmo-source/src/index.ts)
<!-- END GENERATED cordis-surface -->
