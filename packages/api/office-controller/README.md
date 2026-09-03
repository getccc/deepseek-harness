---
description: "Host Remote owner for the Session office-deliverable choice: read what a conversation chose, and record a new choice from the browser."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-office-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-office-controller` is the Host Remote the composer office chip talks to. The browser cannot append a Session event, so it asks the `office` namespace to read one conversation's folded office choice (`scope`) and to record a new one (`choose`). It is a Team-only namespace mounted with the office tool; a build without the tool never grows it. The Remote records the choice as an `office/kind` event and lets `dsh-tool-office` be the one place that turns it into anything the model sees.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in a Team composition; the browser plugin `dsh-client-ui-office` mounts its generated Remote face and calls it. It injects `agents` and `typert` and needs no configuration.

- `office.scope(sessionId)` → the Session's current choice.
- `office.choose(sessionId, kind)` → record a kind (or `none`), and read it back. An unknown kind or a conversation that is not open is refused.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `office/kind` event it records, which `dsh-tool-office` turns into the prompt section.

#### KV Cache effect

None of its own. Recording a choice changes the `office:kind` prompt section that `dsh-tool-office` owns; the prefix invalidation is described there.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The wire type is self-contained** — the Remote face declares its own choice envelope rather than importing the vocabulary's `OfficeChoice`, so the two are kept in step by `parseOfficeChoice` rather than by a shared type.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The self-contained wire type is deliberate: a generated Remote face that followed `OfficeChoice` into `@deepseek-ai/dsh-office` would pull the Session-event module augmentation into the analyzer and crash it.

</details>
