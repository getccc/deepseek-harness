# Agent Note: Pre-V3 WeWork Sessions keep their knowledge-scope and office-kind events

Status: implemented

English | [中文](2026-09-26-wework-pre-v3-session-events.zh.md)

## Problem

WeWork builds wrote Session format v0 until the upstream 0.1.5-rc.2 merge moved the writer to V3 on 2026-09-11; the two integration checkpoints for upstream 0.1.3-alpha.2 on 2026-09-10 wrote v2. Those writers recorded `knowledge/scope` (from 2026-09-01) and `office/kind` (from 2026-09-03) as required events. The frozen v0 inventory in `session-format-v0-to-v1` listed only upstream's released events, and the v1→v2 and v2→v3 edges reuse that inventory, so opening such a Session refused migration with `unknown historical event type "knowledge/scope"`. A copy of one member's Session store held 9 such v0 logs among 164.

## Decision

`RELEASED_V0_EVENT_DISPOSITIONS` admits both events with exactly the payload members those writers recorded:

- `knowledge/scope`: `version` 1 and `mode` `off`, `all`, or `selected`. `selected` requires a non-empty `bases` array of `{ ref, displayName }`; `ref` follows the released `<providerKind>:<sourceCode>:<upstreamId>` grammar (audit-token segments, a source code of at most 19 characters, at most 64 characters in total) and `displayName` is non-empty. The other modes omit `bases`.
- `office/kind`: `version` 1 and a `kind` from every value a released office picker wrote: `none`, `word`, `excel`, `ppt`, `chart`, and the retired `amec-ppt` and `welinkin-ppt`.

`RELEASED_V2_EVENT_DISPOSITIONS` inherits both entries, so v1 intermediates and v2 sources follow the same path. The events reach V4 unchanged, where `RELEASED_V3_EVENT_TYPES` already names them ([merge note](../process/2026-09-26-upstream-0-1-7-rc-2-merge.md)). Installed readers treat a retired kind as `none`, because `foldOfficeChoice()` discards a kind it cannot render.

`bi/scope` and `web/access` stay outside the v0 and v2 inventories. `web/access` first appeared on 2026-09-15 and `bi/scope` on 2026-09-17, both after the writer moved to V3, so no v0–v2 log holds them. Migration publishes a V4 successor beside each unchanged historical generation, as the [adjacent migration decision](../architecture/2026-08-31-released-session-format-migrations.md) requires.

## Alternatives considered

**Admit the WeWork events as opaque JSON.** Installed readers fold `knowledge/scope` data without parsing it again, so an opaque admission would pass a malformed scope into the knowledge prompt section. The v0 edge validates every admitted payload to prevent that.

**Admit only the office kinds the current picker offers.** Members' logs record `amec-ppt` and `welinkin-ppt` from builds that shipped between 2026-09-03 and 2026-09-09; refusing those values would leave the Sessions unreadable.

**Add `bi/scope` and `web/access` to the v0 and v2 inventories as well.** No writer before V3 recorded them, so no payload exists to audit, and admitting them would accept events that only a corrupt or fabricated log can carry.

## Consequences

Pre-V3 WeWork Sessions migrate to V4 with their knowledge scope and office kind intact. On a copy of this machine's Session store taken on 2026-09-26, `scripts/migrate-sessions-to-v4.ts` converted 163 of 164 Sessions, up from 154; the remaining failure is a pre-existing corrupt `tool-call-chunks` row. Each of the 9 newly converted v0 sources kept its bytes, and its V4 successor carries the same scope and kind events in the same order.

[`validation.spec.ts`](../../../../packages/session/session-format-v0-to-v1/tests/validation.spec.ts) covers every released value and the refused variations. [`wework-historical-events.spec.ts`](../../../../packages/session/session-format-catalog/tests/wework-historical-events.spec.ts) restores v0 and v2 fixtures to the current writer and checks the `bi/scope` and `web/access` refusals.
