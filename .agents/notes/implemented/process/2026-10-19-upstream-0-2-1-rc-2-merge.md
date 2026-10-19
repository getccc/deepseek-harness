# Agent Note: Merge of upstream 0.2.1-rc.2

Status: implemented

English | [中文](2026-10-19-upstream-0-2-1-rc-2-merge.zh.md)

## Problem

Upstream released `dsh-v0.2.1-rc.2`, 2,373 commits past `dsh-v0.1.7-rc.2`, the last release this line merged ([previous merge](2026-09-26-upstream-0-1-7-rc-2-merge.md)). The release replaces several structures the Team Edition builds on: Session creation becomes `createSession`, which reuses a named blank Session instead of adopting an explicit identity; the chat transcript renders through a new `conversation.chat.flow` slot; the Web runtime advertises a `publicUrl` and moves the developer prompt sections into a `harness-dev-context` row; browser-session cookies are scoped by listener scheme and carry `Secure` on TLS listeners; the runtime-invariant companions are removed; and the popup command shell gains grouped options and search modes.

## Decision

Merge the tag in one step on the branch `merge/upstream-0.2.1-rc.2`, as a merge commit followed by adaptation commits. Fork behavior wins where the two sides contradict; every other upstream change is carried.

Fork behavior re-seated on upstream's new structure:

- **Chat Sessions.** `ApiSessionCreateRequest.cwd` may be absent. `createSession`, `claim`, and `createAgent` create a Session without a cwd, compose the roster's `chatDefault` through `resolveFor`, and `session.create` echoes the cwd a Session owns. A deployment without a roster refuses a location-less create with `session/location-required`. Cold listing keeps cwd-less Sessions.
- **Default model.** `settleDefaultSelection` still binds a Session without its own selection to the model catalog's default before prompt admission.
- **Identity header.** `conversation.chat.assistant-identity` is a child of `conversation.chat.flow`; `ChatFlow` builds `renderIdentity` and the Turn's leading `ChatNodeSeat` renders `TurnActivityHeader`.
- **Web surface.** `web-app` keeps `entryPath`, `surfaceAudience`, and `surfaceName` beside `publicUrl`. The developer audience takes its orientation from `harness-dev-context`; the `member` audience registers its own `app:web-surface` section, and the Team bundle disables `harness-dev-context`.
- **Browser session.** `issueSession`, `lock`, and `endSession` take the listener's TLS state, so the Team login, handoff, and lock routes use upstream's cookie audiences.
- **Workspace navigation.** New work tasks reuse only pristine blanks through upstream's named-blank creation; New chat names the pristine chat Session or creates one without a location, and the Host's reuse rule replaces the client's writer-held fallback.
- **Popups.** The multi-select popup kind carries upstream's search copy and modes, and ticks rows inside upstream's grouped listbox.
- **Company models.** The `built-in` Chat Completions adapter shares upstream's once-per-route extension logging and reports acceptance failures.
- **Control Plane command line.** Upstream's generated CLI reference runs every shipped profile's `--help` and requires silent stderr. The `team-control-plane-startup` row parses the command line and publishes `teamControlPlaneStartup`, which every other Control Plane row injects, so help opens no store and binds no listener; the fork's SQLite stores load `node:sqlite` when they open.
- **Wording and branding.** 小微 wording moves onto upstream's renamed turn-process keys ("小微已完成，用时"), the permission labels stay 只读／工作区可写／完全访问, and `ui-brand-official` stays removed.

## Alternatives considered

- **Keep `ensureSession` beside `createSession`.** Rejected: upstream's commands, tests, and blank reuse all go through `createSession`, so a second creation path would fork every consumer.
- **Re-add the developer prompt sections to `web-app`.** Rejected: upstream moved them to `harness-dev-context`, whose legacy-paragraph projection keeps resumed Sessions' prompts stable; only the member orientation stays in `web-app`.

## Consequences

The host aggregate program needs about 4.5 GB to type-check, so the host compiler heap is 6 GB. Upstream's Typert gate refuses imports that resolve to built output, so the fork's `/types` and `/client` subpath exports have hand-written source aliases in `tsconfig.base.json`.
