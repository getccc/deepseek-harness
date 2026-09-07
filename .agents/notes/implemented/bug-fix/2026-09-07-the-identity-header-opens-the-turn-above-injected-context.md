# Agent Note: The identity header opens the Turn above injected context

Status: implemented

English | [中文](2026-09-07-the-identity-header-opens-the-turn-above-injected-context.zh.md)

## Problem

[小微 is the assistant's name and face](../feature/2026-09-05-xiaowei-is-the-assistants-name-and-face.md) put the identity header on the Turn-process control when the control is shown and on the first Assistant step otherwise. A reply's first rows are often not the first step: the request assembles injected context — the system-prompt section, the skill catalog, workspace instructions — and those `context` rows sit between the member's words and the step in the flow. While a Turn ran, the reader saw two `上下文注入` rows and then 小微's header, and a closed Turn whose control stays hidden kept that order. The product owner reported it from a live session: the header belongs at the top of the reply.

## Decision

**The seat of the Turn's first visible activity row renders the header.** [`ChatNodeSeat`](../../../../packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx) selects the Turn's leading key: `turnActivityLead` in [`turn-activity.ts`](../../../../packages/client/ui-chat/src/client/chat/turn-activity.ts) walks the Turn's ordered keys, skips the rows that precede the reply (`system-prompt`, `user`, `steering`), returns the Turn-process control when it is shown (its anchor precedes every process row, and the folded rows under it are then not candidates), and otherwise the first remaining row, whatever its kind. The selector yields the resolved `TurnLocation` for that one seat and `undefined` for every other, so a growing Turn re-renders only its lead. [`TurnActivityHeader`](../../../../packages/client/ui-chat/src/client/chat/TurnActivityHeader.tsx) mounts there, owns the calendar-day tick, and derives the owner share from the Turn: `running` while it is open, `settled` once closed, and the clock from `turn/start`, falling back to the leading step's own time when the Turn's start is outside the loaded window. The Turn-process control and the Assistant step no longer render the header, and `renderIdentity` leaves the node owner props for the seat's own props.

**The status is the Turn's, not the step's.** The owner share's `status` narrows to `running | settled`: the header speaks for the whole reply, and the step-level `interrupted` state belongs to the step's own rendering.

## Alternatives considered

**Move the context rows below the first step.** Rejected: the flow is the durable order of the Session log, and the injected context did reach the model before the step; reordering rows would misstate what happened.

**Render the header from the context row's own view when it is first.** Rejected: every kind that can lead — context, retry, error, step, control — would need the same guard, and each would need the Turn's other rows to decide. One selector in the seat decides once.

**Keep the header on the step and hide the context rows until the fold.** Rejected: a running Turn has no fold yet, and the rows are useful while it runs.

## Consequences

The header now also heads a Turn whose reply is a retry chain or an error with no step, because those are the reply. Web expected outputs are unchanged: the generic scenarios have no occupant, and a closed Turn's control still leads. The chat suite pins the header above injected context while streaming, on the first step when nothing precedes it, on the control across a fold, on a plain answer's step, and its absence for a Turn of the member's words alone. `turnProcessLayout` moves from the seat into `turn-activity.ts` unchanged.
