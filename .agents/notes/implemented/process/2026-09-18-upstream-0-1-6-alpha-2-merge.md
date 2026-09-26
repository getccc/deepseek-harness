# Agent Note: Merge of upstream 0.1.6-alpha.2

Status: implemented

English | [中文](2026-09-18-upstream-0-1-6-alpha-2-merge.zh.md)

## Problem

Upstream released `dsh-v0.1.6-alpha.2` with 75 merged pull requests past `dsh-v0.1.6-alpha.1`, the last release this line merged ([previous merge](2026-09-15-upstream-0-1-6-alpha-1-merge.md)). The release rewrites areas the Team Edition extends: the Conversation becomes a reusable Factory with its own width controls, the Session list drops `current` for local reference counts, `ISessions` loses `open` and `clear` because main-view navigation moves to `uiWorkspace`, the Sidebar gains Windows titlebar and macOS top-strip layouts, profile reload moves from `ProfileTemplate.patchReload` into the `hmr` row, plugin management becomes a service with a Web page, and the right Sidebar gains an Office preview built on Host conversion.

## Decision

Merge the tag in one step on the branch `merge/upstream-0.1.6-alpha.2`, as a merge commit followed by adaptation commits. Fork behavior wins where the two sides contradict; every other upstream change is carried.

Fork behavior re-seated on upstream's new structure rather than kept as a diverging copy:

- Session summaries keep the fork's `kind` beside upstream's `retainedBy`, and every consumer of the retired `SessionListState.current` reads the main-view retention instead.
- `uiWorkspace` keeps the fork's pristine-Session reuse and its chat start while taking upstream's `SessionTarget` navigation, and gains `clearSession()` so the Team sign-in landing and the knowledge panels have a public seat for what `sessions.clear` and `sessions.open` used to give them.
- The Conversation Factory's children carry the fork's `conversation.hero.headline` in place of upstream's brand-mark child, and the composer keeps its voice seat while the context meter moves to the dock with upstream.
- The Sidebar takes the Windows titlebar and the macOS top strip but keeps the WeWork mark and the New chat / New work task rows; the Windows rules that pinned upstream's single New Session button are dropped rather than left pointing at an element this fork does not render.
- The `/` popup keeps its multi-choice shell beside upstream's Tab-accept and current-value highlight.

The Office reader changes owner in the same branch ([decision](../feature/2026-09-18-upstream-office-preview-replaces-the-fork-renderers.md)).

## Alternatives considered

- **Pick the release apart again.** Rejected for the same reason as the previous merge: alpha.2 rewrites the Conversation, the Session list, and profile resolution together, and a selective pick would have to re-derive each of those relationships by hand.
- **Keep `ProfileTemplate.patchReload` as a fork field.** Rejected: upstream deleted the field and moved the lifecycle into the `hmr` row, which `dsh-base` enables for every profile with an empty module-root list. The Team profile inherits configuration-only watching by naming no row, and the Control Plane bundle stacks no base, so it still watches nothing — the two behaviors the field existed to state.

## Consequences

`test:snapshot` and `test:expected` are green through their gates, which run `DSH_EXAMPLE_MODE=lib`. Running `pnpm run test:snapshot` bare now fails: upstream changed the launcher's default profile resolution from `link` to `runtime`, so under the `src` launch some rows resolve through the profile into built `lib/` while the rest fall through to the tsconfig paths map into `src`, and `@deepseek-ai/dsh-tools` loads twice — its `TOOL_RUNTIME_SCHEDULER` symbol then fails to match and every tool call dies in `agent-loop`. Use the gate, or `DSH_EXAMPLE_MODE=lib`, until the source launch owns one plane again.

The fork's runtime-closure gate walks application packages, which upstream's copy does not, so upstream's newly shipped `OPTIONAL_BUNDLES` reached experimental peers through `@deepseek-ai/dsh` and demanded them in the deploy root that `verify-default-product-isolation` keeps free of experimental packages. The gate now stops at an optional bundle, because a person switches one on and its peers arrive with that choice.

Two host-dependent test failures are unrelated to this merge and reproduce on the previous branch: the Python PTC runtime needs CPython 3.10 and this machine's `/usr/bin/python3` is 3.9.6, and one Windows path assertion in `spawn-runner` does not hold on macOS. Upstream's desktop update tests inherited the test host's architecture while stubbing `process.platform` as `win32`, which the update policy's own identity rule rejects on anything but x64; the stub now names the arch.
