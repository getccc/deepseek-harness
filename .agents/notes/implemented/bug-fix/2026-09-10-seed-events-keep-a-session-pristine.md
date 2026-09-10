# Agent Note: The facts pinned at creation keep a Session pristine

Status: implemented

English | [中文](2026-09-10-seed-events-keep-a-session-pristine.zh.md)

## Problem

`pristine` is the bit New Session reads to hand back an untouched conversation instead of one somebody set up, and the Session-list projection ended it on any event at all. Upstream 0.1.5 pins every fresh Session's permission preset, sandbox mode, and approval policy before anyone sees it, and the Web flow records the mounted agent preset the same way, so after the [two-stage merge](../process/2026-09-10-two-stage-upstream-merge.md) no Session was ever pristine: New Session created another conversation on every click, the hero's first prompt went to a second Session while the first stayed behind as an orphan, and the Web lifecycle scenario counted two materialized Sessions where it expects one.

## Decision

The projection treats the seed events the composition writes at creation — `permission/preset`, `sandbox/mode`, `approval/policy`, `agent-preset/selected` — as describing the build, not a person's choice, so they leave `pristine` alone; every other event still ends it. The projection's `stateVersion` moves to 3 so a cache that counted seed events is recomputed. The fixture Connection mirrors the Host here too: a Session it creates is pristine until its first prompt, which is what the assembled jsdom lane needs to reuse the blank Session and keep the resident composer the paste and echo scenarios drive.

## Alternatives considered

- **Reuse a merely blank Session, as upstream does.** Rejected: the fork keeps a conversation somebody chose a model or the knowledge for out of New Session's hands, and `blank` cannot tell those apart.
- **Time-box the seed window instead of naming the events.** Rejected: an event's meaning is its type, and a closed set stays checkable when a new seed event appears.

## Consequences

A person's own setup — a model choice, a knowledge scope, an office kind, a command, plan mode, a title — still ends pristine. A permission preset picked by hand on a blank Session no longer does, which hands that one preference back to the next New Session on the same computer; the alternative left every conversation unreusable. `session-list-blank.host.spec.ts` pins both halves.
