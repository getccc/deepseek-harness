# Agent Note: The hero tagline changes every half hour

Status: implemented

English | [中文](2026-09-05-the-hero-tagline-changes-every-half-hour.zh.md)

## Problem

[The hero greeting follows the part of the day](2026-09-02-the-hero-greeting-follows-the-part-of-the-day.md) gave the blank-session headline seven parts, each with one greeting and one tagline, so a member saw the same tagline for the whole afternoon — four and a half hours of it — and the greeting never said who was speaking. The product's copy table now names the speaker, the assistant 小微, in every greeting, and gives each half hour of the day its own tagline: forty-eight lines that follow the light through the day, from `夜色归于宁静` at midnight to `临近子夜时分` at 23:30, with the sample member Harry standing where the display name goes.

## Decision

**The greeting stays keyed by part; the tagline is keyed by half hour.** `hero.<part>.greeting` keeps its name and now reads `Hi {name}，<时段>好！我是小微，…`. `hero.tagline.<HHMM>` carries the line under it, one key per half hour named by the local minute it starts at, `0000` through `2330`. The seven parts survive because the greeting still asks different things in different parts — the morning and the afternoon ask about work, the rest offer help — and because the part table is where 08:30 exists.

**Every part boundary is a half hour, so one timer serves both lines.** `halfHourAt` in [`day-parts.ts`](../../../../packages/team/team-local-login/src/client/day-parts.ts) returns the part, the half hour, and the milliseconds until the next half hour begins; the component schedules one timeout for that, and the greeting cannot change at any other moment. `HalfHour` is the template type `${Hour}${'00' | '30'}` over the twenty-four two-digit hours, so `t` refuses a tagline key for a half hour that does not exist and refuses a half hour whose tagline is missing from the dictionary.

**The copy is the product's table, projected.** The Chinese dictionary is the table row by row, with `{name}` where Harry stood. The English lines are written for English readers, as before; the assistant's name is rendered `Xiaowei`, and an English deployment that wants another rendering says so in its own dictionary.

## Alternatives considered

**Key taglines by part and index, `hero.afternoon.tagline.3`.** Rejected: the table is flat, a half hour is what a copy editor sees, and an index inside a part says nothing about when the line shows. The `HHMM` name is the time on the clock.

**Forty-eight parts.** Rejected: the greeting has seven sentences, not forty-eight, and a part is defined by the sentence it speaks. Splitting parts would repeat each greeting up to thirteen times in both dictionaries.

**Poll the clock every minute.** Rejected for the reason the earlier note gives: the lines change at minutes already known, and one timeout to the next half hour is exactly the wake the change needs.

**Keep one tagline per part and rotate the extra lines at random.** Rejected: the table ties each line to its hour — 23:30 says midnight is near — and a random draw would say so at 18:00.

## Consequences

The dictionary is fifty-nine keys per language: three launcher strings, seven greetings, forty-eight taglines, and the member fallback. `satisfies Record<TeamAccountKey, string>` keeps English complete against the Chinese key set as lines are added or renamed, and a missing tagline key fails the client typecheck at the `t` call in `HeroGreeting.tsx`.

The component wakes forty-eight times a day instead of seven; each wake is one `setTimeout` on a blank page.

The earlier note keeps the decisions it still owns — the seven parts, the browser clock, the crossing, the name gating the headline — and points here for the tagline's key and the timer's target.

`day-parts.client.spec.ts` pins every part, the half-hour name at both halves of an hour, and the wait to the next half hour, including the wait to midnight. The component suite pins the crossing at 08:30, where the greeting and the tagline change together, and the crossing at 09:00, where the greeting changes with the half hour. None of this copy reaches a model or a session log, so no snapshot owns it.
