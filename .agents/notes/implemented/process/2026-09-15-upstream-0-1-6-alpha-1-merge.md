# Agent Note: Merge of upstream 0.1.6-alpha.1

Status: implemented

English | [中文](2026-09-15-upstream-0-1-6-alpha-1-merge.zh.md)

## Problem

Upstream released `dsh-v0.1.6-alpha.1` with 89 merged pull requests past `dsh-v0.1.5-rc.2`, the last release this line merged ([previous merge](2026-09-10-two-stage-upstream-merge.md)). The release rewrites areas the Team Edition extends: the DeepSeek adapter splits into Chat Completions and Messages protocols with Messages as the default, the browser test fixture is replaced by `RemoteMock`, the Workspace browser derives its order from the caller, agent preset selection gains a setting gate, the composer permission select moves into `ui-permission-presets`, `agent/session-start` becomes the awaited `agent/created`, synchronous Session event reads are deprecated, and Session-log upload turns on by default.

## Decision

Merge the tag in one step on the branch `merge/upstream-0.1.6-alpha.1`, as a merge commit followed by adaptation commits. Fork behavior wins where the two sides contradict; every other upstream change is carried.

Fork behavior re-seated on upstream's new structure rather than kept as a diverging copy:

- The Control Plane `built-in` route lives in the Chat Completions protocol adapter: the transport's catalog replaces the connection catalog for that route, images serialize inline, no key is resolved, and the dispatcher always sends `built-in` to Chat Completions because the transport carries only `chat.completions`. The member route follows upstream's protocol default and stays dormant while its key is unconfigured.
- The Recent list, its kind filter, and chat Sessions outside Workspace groups derive their order with upstream's recency helpers; Manual ordering applies only to the Workspace tree and the flat list.
- Workspace-less chat presets keep their badge and never become the settings default under upstream's mode-selection gate, and the hero chip offers only workspace presets.
- The chat composer rules move into `ConversationContent` and the permission slot, `/web` localization joins the built-in command presentation table through its definition id, and the permission labels 只读 / 工作区可写 / 完全访问 move into `ui-permission-presets`.
- The Team bundle disables `session-log-deepseek`, because on the company route the log suffix would reach the company provider through the Control Plane.
- Fork code that reads Session event history synchronously keeps its calls under upstream's deferred-migration lint exception; the fork's tests emit `agent/created` with a `source`.

## Alternatives considered

- **Selective picks as on the 0.1.3 and 0.1.5 lines.** Rejected: the adapter split, the test-infrastructure replacement, and the permission-select move are prerequisites of most later pull requests.
- **Keep the fork's single-file DeepSeek adapter.** Rejected: it forfeits the Messages protocol, Files parity, and the image offload watermark, and every later upstream adapter change would conflict again.
- **Revert upstream's Session-log upload default in the plugin.** Rejected: the member route of a base-only deployment follows upstream; only the Team route carries member work to a company provider.

## Consequences

Typecheck, lint, and `pnpm run build` pass after the adaptation. The unit suite leaves the failures this machine already had (CPython 3.9 for `experimental/ptc-runtime-python`, the macOS `spawn-runner` case) plus upstream's `webworker-packer` image-loadable case, whose test and source are unchanged from the tag. Documentation gates pass with the `packages/README.md` word ceiling raised from upstream's 994 to 1045 for the Team Edition package groups.

The Web e2e lane passes after its fixtures follow fork Session semantics (`pristine`, the `webAccess` Remote, the dormant keyless route) and after opening a Session pages back to its cut turn start in doubling pages instead of fixed 200-message pages. Recorded-session snapshots fail only on the CPython 3.9 PTC scenario. The packaged desktop Runner was not re-run for this merge: upstream moved profile resolution to runtime modes and the packaged carriers onto them, so the WeWork installer build needs its own verification. Migrating the fork's synchronous Session history reads onto projections is deferred work.
