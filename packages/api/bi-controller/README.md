---
description: "Team-only Host Remote for BI analysis: the authorized project directory a browser reads, and the Session project choice it records."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-bi-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-bi-controller` is the Host Remote the composer BI control talks to. The browser cannot reach `ctx.bi` and cannot append a Session event, so it asks the `bi` namespace to read the projects a member may analyze beside one conversation's folded choice (`scope`) and to record a new choice (`choose`). It is a Team-only namespace mounted with the BI tools; a build without them never grows it. The Remote records the choice as a `bi/scope` event, with the display name the directory holds at that moment, and lets `dsh-tool-bi` be the one place that turns it into anything the model sees.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in a Team composition beside `dsh-bi-team`; the browser plugin `dsh-client-ui-bi` mounts its generated Remote face and calls it. It injects `agents`, `bi`, and `typert` and needs no configuration.

- `bi.scope(sessionId)` → the projects this member may analyze right now, the Session's current choice, and whether that choice names a project the directory no longer holds.
- `bi.choose(sessionId, mode, projectRef?)` → record `off`, or `selected` with one project, and read the scope back. A project the directory does not hold is refused rather than recorded, because the recorded name reaches the prompt and has to have been earned at the moment of choice.

The directory is read on every call rather than cached: a grant revoked since the last look should narrow the control, and a project an administrator switched off should leave it. A directory that cannot be read answers `bi/unavailable` carrying the closed reason, so a control can say "sign in again" rather than showing an empty list.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `bi/scope` event it records, which `dsh-tool-bi` turns into the prompt section and the tool visibility.

#### KV Cache effect

None of its own. Recording a choice changes the `bi:scope` prompt section and the tool list that `dsh-tool-bi` owns; the prefix invalidation is described there.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The wire type is self-contained** — the Remote face declares its own scope envelope rather than importing the vocabulary's `BiScope`, so the two are kept in step by `parseBiScope` rather than by a shared type.
- **One project per conversation** — `choose` records one project or none; there is no whole-directory mode, because the prompt names one project and the tools take none.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The self-contained wire type is deliberate: a generated Remote face that followed `BiScope` into `@deepseek-ai/dsh-bi` would pull the Session-event module augmentation into the analyzer and crash it, as the office Remote found before it.

The request parsing and the open-Session lookup are the same stretches the knowledge and office Remotes carry; the clone detector reports them. Extracting one Session-addressed Remote base the three parameterize is the follow-up, and it touches those two packages and their tests, which is why it did not ride the change that added this one.

</details>

**Runtime invariant:** No companion is published: the controller holds nothing between calls and owns no registry; that a recorded project is one the directory held at the moment of choice is enforced inside `choose` and asserted by the package's tests.
