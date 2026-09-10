---
description: "The audit Service Definition and its closed vocabularies: an action catalog, a metadata key catalog, and the value rules that keep task content out of a record."
kind: "package-reference"
---

# @deepseek-ai/dsh-audit

English | [中文](README.zh.md)

## Summary

`dsh-audit` records what a principal did to a company resource and how it ended, so an administrator can show that access was authorized. It is not a copy of anyone's work, and that is a property of the record rather than a rule someone has to follow: the columns are fixed, the actions and refusal reasons are closed word lists, and the only caller-chosen values are metadata keys whose kinds admit a count, a listed word, or a short token. A prompt, a path, or a diff satisfies none of them. Pair it with a backend such as [`audit-sqlite`](../audit-sqlite/README.md).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import '@deepseek-ai/dsh-audit'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId
declare const deviceId: string

await ctx.audit.record({
  orgId, principalId, action: 'device.bind', outcome: 'allowed',
  deviceId, metadata: { platform: 'darwin', runnerVersion: '2.4.1' },
})

const denials = await ctx.audit.query({ orgId, outcome: 'denied', limit: 50 })
```

A caller names an action and never a resource type: the type comes from [`AUDIT_ACTIONS`](src/actions.ts), so a record cannot describe a role change as a device event. The store assigns the sequence number and the time, so an entry can be neither backdated nor reordered.

### What a record may carry

`resourceId`, `deviceId`, and `correlationId` must match [`AUDIT_TOKEN`](src/metadata.ts) — at most 64 characters of letters, digits, and `. _ : @ -`. Metadata keys must be registered *and* declared by the action, and each value must satisfy its key's kind.

[`checkAuditRecord`](src/validate.ts) returns the problem instead of throwing it, so a store whose `record` is asynchronous rejects with it rather than throwing past a caller's `catch`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Why there is no free-text field

A field that accepts a sentence eventually holds one, and the sentence quotes the request. Removing the field is the only version of this rule that holds without anyone remembering it, which is why a refusal carries an [`AuditReason`](src/vocabulary.ts) word rather than a message.

### Why the metadata catalog is closed and per-action

Registering a key states that some subsystem records it; declaring it on an action states which operation may. Without the second half, any key could ride along on any operation, and "restricted metadata" would mean only that the keys were named somewhere.

### Why the word lists are runtime arrays

`AUDIT_OUTCOMES` and `AUDIT_REASONS` are arrays whose union types derive from them, because a store seeds column constraints from those arrays. The list lives here once, and SQL restates it only by reading this module.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service and `ctx.audit` |
| [`src/actions.ts`](src/actions.ts) | The closed action catalog: resource type and declared metadata per operation |
| [`src/metadata.ts`](src/metadata.ts) | The metadata key catalog, the value kinds, and the token rule |
| [`src/vocabulary.ts`](src/vocabulary.ts) | The outcome and refusal-reason word lists |
| [`src/validate.ts`](src/validate.ts) | The record check and the failures it names |
| [`src/types.ts`](src/types.ts) | Record, event, and query shapes, types only |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`audit-sqlite`](../audit-sqlite/README.md) — the shipped backend.
- [Audit subsystem](../../../docs/subsystems/audit.md) — the vocabularies and the storage rules in full.
- [`access-control`](../access-control/README.md) — the decisions whose reasons the first three `AuditReason` words mirror.

<a id="model-experience"></a>
## Model Experience

None, as the audit trail is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **The catalog covers account, session, device, credential, and policy operations only** — company-resource actions arrive with the gateways that perform them, because an action nothing records is an entry no reader can trust.
- **No boolean metadata kind** — no caller needs one yet, and a kind with no key is a hole nobody is watching.
- **No retention or export here** — the service appends and reads; deleting aged records conflicts with an append-only store and needs its own design.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Adding an action means adding its entry and, if it carries a new fact, a metadata key with a kind. Both are read by a store's schema seeding, so a new entry reaches an existing database on the next start without a schema version bump; retiring one leaves its rows referencing a catalog row that stays behind.

</details>

**Runtime invariant:** No companion is published: the package declares an abstract service and two static catalogs and mounts nothing; a stored record carrying only what its action declares is checked where the record is written, by the provider's schema and tests.
