# Agent Note: Composer knowledge and office chips fit the control row

Status: implemented

English | [中文](2026-09-11-composer-knowledge-and-office-chips-fit-the-row.zh.md)

## Problem

The Team composer's control row carries the command, attach, permission, knowledge, and office controls on the left and the model, context meter, and send controls on the right. The permission and model chips drop their text below fixed row widths (the 460px and 360px `@container` cuts on the anonymous size container that ui-conversation `InputBar.module.css` `.row` declares), but the knowledge and office chips kept theirs. With both side panels open, the narrow composer showed an icon-only permission chip beside full-text `知识库` and `办公` chips. Separately, the knowledge chip joined every chosen base's name (`产品技术文档、公司治理报告`); two ordinary names already outgrew a 712px row and pushed the model and send controls onto a second line.

## Decision

- **Both chips share the permission chip's 460px cut.** `KnowledgeSelect.module.css` and `OfficeSelect.module.css` hide `.label` under the same anonymous `@container (max-width: 460px)` query, so the three left-zone chips collapse together to icon and chevron. The business tint still marks a chosen scope or kind, and each trigger's `aria-label` still states it.
- **Several chosen knowledge bases read as a count.** `chipLabel` in ui-knowledge `scope.ts` shows a single chosen base by name and two or more as `{count} 个知识库` / `{count} knowledge bases`. `scopeNames` keeps the joined names, and the trigger's `aria-label` reads them, so assistive technology still announces every chosen base.

## Alternatives considered

- **First name plus a remainder count (`产品技术文档 +1`).** Rejected: the chip's width still follows the first name's length, so a long first name wraps the row again, while the count has a short fixed width.
- **A lower `max-width` that ellipsizes the joined names.** Rejected: a truncated list names neither base completely and still takes the widest slot in the row.
- **Removing the row's `flex-wrap`.** Rejected: the wrap keeps the left chips from overlapping the model trigger when the row is too narrow (the `.trailing` rule in `InputBar.module.css`).

## Consequences

- A member sees the chosen names in the menu, not on the chip face, once two or more bases are chosen.
- At a 358px composer card (both side panels open in a 1280px window) the row still wraps the model, meter, and send controls onto a second line with every chip icon-only: the left group needs about 236px and the trailing group about 130px of the 342px row. Keeping one line there needs a row-level change, not a chip change.
- A single chosen base with a long name still widens the chip up to its 220px `max-width`.
- `packages/client/ui-knowledge/tests` pins the count label and the full-name `aria-label`. The container cut is CSS only; jsdom evaluates no container queries, so it was checked by rendering the real module sheets with Playwright at 358px and 712px card widths.
