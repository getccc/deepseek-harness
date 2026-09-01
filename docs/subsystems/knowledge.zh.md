# 私有知识

[English](knowledge.md) | 中文

私有知识接缝——一个横跨**两个操作**（目录与检索）、位于同一个 `ctx.knowledge` 服务上的[能力接缝](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.zh.md)。Service Definition 是 [dsh-knowledge](../../packages/knowledge/knowledge)；它的 Team 提供方和面向模型的工具随 [Control Plane 知识能力](../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md)一起到来。知识是**一个可选能力**，不属于 agent-loop 主干，因此它的词汇在这里，而不在 [core.zh.md](core.zh.md)。

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

## 会话知识范围

会话可以检索哪些私有知识，作为 `knowledge/scope` 记录在会话日志中——一个版本化的整值替换，最后一条生效：

```ts
import { KnowledgeRef, type KnowledgeScope } from '@deepseek-ai/dsh-knowledge'

export const off: KnowledgeScope = { version: 1, mode: 'off' }
export const all: KnowledgeScope = { version: 1, mode: 'all' }
export const selected: KnowledgeScope = {
  version: 1,
  mode: 'selected',
  bases: [{ ref: KnowledgeRef('weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'), displayName: '临港知识库' }],
}
```

没有该事件的日志折叠为 `off`，因此每个会话都以知识不可用开始，并保持到成员做出选择为止。`foldKnowledgeScope(events, end?)` 执行该折叠；可选的 `end` 折叠一个前缀，这正是 rewind 和 fork 读取日志在某一点所说内容的方式。

范围在两个层面上都是模型可见输入——它决定写出所选知识库的提示词章节，也决定检索工具是否被提供——因此它存在于日志中，且仅存在于日志中。这也是 `selected` 分支在每个引用旁记录显示名称的原因：只能把日志持有的名字告诉模型。这些名字是选择那一刻的快照，因此管理员之后重命名知识库不会改变已记录会话的提示词所说的内容，而选择器和输入框 Chip 则从已授权目录解析当前名字。

`all` 不记录名字，因为它指代的集合是主体在每次调用时的授权范围，无法诚实地快照。

范围只会收窄当前权限。它绝不新增知识库，陈旧或伪造的引用仍会到达一个无法被会话日志扩大的授权判定。

来源：[`packages/knowledge/knowledge/src/scope.ts`](../../packages/knowledge/knowledge/src/scope.ts)

## 目录与检索

`catalog()` 回答当前主体此刻可以检索的知识库——引用、显示名称、描述和类型。它是一个按权限成形的视图，而不是存在物的清单：主体零权限的知识库是缺席，而不是被标记。

`search()` 接受查询、从会话解析出的范围，以及调用方的上界。`KnowledgeScopeSelection` 把 `all` 保留为一个模式而不是展开后的列表，因为展开是只有 Control Plane 能执行的授权行为；展开它的 Runner 等于在断言它算不出来的授权。

两个操作都不返回部分答案。无法完成授权的目录和范围被拒的检索都会抛出，因为对读到它的模型而言，被悄悄收窄的结果与正确结果无法区分。

## 失败

每个失败都是携带封闭集合中一个理由的 `KnowledgeError`，使 Runner、工具结果和 UI 都能在不解析消息的情况下区分「重新登录」「去找管理员」和「稍后再试」。

| 理由 | 含义 |
|---|---|
| `unauthenticated` | 没有有效设备 Token、成员非活跃，或设备已撤销 |
| `not-allowed` | 没有授权准许该操作，或具名资源未知或已停用 |
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
 * Search the knowledge bases one operation names.
 * @param request - the query, the scope resolved from the Session, and the caller's bounds.
 * @returns the passages, with the knowledge bases actually searched.
 * @throws {KnowledgeError} when any named knowledge base is refused, the scope
 * cannot be searched together, or the upstream does not answer usably.
 */
abstract search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>
```

Source: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts)

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
 * Search an explicit, already-authorized set of knowledge bases.
 * @param request - the authorized upstream ids, the query, and the result bound.
 * @returns the passages, at most `maxResults` of them.
 * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]>
```

Source: [`packages/knowledge/knowledge-source/src/index.ts`](../../packages/knowledge/knowledge-source/src/index.ts)
<!-- END GENERATED cordis-surface -->
