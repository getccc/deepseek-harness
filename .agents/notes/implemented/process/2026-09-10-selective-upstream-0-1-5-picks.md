# Agent Note: Selective upstream 0.1.5-rc.1 picks

Status: implemented

English | [中文](2026-09-10-selective-upstream-0-1-5-picks.zh.md)

## Problem

The `dev` line carries the Team Edition packages and the product identity on top of upstream `dsh-v0.1.2-alpha.1` plus 18 selective picks from `dsh-v0.1.3-alpha.1`. Upstream then merged 112 first-parent commits up to `dsh-v0.1.5-rc.1`, including foundations this line does not have: session format v2 and v3 with `SessionHandle` and sequence brands, the removal of `ctx.agent` and the `Inbox` class, the right Sidebar that replaces the Detail panel, generic file upload in the composer, Web connection recovery, and the runtime-dependency decoupling that moved shared helpers into `dsh-util-values`. A dry-run merge of the tag conflicts in 233 files, most of them inside the client packages the product identity edits and the persistence packages the 45 fork-only packages compose. The fork also keeps product decisions of its own, so a merge that takes upstream defaults wholesale is not acceptable.

## Decision

Upstream changes reach `dev` as per-pull-request cherry-picks in upstream order, one commit per pull request, with the subject ending in `(upstream #NNNN)` and the body naming every on-line adaptation. A pull request is picked when its own change can be expressed with this line's APIs; a conflict caused by a missing upstream prerequisite is ported by hand only when the pull request's own delta is small, and the port is recorded in the commit body. Generated documentation is regenerated with the repository generators rather than merged, and the Chinese side is ported row by row. Product defaults follow this line: the shipped default model stays `deepseek-v4-flash` until the gateway serves `deepseek-flash`, the brand and persona UI stays untouched, and every new package receives the `./invariant` companion this line still requires.

### Picked

Model and provider: #3613 pi-ai 0.85.1, #3724 pi-ai settings recovery, #3792 base URL validation, #3824 DeepSeek-V41-Flash catalog entry, #3507 model-switch notice. Tools and guidance: #3611 base-backed profiles edit with read/write/edit, #3853 scoped tool guidance, #3517 root-marker stat errors, #3523 empty prompt rejection, #3485 (the execution guard only). Client: #3484 resume headers, #3605 nested terminal cards, #3680 thinking summary markers, #3791 Chinese display-mode and model copy, #3839 composer placeholder, #3557 slash-command descriptions, #3409 and #3700 open the workspace in local applications, #3698 and #3368 Windows folder picker. Platform: #3672 lazy observation events, #3673 typert forwarding re-exports, #3686 profiles from templates, #3787 Codex and Claude Code runtimes, #3846 MCP pagination cursors, #3713 and #3720.

### Deferred behind a missing prerequisite

#3580 needs #3305 connection recovery; #3582, #3681, and #3671 need the #3109 file-upload composer; #3590 and #3794 need the #3316 plugin list; #3618, #3630, and #3537 need session format v2 (#3346, #3400); #3789 needs the shell translator from #3305; the activation event and Web resume control of #3485 need the projection state APIs from #2742, #2774, and #3346. Whole clusters stay out until their foundation is ported: the Sidebar (#3569, #3588, #3784, #3798, #3807, #3859, #3890, #3909, #3819, #3832), session format v3 (#3535, #3585, #3586, #3631, #3851, #3866), the explicit agent context (#3295, #2672, #3223, #3674, #3884), native subprocess containment (#2825, #3708, #3804), Electron (#3413), feedback reporting (#3598, #3765), the composer and statistics polish (#3699), the environment prompt suffix (#3644), shell-only minimal profiles (#3510), the package manifest package (#3602), and the published dependency faces (#3771).

### Not applicable

#3664 fixes a scroll-sampling debounce this line does not have; #3871 fixes a file lock this line does not take; #3466, #3632, and #3726 change only notes and skills; the upstream CI, review-automation, runner, and template pull requests, the four release bumps, and the two reverted pairs (#3337/#3778, #3710/#3901) carry nothing for this line.

## Alternatives considered

- **Merge `dsh-v0.1.5-rc.1` into `dev`.** Rejected: the 233 conflicted files include the persona and brand UI, and the session, agent, and inbox APIs that the fork-only packages compose; resolving them means porting the skipped foundations in one step, with no per-change verification.
- **Rebase `dev` onto upstream.** Rejected: it rewrites every fork commit and meets the same conflicts.
- **Wait for a stable upstream release.** Rejected: the prerequisite gap grows with every release, and the fixes above are wanted now.

## Consequences

Each later pick costs a manual adaptation, and the deferred list above is the backlog a foundation port unlocks. Model-visible changes whose upstream coverage is a v2 or v3 recording rely on unit tests here: the model-switch-notice scenario and the system-prompt-in-history scenario are not carried. The Web goldens taken from upstream (`command-menu-zh`, `onboarding-deepseek-config/default-models` and `models`) still need a local refresh on this line. In exchange the line gains the fixes and features listed above with each upstream pull request number preserved, so the next sync can diff by number.
