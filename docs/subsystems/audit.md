# Audit

English | [中文](audit.zh.md)

The audit trail records what a principal did to a company resource and what the answer was, so an administrator can show that access was authorized. The subsystem is one seam — [`dsh-audit`](../../packages/access/audit) (`ctx.audit`) with the [`dsh-audit-sqlite`](../../packages/access/audit-sqlite) backend — and it is server-side only: the Control Plane composes it, no Runner mounts it, and models never see it. Design record: [audit vocabulary Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-audit-closed-vocabulary.md).

## The trail proves authorization; it is not a copy of anyone's work

A member's prompts, code, paths, diffs, terminal output, tool arguments, and tool results stay on their own machine. What reaches the trail is who acted, what they acted on, how it ended, and a few counted or enumerated facts.

That is a design property here rather than a policy anyone has to remember, because a record has nowhere to put prose. The columns are fixed, so there is no free-text field to fill; the actions and refusal reasons are closed word lists; and the remaining values are metadata keys whose kinds admit a count, a listed word, or a short token.

## A token cannot hold a sentence

Every caller-supplied string — `resourceId`, `deviceId`, `correlationId`, and any `ref` metadata — must match [`AUDIT_TOKEN`](../../packages/access/audit/src/metadata.ts): at most 64 characters drawn from letters, digits, and `. _ : @ -`.

The excluded characters do the work. No space rules out prose, no slash rules out a filesystem path or a URL, and the length rules out whatever survived both. A model ref, a semantic version, and a UUID all pass unchanged.

## Two catalogs, both seeded from code

[`AUDIT_ACTIONS`](../../packages/access/audit/src/actions.ts) is every operation this build records. A caller names an action and never a resource type: the type comes from the catalog, so a record cannot describe a role change as a device event.

[`METADATA_KEYS`](../../packages/access/audit/src/metadata.ts) is every extra fact a record may carry, each declaring a kind — `count`, `label` with its members listed in full, or `ref`. Each action then declares which of those keys it carries, so a login records how the member authenticated and nothing else.

Both catalogs grow with the subsystems that write to them. An action nothing records is an entry no reader can trust, so company-resource actions arrive with the gateways that perform them.

## The database refuses what the service refuses

The SQLite backend seeds both catalogs into tables and points the event and metadata rows at them with foreign keys, and it declares the token rule again as a `CHECK` on every text column. The outcome and reason columns are constrained to the same word lists the code exports, rendered into SQL from those arrays rather than restated by hand.

A caller that opened the database directly, bypassing the service, is refused by the schema — which is what makes the privacy claim a property of the store rather than a habit of its callers.

## The trail is append-only

There is no method to amend or remove a record, and both tables carry triggers that abort `UPDATE` and `DELETE`. A reader who cannot rewrite history is what makes the trail worth reading.

The sequence number is `AUTOINCREMENT` rather than a plain rowid alias, so a value is never handed out twice over the lifetime of the trail.

## Reading back

A query narrows by principal, action, resource type, outcome, and time window, and pages backwards from a sequence number. Events come back newest first, because that is the order a person investigating reads them. The deployment's configured maximum caps every read; a reader asking for fewer is served what it asked for.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
