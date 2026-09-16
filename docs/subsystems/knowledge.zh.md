# 私有知识

[English](knowledge.md) | 中文

私有知识接缝——一个横跨**四个操作**（目录、文档列表、文档内容与检索）、位于同一个 `ctx.knowledge` 服务上的[能力接缝](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)。Service Definition 是 [dsh-knowledge](../../packages/knowledge/knowledge)；它的 Team 提供方和面向模型的工具随 [Control Plane 知识能力](../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md)一起到来。知识是**一个可选能力**，不属于 agent-loop 主干，因此它的词汇在这里，而不在 [core.zh.md](core.zh.md)。

接缝命名产品操作，绝不命名上游操作。持有 `ctx.knowledge` 的 Runner 无法指名地址、租户、凭据或上游文档 id，因为没有任何操作为它们留下位置。正是这一点，使受治理的部署能够把每一个知识判定——哪位成员、哪台设备、哪些知识库、此时此刻——放在成员自己的进程绕不过去的服务背后。

来源：[`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

## 命名一个知识库

`KnowledgeRef` 是 `<providerKind>:<sourceCode>:<upstreamId>`——例如 `weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266`。它是知识库跨上游重命名的身份，也是唯一会离开 Control Plane 的知识标识符。其中的上游 id 只对铸造它的提供方有意义；Control Plane 之外没有任何东西能把引用还原成上游地址。

三条上界成立，且三条都在构造引用处失败，而不是在使用引用处：

| 上界 | 取值 | 原因 |
|---|---|---|
| 引用长度 | 64 个字符 | 审计存储的 `resource_id` 遵循 `AUDIT_TOKEN`；更长的引用是任何操作都无法记录的引用 |
| 分段字符集 | 字母、数字、`. _ @ -` | 审计 token 字符集去掉分隔分段的 `:` |
| 数据源代码长度 | 19 个字符 | `weknora`、两个分隔符和 36 字符 UUID 之后，引用上界剩下的空间 |

`formatKnowledgeRef` 抛出 `InvalidKnowledgeRefError` 并指名是哪条上界失败。`parseKnowledgeRef` 则回答 `undefined`，因为它的调用方——wire 解码器、日志读取器、存储行验证器——是在决定是否接受一个值，而不是在诊断它。

来源：[`packages/knowledge/knowledge/src/brand.ts`](../../packages/knowledge/knowledge/src/brand.ts)

## 命名一份文档

`KnowledgeDocRef` 是一个知识引用、一个 `/` 和上游文档 id——`weknora:prod:690c0727-…/doc-7`。它是独立的品牌而不是更长的 `KnowledgeRef`，因为两者受不同的东西约束：知识引用必须装进审计 token，而文档从不是审计资源。对文档的操作所记录的是它所属的知识库，那也正是授权所命名、管理员所停用的对象。

文档 id 以同一套字符表限制在 64 个字符内。`formatKnowledgeDocRef` 抛出 `InvalidKnowledgeRefError`；`parseKnowledgeDocRef` 返回 `undefined`，理由与它的知识库对应物相同。

## 会话知识范围

会话可以检索哪些私有知识，作为 `knowledge/scope` 记录在会话日志中——一个版本化的整值替换，最后一条生效：

```ts
import { KnowledgeDocRef, KnowledgeRef, type KnowledgeScope } from '@deepseek-ai/dsh-knowledge'

const ref = KnowledgeRef('weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266')

export const off: KnowledgeScope = { version: 1, mode: 'off' }
export const all: KnowledgeScope = { version: 1, mode: 'all' }
export const selected: KnowledgeScope = {
  version: 1,
  mode: 'selected',
  bases: [{ ref, displayName: '临港知识库' }],
}
export const documents: KnowledgeScope = {
  version: 1,
  mode: 'selected',
  bases: [{ ref, displayName: '临港知识库', docRefs: [KnowledgeDocRef(`${ref}/doc-7`)] }],
}
```

没有该事件的日志折叠为 `off`，因此每个会话都以知识不可用开始，并保持到成员做出选择为止。`foldKnowledgeScope(events, end?)` 执行该折叠；可选的 `end` 折叠一个前缀，这正是 rewind 和 fork 读取日志在某一点所说内容的方式。

范围在两个层面上都是模型可见输入——它决定写出所选知识库的提示词章节，也决定检索工具是否被提供——因此它存在于日志中，且仅存在于日志中。这也是 `selected` 分支在每个引用旁记录显示名称的原因：只能把日志持有的名字告诉模型。这些名字是选择那一刻的快照，因此管理员之后重命名知识库不会改变已记录会话的提示词所说的内容，而选择器和输入框 Chip 则从已授权目录解析当前名字。

`all` 不记录名字，因为它指代的集合是主体在每次调用时的授权范围，无法诚实地快照。

恰好命名一个知识库的范围，还可以通过该条目的 `docRefs` 进一步收窄到其中的文档。它是一个可选属性而不是独立的 mode：按[持久化规则](../persistence-changes/README.zh.md#compatibility-rules)，联合类型变更要升 Session 格式版本，而新增可选属性属于 same-version（[记录](../persistence-changes/2026-09-16-knowledge-scope-documents.zh.md)）。代价被写在那里而不是被藏起来——早于该字段的构建会忽略它并检索整个知识库，这比成员所选更宽，绝不会更窄。每个文档引用都必须解析到携带它的那个知识库，而命名多个知识库的范围根本不能携带文档，因为上游的收窄只在一个知识库内生效。模型对这种范围被告知的是它的知识库和文档数量；不记录任何文档标题，而检索返回的段落本来就会说出各自的文档。

范围只会收窄当前权限。它绝不新增知识库，陈旧或伪造的引用仍会到达一个无法被会话日志扩大的授权判定。

来源：[`packages/knowledge/knowledge/src/scope.ts`](../../packages/knowledge/knowledge/src/scope.ts)

## 目录、文档与检索

`catalog()` 回答当前主体此刻可以检索的知识库——引用、显示名称、描述和类型。它是一个按权限成形的视图，而不是存在物的清单：主体零权限的知识库是缺席，而不是被标记。

`documents()` 回答某个知识库中文档的一页，每份都携带它的受治理引用、源对该文件所持有的信息，以及一个 `KnowledgeDocumentState`——`ready`、`processing` 或 `unavailable`。该状态是把源自己的解析与启用用词，读成成员可以据此行动的三件事：用它、等待，或者去问管理员。本次构建不认识的状态读作 `unavailable`，即承诺最少的那个。这一页只在源给出 `total` 时报告它；缺失意味着「源没有说」，不能被读成零。

`documentContent()` 以一个 `KnowledgeDocumentContent` 回答一份文档，并说明它是两者中的哪一个。`bytes` 是原始文件，媒体类型由其文件名推出，并且从不是部分的。`text` 是源的解析文本，在文件超过调用方或部署的上界、源不持有文件，以及文本必须被截断时提供。源两者都不会提供的文档是 `document-unavailable`——它存在，而没有任何可读的内容。

`search()` 接受查询、从会话解析出的范围，以及调用方的上界。`KnowledgeScopeSelection` 把 `all` 保留为一个模式而不是展开后的列表，因为展开是只有 Control Plane 能执行的授权行为；展开它的 Runner 等于在断言它算不出来的授权。

所有操作都不返回部分答案。无法完成授权的目录、在被拒知识库上的列表，以及范围被拒的检索都会抛出，因为对读到它的模型而言，被悄悄收窄的结果与正确结果无法区分。

## 失败

每个失败都是携带封闭集合中一个理由的 `KnowledgeError`，使 Runner、工具结果和 UI 都能在不解析消息的情况下区分「重新登录」「去找管理员」和「稍后再试」。

| 理由 | 含义 |
|---|---|
| `unauthenticated` | 没有有效设备 Token、成员非活跃，或设备已撤销 |
| `not-allowed` | 没有授权准许该操作，或具名资源未知或已停用 |
| `document-unavailable` | 该文档对源而言存在，但没有任何它会提供的内容 |
| `scope-unavailable` | 某个已选引用不再位于主体的已授权目录中 |
| `scope-incompatible` | 上游无法把所选知识库放在一起检索 |
| `upstream-unavailable` | 知识服务未在限时内应答或完全没有应答 |
| `upstream-invalid` | 知识服务的应答是本构建无法读取的内容 |
| `control-plane-unreachable` | 从这台电脑无法到达 Control Plane |
| `update-required` | 本 Runner 使用的知识协议版本被 Control Plane 拒绝 |
| `cancelled` | 调用方中止了操作 |

`not-allowed` 有意同时覆盖未知引用与未授权引用，因此拒绝绝不向持有零权限的主体确认某个知识库存在。任何上游响应体都不会进入其中任何一项：理由就是产品界面收到的全部诊断。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledge-abstract-seam"></a>

### `ctx.knowledge` — `Knowledge` (abstract seam)

Private knowledge, as a Runner sees it. A provider mounts this service; consumers inject `knowledge`.

Both methods fail with KnowledgeError carrying a closed reason. Neither returns a partial answer: a directory that could not be authorized and a search whose scope was refused both raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

```ts cordis-catalog
/**
 * The knowledge bases the current principal may search right now.
 * @param signal - aborts the operation.
 * @returns the authorized directory, empty when the principal holds nothing.
 * @throws {KnowledgeError} when the principal cannot be established or the directory cannot be read.
 */
abstract catalog(signal?: AbortSignal): Promise<readonly KnowledgeBaseEntry[]>

/**
 * One page of the documents in one authorized knowledge base.
 *
 * The knowledge base is authorized on this call, like every other operation:
 * a reference that was in the directory a moment ago is not standing
 * permission to list it now.
 * @param request - the knowledge base, and which page of it.
 * @returns the page, empty when the knowledge base holds no document.
 * @throws {KnowledgeError} when the knowledge base is refused or the upstream does not answer usably.
 */
abstract documents(request: KnowledgeDocumentsRequest): Promise<KnowledgeDocumentPage>

/**
 * One document's content: the original file, or the source's parsed text
 * when the file is larger than the caller accepts or the source holds none.
 *
 * The document's knowledge base is resolved from the source and authorized
 * on this call, and a reference whose two halves disagree is refused before
 * any content is read: holding a reference proves nothing.
 * @param request - the document, and the most bytes the caller can accept.
 * @returns the content, saying which of the two it is.
 * @throws {KnowledgeError} when the knowledge base is refused, the document has no
 * content to serve (`document-unavailable`), or the upstream does not answer usably.
 */
abstract documentContent(request: KnowledgeDocumentRequest): Promise<KnowledgeDocumentContent>

/**
 * Search the knowledge bases one operation names.
 * @param request - the query, the scope resolved from the Session, and the caller's bounds.
 * @returns the passages, with the knowledge bases actually searched.
 * @throws {KnowledgeError} when any named knowledge base is refused, the scope
 * cannot be searched together, or the upstream does not answer usably.
 */
abstract search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>
```

Source: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts)

<a id="ctxknowledgegateway--knowledgegateway-abstract-seam"></a>

### `ctx.knowledgeGateway` — `KnowledgeGateway` (abstract seam)

The governed catalog and the decision in front of it. A provider mounts this service; consumers inject `knowledgeGateway`.

Administration methods take an organization because an administrator has already been authorized by the route that called them. Member-facing methods take a principal because they authorize it themselves, per knowledge base, on every call.

```ts cordis-catalog
/**
 * Reconcile the durable catalog against one successful full listing.
 *
 * Serialized: concurrent callers join the operation already in flight rather
 * than racing two reconciliations over the same rows. A source that does not
 * answer leaves the last successful snapshot in place and records the
 * failure, because one failed listing must not disable every knowledge base
 * an organization governs.
 * @param orgId - the organization whose catalog is reconciled.
 * @returns the catalog as it stands after the attempt, successful or not.
 */
abstract sync(orgId: OrgId): Promise<KnowledgeCatalogView>

/**
 * Read the durable catalog without contacting the source.
 * @param orgId - the organization to read.
 * @returns every governed entry and the source's health.
 */
abstract catalogView(orgId: OrgId): Promise<KnowledgeCatalogView>

/**
 * Switch one entry on or off for the whole organization.
 *
 * Synchronization never overrides this choice: an administrator who disabled
 * a knowledge base finds it still disabled after the next listing.
 * @param orgId - the organization the entry belongs to.
 * @param ref - the entry to change.
 * @param enabled - whether it may be searched at all.
 * @throws {KnowledgeError} `not-allowed` when the catalog holds no such entry.
 */
abstract setEnabled(orgId: OrgId, ref: KnowledgeRef, enabled: boolean): Promise<void>

/**
 * The knowledge bases this principal may search right now.
 * @param principal - who is asking, from a verified token.
 * @returns the authorized directory, empty when the principal holds nothing.
 */
abstract directory(principal: KnowledgePrincipal): Promise<readonly KnowledgeBaseEntry[]>

/**
 * Authorize one document listing and perform it.
 *
 * The knowledge base is evaluated on this call, as a search's is. A member
 * who may retrieve from a knowledge base may list what is in it: the
 * decision is the same permission, asked separately so it can be tightened
 * without a new authorization path.
 * @param request - who is asking, which knowledge base, and which page.
 * @returns the page, with the documents addressed by governed references.
 * @throws {KnowledgeError} with the reason the operation was refused or failed.
 */
abstract documents(request: GovernedDocumentsRequest): Promise<KnowledgeDocumentPage>

/**
 * Authorize one document read and perform it.
 *
 * Two things are proved before any content is read: the knowledge base the
 * reference names admits this principal now, and the source agrees that the
 * document belongs to that knowledge base. The second is what makes an
 * unsigned reference safe — a reference whose halves disagree is refused,
 * and possession of one is never authority.
 * @param request - who is asking, which document, and the caller's byte bound.
 * @returns the original file, or the parsed text when the file does not fit or does not exist.
 * @throws {KnowledgeError} with the reason the operation was refused or failed.
 */
abstract documentContent(request: GovernedDocumentRequest): Promise<KnowledgeDocumentContent>

/**
 * Authorize one search and perform it.
 *
 * Every knowledge base the scope resolves to is evaluated before the source
 * is called, and one refusal fails the whole request: a partial result is
 * indistinguishable from a complete one to the model that reads it.
 * @param request - who is asking, the scope, the query, and the caller's bounds.
 * @returns the passages, with the knowledge bases actually searched.
 * @throws {KnowledgeError} with the reason the operation was refused or failed.
 */
abstract search(request: GovernedSearchRequest): Promise<KnowledgeSearchResult>
```

Types: [OrgId](account.zh.md)

Source: [`packages/knowledge/knowledge-gateway/src/index.ts`](../../packages/knowledge/knowledge-gateway/src/index.ts)

<a id="ctxknowledgesource--knowledgesource-abstract-seam"></a>

### `ctx.knowledgeSource` — `KnowledgeSource` (abstract seam)

One upstream knowledge product. A provider mounts this service; the governed gateway injects `knowledgeSource`.

Failures are raised as `KnowledgeError` with `upstream-unavailable` or `upstream-invalid`. A provider never raises an authorization reason: it does not know who is asking, which is the point.

```ts cordis-catalog
/**
 * Everything the configured source holds.
 * @param signal - aborts the operation.
 * @returns every knowledge base, in whatever order the source lists them.
 * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract list(signal?: AbortSignal): Promise<readonly UpstreamKnowledgeBase[]>

/**
 * One page of the documents in one already-authorized knowledge base.
 * @param request - the authorized upstream id, and which page of it.
 * @returns the page, empty when the knowledge base holds no document.
 * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listDocuments(request: UpstreamDocumentsRequest): Promise<UpstreamDocumentPage>

/**
 * Where one document sits, so the gateway can authorize the knowledge base
 * that holds it before asking for anything in it.
 * @param upstreamDocId - the source's own document id.
 * @param signal - aborts the operation.
 * @returns the knowledge base it belongs to, and the document.
 * @throws {KnowledgeError} `upstream-unavailable`, `upstream-invalid`, or
 * `document-unavailable` when the source holds no such document.
 */
abstract describeDocument(upstreamDocId: string, signal?: AbortSignal): Promise<UpstreamDocumentPlacement>

/**
 * One already-authorized document's content.
 * @param request - the document and the caller's bounds.
 * @returns the original file, or the parsed text when the file does not fit or does not exist.
 * @throws {KnowledgeError} `upstream-unavailable`, `upstream-invalid`, or
 * `document-unavailable` when the source will serve neither a file nor text.
 */
abstract fetchDocument(request: UpstreamDocumentRequest): Promise<UpstreamDocumentContent>

/**
 * Search an explicit, already-authorized set of knowledge bases.
 * @param request - the authorized upstream ids, the query, and the result bound.
 * @returns the passages, at most `maxResults` of them.
 * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]>
```

Source: [`packages/knowledge/knowledge-source/src/index.ts`](../../packages/knowledge/knowledge-source/src/index.ts)
<!-- END GENERATED cordis-surface -->
