# Agent Note: an audit record has nowhere to put a sentence

Status: implemented

English | [中文](2026-08-29-audit-closed-vocabulary.zh.md)

## Problem

Team Edition audits logins, device bindings, credential rotations, policy changes, and — later — every company model call and knowledge query. The product promise around all of it is that a member's work stays on the member's machine: no prompts, no code, no paths, no diffs, no tool arguments, no query text.

A promise like that is usually kept by a rule in a document and a reviewer who remembers it. That fails in the ordinary way: someone adds a `details` column because a bug was hard to diagnose, someone puts the upstream error message in it, and the message quotes the request. Nothing announces that the trail now holds the thing it promised not to hold.

There is a second problem underneath. An audit trail is worth reading only if it cannot be rewritten, and a store whose service simply declines to offer an update method is not the same as a store that refuses one.

## Decision

**A record has no free-text field, and the fields it does have cannot hold prose.** The columns are fixed. The action and the refusal reason are closed word lists. Every caller-supplied string — `resourceId`, `deviceId`, `correlationId`, and any `ref` metadata — must match `AUDIT_TOKEN`: at most 64 characters of letters, digits, and `. _ : @ -`. The excluded characters are the point: no space rules out prose, no slash rules out a path or a URL, and the length rules out whatever survived both.

A refusal therefore carries a word from `AUDIT_REASONS` rather than a message. That is the one place a reader most wants a sentence, and the one place a sentence is most likely to quote the request.

**Metadata is a closed catalog, twice over.** `METADATA_KEYS` registers each key with a kind — `count`, `label` with its members listed in full, or `ref` — and each action then declares which of those keys it carries. Registering states that some subsystem records the fact; declaring states which operation may. Without the second half, any key could ride along on any operation, and "restricted metadata" would mean only that the keys had been named somewhere.

**A caller names an action, never a resource type.** The type comes from `AUDIT_ACTIONS`, so a record cannot describe a role change as a device event, and the store has no denormalized copy of it to constrain.

**The schema states every rule again.** The SQLite backend seeds both catalogs into tables and references them with foreign keys, renders the outcome and reason `CHECK` lists from the arrays the definition exports, and repeats the token rule as a `NOT GLOB` check on every text column. Four triggers abort `UPDATE` and `DELETE` on both tables. A caller that opened the database directly is refused by the store, which is what makes the privacy claim a property of the storage rather than a habit of its callers. Its tests write raw SQL through a second connection for exactly that reason: a test that only went through the service would pass against a schema with no constraints at all.

## Alternatives considered

**A JSON metadata column.** Rejected: it is a free-text field wearing a structured name. Anything a caller passes ends up stored verbatim, and no constraint the database can express would stop it.

**A free-form `message` or `details` column, documented as metadata-only.** Rejected for the reason the problem describes. The documented version of this rule survives exactly as long as the next person who needs to debug something.

**Validating only in the service.** Rejected: the store is a durable boundary, and the operations that will write to it — an admin API, an RPC gateway — reach it across a wire where TypeScript's guarantee has already ended.

**Recording the audit inside the access-control and account stores.** Rejected: `createRole` has no principal, no device, and no correlation, so a record written there would have to invent the very fields that make it evidence. Audit is written by the operation that knows who acted, which is the admin API rather than a storage primitive.

**A boolean metadata kind.** Deferred: no caller needs one, and a kind with no key is a hole nobody is watching.

## Consequences

Every new audited capability adds a `(action, resourceType, metadata)` entry, and any new fact it carries adds a metadata key with a kind. Both reach an existing database through the schema's seeding on the next start, without a schema version bump. Retiring an entry leaves its catalog row in place so stored events keep their foreign key; the code catalog is what stops it being recorded again, and a read drops a metadata key the running build has retired rather than surfacing a value no consumer declares.

**Retention cannot be implemented by deleting rows.** The triggers refuse it deliberately. A retention window will need a documented privileged path, such as dropping a trigger inside a schema migration.

**A record does not commit with the change it describes.** Under the SQLite deviation each subsystem owns its own database, so an operation and its audit record commit independently — the same split the policy revision already crosses, since that counter lives in the account store. The design's single-database assumption is what would close this, and consolidating the Control Plane's stores onto one connection is the change that would buy it.
