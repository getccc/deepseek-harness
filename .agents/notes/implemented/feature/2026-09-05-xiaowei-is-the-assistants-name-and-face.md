# Agent Note: 小微 is the assistant's name and face

Status: implemented

English | [中文](2026-09-05-xiaowei-is-the-assistants-name-and-face.zh.md)

## Problem

[The hero tagline changes every half hour](2026-09-05-the-hero-tagline-changes-every-half-hour.md) made the blank-session headline say `我是小微`, but nothing else in the product knew that name. The model's persona in every agent preset read `You are a coding agent powered by the {{model}} model`, so a member who asked the assistant who it was got a different answer from the one the page had just given. The name also had no likeness: the only artwork in the product is the AMEC company mark, which names the company, not the assistant. The product now has a mascot — a white pigeon holding a holographic slate — to serve as 小微's face, and an English name, `Xiaowei`.

## Decision

**The name lives in the agent preset persona.** The `standard`, `ptc`, and `cordis` presets in [`agent-presets`](../../../../packages/preset/agent-presets/presets/) open with `You are 小微 (Xiaowei), the AMEC Work assistant:` before the sentence they already carried. The presets are the modes a member picks in AMEC Work, and their persona is where the agent's identity already lived; the fixed harness identity sentence stays, because it names the engine rather than the assistant. The `minimal` preset keeps its complete prompt, and the bundle-level personas of the `sdk`, `acp`, and `headless` profiles are untouched: those are automation surfaces that never mount a preset and never show the face.

**The face is one inlined source with two consumers.** [`xiaowei-avatar.ts`](../../../../packages/team/team-local-login/src/xiaowei-avatar.ts) in `team-local-login` exports the likeness as a data URI; [小微 stands whole in the hero and the turn header](2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.md) owns the current artwork, its encoding, and the size each consumer draws it at. The login page stays the company's: the AMEC mark, `AMEC Work`, `个人与团队工作空间`, and `欢迎回来` over the form, with no face and no introduction, because a member who has not signed in is not yet talking to the assistant.

**Every turn opens with the same face.** `ui-chat` gains one single slot, `conversation.chat.assistant-identity`, rendered by the seat of the Turn's first visible activity row ([the identity header opens the Turn above injected context](../bug-fix/2026-09-07-the-identity-header-opens-the-turn-above-injected-context.md) owns which row that is), so one header sits above everything the assistant did in the Turn — the folded summary, the expanded process rows, the injected context, or the streaming first step — and never moves once the control appears. The owner share carries the Turn, the reply's status, and the date-aware clock the message action rows already use. `team-local-login` fills it in the shape of a chat byline: the face hanging in the gutter left of the content column where `--dsh-conversation-column-width` leaves room for it (and leading the row where it does not), the name in bold, an `Agent` tag, and the clock, so the name and every row below it share one left edge. A composition without an occupant adds nothing, which is why the generic Web scenarios' ARIA output is unchanged.

**The transcript's process copy speaks as 小微.** The `chat` dictionary's running-state lines — the folded process summary, the interrupted marker, the retry statuses, the compaction status, the command running summary, and the hidden running labels of reasoning rows and command cards — name the assistant: `小微调用了 1 次工具 · 回复了 1 条消息`, `小微思考了一会儿`, `小微停下了`, `小微正在思考`. The process summary is a template, `message.turnProcess.summary`, over verb-phrase segments, so the name is written once per language rather than in every count form. Tool, terminal, and background-job statuses in other packages describe those things, not the assistant, and keep their wording.

**The image is named through the dictionaries.** The hero's `alt` and the turn header's name are one key, `assistant.name`, in the `team.account` namespace, and the header's tag is `assistant.tag`; the header's face carries an empty `alt` because the name is its text; the English rendering of the name is `Xiaowei`.

**The face waits for the name.** The hero renders nothing until `/team/account` answers, as before; the face is inside that gate so the block lands once rather than as a picture followed by words.

## Alternatives considered

**A team-layer prompt section instead of editing the presets.** A Host plugin registering a `team:assistant` section between the harness identity and the persona would keep the generic presets nameless. Rejected: a preset persona is exactly the slot that says who the agent is, the presets are already the modes AMEC Work offers, and a package for one sentence is more surface than the sentence.

**The full-body figure on the hero.** Rejected for the first artwork: it sat on a white ground, and the body is white too, so removing the background was fragile at the wings and the shadow under the feet, and a white rectangle over the dark theme is worse than no figure. The circular head crop kept its own white disc, which read as an avatar over either theme. [小微 stands whole in the hero and the turn header](2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.md) records the transparent-ground artwork that lifted this objection.

**PNG for the crop.** Rejected: the same crop is 66 KB as PNG and 9 KB as WebP, and every browser this product supports decodes WebP.

**A team-layer override of the `chat` dictionary, keeping the name out of `ui-chat`.** Rejected: the locale runtime registers one dictionary per namespace and locale and refuses a second, so an override needs a new layering mechanism in the locale service for a handful of lines. The name now lives in three places — the preset personas, `team-local-login`, and the `chat` dictionary — and renaming the assistant means changing all three.

**The face in the sidebar brand slot or the application icon.** Rejected: those name the company, and a member finds the window and the tray by the company mark. The assistant's face belongs where the assistant speaks.

## Consequences

Three Web scenarios pin the standard preset prompt — `fresh-round-trip`, `cordis-tool-round`, and `ptc-round` — and their `system-prompt.expected.md` and `web-context.expected.md` sidecars carry the new sentence. The SDK, ACP, and headless scenarios are unchanged because their profiles never mount a preset.

The `team-local-login` client bundle grows by the encoded likeness; the login document is unchanged in size. The hero stack is taller by the likeness on a blank session, so the composer sits lower.

Forty-eight Web expected outputs across twenty-two scenarios carry the process summary, the interrupted marker, or a retry status, and were refreshed for the new wording; the refresh was reviewed line by line so that only those lines changed, and one e2e file that named the old summary in a role query was updated. An onboarding card that introduces 小微 is the remaining place the assistant could speak with its name, and it is not started here.

The hero suite pins the face's presence and its dictionary-owned `alt`; the login route suite pins the workspace label and the absence of any inlined image on the rendered page. The chat suite pins the identity header on the control across a fold, above injected context while streaming, on the first step when nothing precedes it, on a plain answer, and its absence without an occupant, and every running-state line in its new wording; the launcher suite pins the occupant, its disposal, and the header it renders with and without a clock. No unit test can prove the model answers to the name; the Web scenarios prove the sentence reaches the model.
