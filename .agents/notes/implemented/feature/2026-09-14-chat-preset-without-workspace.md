# Agent Note: chat preset without a workspace

Status: implemented

English | [中文](2026-09-14-chat-preset-without-workspace.zh.md)

## Problem

Every Web session was a work session: creation resolved a working directory, the sidebar grouped sessions under Workspaces, and the composer stayed inert until a Workspace was chosen. A member who wanted to ask 小微 a question had to pick a project first and then wait for a first token that the standard preset spends on twenty tool schemas, a skills scan, an `AGENTS.md` read, and a runtime-context snapshot of a directory the question never touches. The product wanted a chat mode beside work mode, as Codex and 豆包 have: fast, without a workspace, with its conversations listed in a recent list below the Workspace tree rather than inside it.

Three facts in the host stood in the way. `session.create` without a Workspace or cwd fell back to the Runner's `process.cwd()`, which for a desktop application launched from Finder is `/`. The session list and search dropped every cold session whose header carried no cwd, a filter added in July to retire pre-cwd legacy metadata. And the deployment persona suffix interpolates `{{cwd}}`, which throws for a session that records none.

## Decision

**Chat mode is an ordinary agent preset plus a session that owns no cwd.** No host-level session kind exists. A preset's `preset.yml` declares `workspace: required` (the value an absent key means) or `workspace: none`; discovery resolves it onto `AgentPreset.workspace`, the roster row carries it, and a value outside the vocabulary marks the preset broken rather than defaulting it. The shipped `chat` preset declares `none`, composes a persona prefix with no suffix so the deployment's `{{cwd}}` suffix is shadowed away, the standard compaction group, and a `@deepseek-ai/dsh-tool-restriction` row with `allow: []`.

**The location composes the preset.** `session.create` with a `workspaceId` or `cwd` composes the named preset or the roster's `default`; with neither it composes the named preset or the roster's `chatDefault`, and the session's header records no cwd. `AgentPresets.resolveFor(workspace, id?)` selects the default by kind and refuses a preset declared for the other kind with `agent-preset/workspace-mismatch`; `select` applies the same refusal to a blank session, so a chat session never becomes a work composition or the reverse. A deployment composing no roster refuses a create naming no location with `session/location-required`; the `process.cwd()` fallback is gone. `SessionCreateValue` echoes the cwd the session owns, so the client's placeholder row states the session's kind before the list frame lands.

**A cwd-less session is a complete session.** List, search, history paging, following, cold resume, inspection, and the skill catalog serve it; the Workspace registry no longer records it as an invalid path, because no Workspace can index it. Its log lives under the persistence layer's `_no-cwd` directory, which already existed. The session format is unchanged: `cwd` was already optional in the header.

**The tool surface is a host fact.** `dsh-tool-restriction` is the configuration face of `ctx.tools.restrict()`, mounted inside a preset composition; `allow: []` masks every global tool for the agents joined to that preset, including a tool a deployment registers later, so "chat has no tools" does not depend on each host-plane tool's own visibility rule.

**The client reads one fact.** `SessionSummary.kind` is `chat` when the summary carries no cwd and `work` otherwise, derived once in the session service. The sidebar's top entries are 新对话 and 新工作任务; `uiWorkspace.startChat()` reuses a pristine chat session or creates one by naming no location; a `sidebar.recent` section below the Workspace tree lists sessions newest-first under a persisted filter (聊天, 工作, 全部; default 聊天), and chat sessions never enter the Workspace tree or its flat list. A chat session's hero renders no Workspace row and is not inert; its composer hides the access chip, the plan slot, and the knowledge and office pickers; the agent-preset chip offers only `required` presets and never applies a staged pick to a chat session.

## Alternatives considered

**A host-level session kind beside the preset.** A `kind` field on the header or a create-time discriminant would have duplicated two facts the header already states: the preset decides capability, and cwd presence decides Workspace membership. The [Workspace product-flow decision](../../archived/feature/2026-07-25-workspace-ui-product-flow.md) already refused a second ownership field beside cwd for the same reason.

**A scratch cwd for chat sessions.** Creating chat sessions under a fixed directory would have kept every cwd guard untouched. Rejected: the session would then claim a directory it never uses, the sandbox and file tools would resolve against it, and the Workspace registry's bootstrap would adopt it as a Workspace.

**Zero tools by convention only.** Hiding the knowledge and office pickers leaves every host-plane tool governed by its own visibility rule, and a deployment adding one later would put it into chat sessions. The restriction row costs one small package and makes the surface a mount-time fact.

**Deriving the chat preset id on the client.** The sidebar could have read the roster and created with the `none` default's id. Rejected: naming no location already selects `chatDefault` on the host, so the client carries no preset id and a deployment changes the chat composition in one place.

**Keeping the `process.cwd()` fallback for work presets.** No production caller relied on it: the Web client always names a Workspace, the SDKs, headless, ACP, and webhook always pass a cwd. Only tests did, and the desktop Runner's `process.cwd()` was `/`, which is the misconfiguration this change makes loud.

## Consequences

A member starts a chat with one click and the first token waits for the model alone: the request carries the persona and no tool schemas. Chat conversations sit in the recent list and never in a Workspace; a work conversation is still one click away. A create naming no location in a deployment without `chatDefault` fails with the presets that could serve it, and a `chatDefault` that needs a workspace, or a user default that needs none, fails at the first session it would compose. Every reader of `header.cwd` that previously equated absence with "not found" had to state its own behavior for a cwd-less session; the ACP session list keeps its cwd filter because ACP sessions require one. The web snapshot lane, whose scaffold refused a replayed session without a cwd, now accepts one, and `snapshots/web/chat-preset` pins the chat composition's prompt, tool schemas, and rendering. The client view store key moved to `dsh.workspace.view.v6` because rehydration replaces the whole value and the old document lacks the recent filter.
