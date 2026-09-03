# Agent Note: The hero greeting follows the part of the day

Status: implemented

English | [中文](2026-09-02-the-hero-greeting-follows-the-part-of-the-day.zh.md)

## Problem

The blank-session headline said one thing at every hour: `你好，{name}。今天有什么计划？`. It is the first line a member reads, and it is the only line on an otherwise empty page, so it carries the whole tone of the product for that moment. A member opening the page before the morning gathering, over lunch, and at one in the morning met the same sentence, and asking about the day's plan reads as a mistake at half past midnight.

## Decision

**Seven parts divide the local day, and one table owns them.** [`day-parts.ts`](../../../../packages/team/team-local-login/src/client/day-parts.ts) lists the boundaries in ascending order — 06:00, 08:30, 09:00, 11:30, 13:00, 17:30 — beside the part each one closes: late night, early morning, the morning gathering, the rest of the morning, midday, afternoon. Evening is the part that runs from the last boundary to midnight, which is why it is the only one not in the table. `dayPartAt` returns both the part that owns a moment and the milliseconds until the next one begins, so the two facts cannot drift apart.

The gathering is its own part rather than a slice of the morning: it is a company ritual with its own sentence, and the two morning parts open the same way but ask different things.

**The clock is the member's browser clock.** A Team Runner is loopback on the member's own machine, so the browser and the Runner read the same clock; deriving the part in the component keeps the greeting a client concern and adds no request.

**Both lines are locale-owned, keyed by part.** `hero.<part>.greeting` addresses the display name and `hero.<part>.tagline` carries the line under it, in both dictionaries. The greeting alone does not identify the part — two parts say `上午好` — so the tagline is what makes the division visible.

**An open conversation crosses into the next part.** The component holds the current window and schedules one timeout for `endsIn`; the blank hero is exactly the screen a member leaves open, and a greeting frozen at page load would be wrong for hours.

**The name still gates the whole headline.** Nothing renders until `/team/account` answers, as before: this is the first thing on the page, and a name that appears and then changes reads as the wrong member's.

## Alternatives considered

**Read the part once, when the component mounts.** Rejected because the blank conversation is the screen that stays open — a member who opens it at 08:29 and starts typing at 09:10 would be invited to the gathering that has ended. One timeout to a boundary already known costs less than the staleness.

**Poll the clock on an interval.** Rejected: the part changes seven times a day at minutes the table already names, so a wake every minute buys nothing over waking exactly at the boundary.

**Keep the copy in the Conversation shell and let the shell pick the part.** Rejected for the reason the headline became a slot: the shell has no account, and the greeting names the member. The parts live with the package that reads the identity.

**Make the boundaries a plugin `Config`.** Rejected because the boundaries and the sentences are one product decision — 08:30 exists because a sentence about the gathering exists — and a configurable boundary invites a deployment to move it away from the copy that selects it. Revisit if a deployment needs a working day these parts do not describe; the change is then the table and the dictionary together.

## Consequences

The dictionary grew from one greeting to fourteen keys per language, and `satisfies Record<TeamAccountKey, string>` keeps English complete against the Chinese key set as parts are added or renamed. The English taglines are written for English readers rather than translated line by line, and `hero.morningSong.tagline` says "the company song" where the Chinese names 中微 — an English deployment that wants the name says so in its own dictionary.

The headline is two lines now, so the hero stack is taller and the composer sits lower on a blank session.

The greeting is exactly as right as the member's system clock; a machine set to the wrong zone greets from that zone. That is the clock the rest of their working day already runs on, so no correction is attempted.

`day-parts.spec.ts` pins every part and the wait to each boundary, including the wait to midnight from the last part. The component suite pins one crossing (08:29:59 to the gathering) and that a slower account read cannot put an older name back on the page. None of this copy reaches a model or a session log, so no snapshot owns it.
