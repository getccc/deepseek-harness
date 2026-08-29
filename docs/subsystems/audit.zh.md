# 审计

[English](audit.md) | 中文

审计记录一个主体对公司资源做了什么、答案是什么，好让管理员能够证明访问经过授权。本子系统是一个接缝——[`dsh-audit`](../../packages/access/audit)（`ctx.audit`）配合 [`dsh-audit-sqlite`](../../packages/access/audit-sqlite) 后端——且只存在于服务端：由 Control Plane 组合，任何 Runner 都不挂载它，模型也永远看不到它。设计记录：[审计封闭词汇表 Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-audit-closed-vocabulary.zh.md)。

## 审计证明授权，而不是复制任何人的工作

成员的 Prompt、代码、路径、Diff、终端输出、Tool Arguments 和 Tool Result 都留在他们自己的电脑上。进入审计的是谁动了手、动的是什么、结果如何，以及少量可计数或可枚举的事实。

这在这里是一项设计属性，而不是需要谁去记住的规定，因为一条记录根本没有地方放散文。列是固定的，因此没有可填的自由文本字段；动作和拒绝原因是封闭的词表；剩下的值是 Metadata Key，其种类只接受一个计数、一个列出的词，或一个短 Token。

## 一个 Token 装不下一句话

每一个由调用方提供的字符串——`resourceId`、`deviceId`、`correlationId`，以及任何 `ref` 类 Metadata——都必须匹配 [`AUDIT_TOKEN`](../../packages/access/audit/src/metadata.ts)：最多 64 个字符，取自字母、数字和 `. _ : @ -`。

真正起作用的是被排除的那些字符。不含空格排除了散文，不含斜杠排除了文件系统路径和 URL，长度上限排除了同时挺过这两关的东西。Model Ref、语义化版本号和 UUID 都能原样通过。

## 两份目录，都从代码播种

[`AUDIT_ACTIONS`](../../packages/access/audit/src/actions.ts) 是这个构建记录的每一项操作。调用方指名一个动作，从不指名资源类型：类型来自目录，因此一条记录无法把角色变更描述成设备事件。

[`METADATA_KEYS`](../../packages/access/audit/src/metadata.ts) 是一条记录可以携带的每一项额外事实，每个都声明一种类型——`count`、成员完整列出的 `label`，或 `ref`。每个动作再声明它携带其中哪些 Key，于是一次登录记录成员如何完成认证，除此之外什么也不记。

两份目录都随着向它们写入的子系统一起增长。没有任何东西会记录的动作，是没有读者能够信任的条目，因此公司资源类动作会随着执行它们的那些 Gateway 一起到来。

## 数据库拒绝服务所拒绝的一切

SQLite 后端把两份目录播种进表，并让事件行和 Metadata 行用外键指向它们，同时把 Token 规则作为 `CHECK` 在每一个文本列上再声明一次。Outcome 与 Reason 列被约束到与代码导出的相同词表，SQL 由那些数组渲染而来，而不是手工重述一遍。

一个绕过服务、直接打开数据库的调用方会被 Schema 拒绝——这正是让隐私主张成为存储的属性、而不是其调用方的习惯的原因。

## 审计只追加

不存在修改或删除一条记录的方法，两张表都带有中止 `UPDATE` 和 `DELETE` 的触发器。一个无法改写历史的读者，正是让这份记录值得一读的原因。

序号使用 `AUTOINCREMENT` 而不是普通的 rowid 别名，因此在整条审计的生命周期内，同一个值永远不会被发出两次。

## 读回

一次查询按主体、动作、资源类型、Outcome 和时间窗口收窄，并从某个序号开始向前翻页。事件按从新到旧返回，因为那正是调查者阅读它们的顺序。部署所配置的上限约束每一次读取；请求更少的读者得到它所请求的数量。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaudit--audit-abstract-seam"></a>

### `ctx.audit` — `Audit` (abstract seam)

The audit trail. A provider mounts this service; consumers inject `audit`.

Records are append-only: there is no method to amend or remove one, and a store is expected to refuse both at the database as well. A reader who cannot rewrite history is what makes the trail worth reading.

```ts cordis-catalog
/**
 * Record one operation. The store assigns the sequence number and the time,
 * so a caller can neither backdate an entry nor choose its order.
 * @param record - what happened: the action, its outcome, and who and what it involved.
 * @returns the stored event, including what the store assigned.
 * @throws {UnknownAuditActionError} when the action catalog does not register the action.
 * @throws {InvalidAuditValueError} when a field holds a value its rule does not admit.
 * @throws {UnknownMetadataKeyError} when metadata names an unregistered key.
 * @throws {MetadataKeyNotAllowedError} when the action does not declare a registered key.
 */
abstract record(record: AuditRecord): Promise<AuditEvent>

/**
 * Read events back, most recent first.
 * @param query - the organization to read, and any narrowing the reader wants.
 * @returns the matching events, newest first, bounded by the store's configured maximum.
 */
abstract query(query: AuditQuery): Promise<AuditEvent[]>
```

Source: [`packages/access/audit/src/index.ts`](../../packages/access/audit/src/index.ts)
<!-- END GENERATED cordis-surface -->
