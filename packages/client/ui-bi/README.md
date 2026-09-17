---
description: "The composer control choosing which BI project this conversation analyzes: a single-select over the projects a member may analyze, recorded through the Team-only bi Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-bi

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-bi` is the composer control a member uses to say which BI project a conversation analyzes. It is single-select over the projects the member may analyze right now, read when the menu opens, and clicking the chosen project again clears it. The control reads the chosen project from the `bi` projection and records a click through the Team-only `bi` Remote, so a reload or a second browser shows the same choice, and the model reads it through the prompt section and the two tools `dsh-tool-bi` owns.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in a Team browser composition; it seats a control in the composer's left zone, to the right of the office chip, and mounts the `bi` Remote namespace it calls. It needs no configuration. A build whose Host folds no BI scope renders nothing, and so does a chat Session (read as `kind` through the standard-kit `useSessions`), whose tool-less preset has no chart to run. On a composer row narrower than 460px the control shows only its icon, as the permission control does; its accessible name still states the chosen project.

### What a member sees

The chip says `BI分析` while nothing is chosen and the recorded project's name once one is, tinted like a chosen office kind. Opening it reads the authorized directory and lists the projects; a member with none is told so, and a member whose recorded project has since been taken away is told that too, with the chip still naming what the log recorded until they choose again. A change the Host refuses leaves the menu open with the reason shown.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `bi/scope` event the control records, which `dsh-tool-bi` turns into the prompt section naming the project and into the visibility of the two BI tools.

#### KV Cache effect

Each choice changes the `bi:scope` system-prompt section and the tool list that `dsh-tool-bi` owns, so the next request's prefix differs from that section onward; opening the control costs nothing until a project is clicked.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The choice lives in one conversation** — there is no remembered default, so every new conversation starts with no project chosen.
- **No `/bi` command** — the control is the one way to record the choice; a command row arrives only if members ask for one.
- **No Web card for a run** — a chart the model runs reaches the transcript as the model's own answer, drawn through the deployment's `echarts` fence; a card that draws the rows directly is a later increment.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The control reads the directory from the same `scope` call that reports whether the recorded project went stale, so one open costs one Remote call and the two facts cannot disagree.

The trigger button is the same chip chrome the knowledge and office controls draw; the clone detector reports the shared stretch. A shared composer-chip trigger primitive the three use is the follow-up, and it touches those two packages, which is why it did not ride the change that added this control.

</details>

**Runtime invariant:** No companion is published: a composer seat whose disposal is proven by the HMR-safety spec reads the Session's BI choice through the Host, emits no cordis events, and owns no cross-plugin mutable state.
