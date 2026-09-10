# Agent Note: Two-stage merge of upstream 0.1.5-rc.1

Status: implemented

English | [中文](2026-09-10-two-stage-upstream-merge.zh.md)

## Problem

After the [selective picks](2026-09-10-selective-upstream-0-1-5-picks.md), three upstream capabilities were wanted on this line and none of them is a pick: generic file upload with background progress ([note](../feature/2026-08-26-generic-file-upload.md)), continuable subagents with a steerable queue ([note](../feature/2026-07-28-continuable-subagent-conversations.md)), and the right Sidebar with tabs, split, full screen, document previews, and explicit file delivery ([note](../architecture/2026-09-05-sidebar-tab-types-and-navigation.md)). All three sit on session format v2 and v3, `SessionHandle` persistence, the apiremote error contract, and the chat surface rewrite, which the picks had left behind; a piecemeal port would have carried each foundation by hand.

## Decision

Take the foundations as two full merges, verified after each: `dsh-v0.1.3-alpha.2` first, then `dsh-v0.1.5-rc.1`, on the branch `merge/upstream-0.1.3-alpha.2`. Each stage is two commits: the textual resolution of the merge, then the adaptation that makes the tree compile, test, and pass the documentation gates. Generated catalogs, graphs, and Web goldens take upstream at the textual step and are regenerated at the adaptation step; the Chinese side of an English-only generator output is ported section by section from the previous adaptation and re-recorded.

The third-party sidebar, office previewer, Univer, and ECharts plugins the Team installer shipped are dropped in favor of upstream's Sidebar and file delivery: `SHIPPED_PLUGIN_BUNDLES` in `apps/team-runner-desktop/src/profile.ts` is empty, and the Team profile manifest on a member's computer lists only the Runner-carried bundles. Historical session logs need no migration path on this line: sessions recorded before the merge are re-created rather than converted.

Fork-owned behavior re-seated on upstream's structure rather than kept as a diverging copy: the assistant identity header is a `useChat` selector in upstream's `ChatNodeSeat` that renders `TurnActivityHeader` on the Turn's leading row, with the lead computed from upstream's per-Turn process presentation instead of a private copy of that layout; the browser lock route and `browserSession` sit inside upstream's `webServer` inject in `client-connection`; `PopupMultiSelectSpec` joins upstream's `PopupSelectSpec` and `ActionSpec` union; the settings launcher slot wraps upstream's trigger and connection indicator; the Welinkin mark and name are the Sidebar's fallback brand and the hero headline slot replaces the fish; the 小微 wording stays on upstream's locale keys, with `reasoning.running` as the one fork key the reasoning row reads.

Repository rules met along the way: invariant companions that assert nothing are removed with a README reason sentence instead of shipped empty; `gen-config-catalog` resolves `...spread` object fields so the Control Plane config packages generate; `gen-tsconfig-paths` owns `tsconfig.base.json` with hand-written entries for the four packages whose names differ from their directories; `gen-persistence-catalog` owns `known-event-types.ts`, which had lacked the fork's `office/kind` event.

## Alternatives considered

- **Port the three features as picks on the selective line.** Rejected: the dry runs put file upload alone at sixty conflict hunks across twenty-eight files, and every one of the three needs the same session and chat foundations.
- **Merge `dsh-v0.1.5-rc.1` in one step.** Rejected: 265 conflicted files against the selective line, with no point at which the tree compiles between the two format generations.
- **Keep the third-party sidebar beside upstream's.** Rejected: both claim the right column and the file-open door, and the office previewer registered with the third-party service only.

## Consequences

Stage 1 landed as `c22bd0a46f` and `794ec7891c`; stage 2 as the textual checkpoint `beb016e1d6` and the adaptation commit that carries this note. Typecheck, lint, the translation pairing of 898 pairs, and the package-invariants gate are green at the end of stage 2; the unit failures that remain are the ones the `dev` line already had (the app-frame title, the administration console without its built frontend, CPython 3.9 for the Python runtime) plus two upstream suites that fail on macOS with unchanged upstream content. Web goldens are upstream's and need a local refresh with the fork brand. Office documents the tools write reach the member through the workspace and the Sidebar's file tree; the produced-file recognizer of `ui-office` left with the third-party previewer, and a delivery through upstream's `deliverFile` seam is the follow-up. The [deliverable cards](../feature/2026-09-04-deliverable-cards-open-in-the-sidebar.md) and [desktop installer](../architecture/2026-09-03-desktop-installer-carries-the-deployment.md) notes are superseded where they describe the shipped plugin tree.
