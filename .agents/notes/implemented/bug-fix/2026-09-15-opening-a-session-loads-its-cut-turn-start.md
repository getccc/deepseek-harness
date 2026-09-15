# Agent Note: Opening a Session loads the start of the turn its window cuts

Status: implemented

English | [中文](2026-09-15-opening-a-session-loads-its-cut-turn-start.zh.md)

## Problem

A Session opens with a 50-message page counted back from its tail. When the last turn holds more than 50 messages, the page starts inside that turn, and its `turn/start` stays in older history. Turn-scoped Conversation Definitions start only on `turn/start`; the assembler keeps their updates pending until the start arrives. After a browser refresh, a 55-step PowerPoint turn therefore rendered its tool rows but not the `dsh-univer-office` review card, which is a turn-scoped view, while shorter Word and Excel turns kept theirs. Pressing 加载更早 brought the card back.

## Decision

After the opening window is installed, the Session client names the turn the window opens inside of: the turn of the first turn-scoped event that precedes any `turn/start`. When there is one and history has more, it prepends 200-message pages until that turn's `turn/start` is in the window. It loads no older turn, stops on a page that makes no progress, stops when the stream generation moves, reports busy through `loadingOlder`, and fails soft on a thrown page with the opened window kept. The server's message-aligned pagination is unchanged.

## Alternatives considered

- **Align every server page to a turn boundary.** Rejected: the pagination contract and its host tests intentionally allow a page to start inside a turn, and every page would then carry a whole turn regardless of what the client renders.
- **Let the univer plugin start its turn view without `turn/start`.** Rejected: the fix would live in a third-party bundle, and every other turn-scoped Definition would keep the same gap.
- **Raise the opening page size.** Rejected: any fixed size is exceeded by a longer turn.

## Consequences

Opening a Session whose last turn is long costs one or more extra history round trips and loads that whole turn, which a client that followed the turn live already held. `session.client.spec.ts` pins the paging stop at the cut turn's start, no paging at a turn boundary, the no-progress and generation stops, and the soft failure.
