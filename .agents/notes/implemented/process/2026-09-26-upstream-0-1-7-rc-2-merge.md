# Agent Note: Merge of upstream 0.1.7-rc.2

Status: implemented

English | [中文](2026-09-26-upstream-0-1-7-rc-2-merge.zh.md)

## Problem

Upstream released `dsh-v0.1.7-rc.2` with 268 merged pull requests past `dsh-v0.1.6-alpha.2`, the last release this line merged ([previous merge](2026-09-18-upstream-0-1-6-alpha-2-merge.md)). The release replaces three things the Team Edition builds on: agent presets become plugin rows declared by bundles (`agent-preset` plus `agent-preset-registry`) instead of directories scanned by `agent-presets`; the official DeepSeek adapter keeps only the Messages API, and its route registration moves into `llm-deepseek-api-key` beside a new DeepSeek account route; and Session logs move to format V4, whose V3 migration refuses any required V3 event it does not know. It also rewrites the Workspace browser's Session row actions into slot-registered pin, rename, fork, and archive actions, replaces the whole-turn tool-count summary with a status and duration, renames every icon primitive, and adds a DeepSeek account sign-in with its own sidebar launcher.

## Decision

Merge the tag in one step on the branch `merge/upstream-0.1.7-rc.2`, as a merge commit followed by adaptation commits. Fork behavior wins where the two sides contradict; every other upstream change is carried.

Fork behavior re-seated on upstream's new structure:

- **Chat mode.** The `chat` preset is a `@deepseek-ai/dsh-agent-preset` row in the Web bundle's `presets/chat.patch.yml` with `workspace: none`. `agent-preset-registry` gains the `workspace` declaration, the `chatDefault` configuration, `resolveFor(workspace, id?)`, and the `agent-preset/workspace-mismatch` refusal in `select`, so cwd-less Session creation and the webhook keep resolving the preset they did. The settings section and the new-task picker keep their chat-mode rules on upstream's rewritten stores.
- **Recent list.** `RecentBrowser` keeps the `sidebar.recent` hole but renders the Workspace browser's own row seats, which the browser shares through a package-private store while it is mounted. Chat sessions therefore get upstream's pin, rename, fork, archive, hover actions, and plugin row marks instead of the fork's separate action object.
- **Company models.** `llm-deepseek` keeps a transport-only Chat Completions adapter (`src/chat-completions/`) for the `built-in` route, because the Team transport carries the `chat.completions` operation. `llm-deepseek-api-key` registers that route while `llmHttpTransport` is injected and keeps the member route dormant until its key resolves. The direct-fetch and Files API branches of the old Chat Completions adapter are dropped: the member route speaks Messages only, as upstream decided.
- **Released Sessions.** `RELEASED_V3_EVENT_TYPES` carries `bi/scope`, `knowledge/scope`, `office/kind`, and `web/access`, which the released WeWork V3 writer recorded as required events; `verify-v3-event-vocabulary` matches the fork's last V3 writer exactly.
- **DeepSeek account.** The Team bundle disables `deepseek-account`, `llm-deepseek-account`, `account-controller`, and `ui-settings-account`: a personal platform balance would bypass the Control Plane's grants and audit, and the Account launcher claims the `settings.launcher` slot, now declared by `ui-settings`, that the Team account launcher fills.
- **Transcript identity.** The 小微 identity header and persona wording move onto upstream's turn status control ("小微用时 {duration}") rather than restoring the fork's tool-count summary.

## Alternatives considered

- **Keep the `agent-presets` package as a fork copy.** Rejected: upstream's Settings page, Creator mode, plugin manager, and composition inventory all read the registry, so a second preset system would split every consumer.
- **Move the company route to the Messages protocol.** Rejected for this merge: it needs a new transport operation and a Control Plane release on every deployment, while the current Chat Completions path works unchanged.
- **Declare a second copy of the row seats for the Recent list.** Rejected: a seat has one declaring entry, and a copy would hide plugin row actions and schedule marks from chat rows.

## Consequences

Workspace dependency ranges follow upstream's rule (`workspace:*` for DSH packages, `workspace:~` for vendor and native), and fork packages carry the root version.

A V4 migration of this machine's Session store converted every V3 log, fork events included. Nine early v0 logs that recorded `knowledge/scope` or `office/kind` still fail at the frozen v0 edge, whose payload table does not list them; the same logs fail on the branch before this merge, so the merge neither causes nor fixes it.

The sidebar's leading controls are three on macOS with the sidebar collapsed (toggle, New chat, New work task), so the frame's leading clearance grows to 196px, or 120px in fullscreen. The new-session shortcut starts a work task.
