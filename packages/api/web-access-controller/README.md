---
description: "Host Remote owner for the Session web switch: read whether a conversation's agent is offered the web tools, and set it from the browser without a command in the transcript."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-web-access-controller

English | [中文](README.zh.md)

## Summary

`dsh-api-web-access-controller` is the Host Remote the composer web chip talks to. The browser cannot append a Session event, so it asks the `webAccess` namespace to read one conversation's switch (`state`) and to set it (`set`). Setting records the same `web/access` event the `/web` command does, but as a log-only event with no command node, so a chip clicked repeatedly leaves nothing on screen. It is mounted with the Web composition; a conversation whose preset composes no switch is refused rather than silently recorded. `dsh-tool-web` stays the one place that turns the event into what the model sees.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in the Web composition; the browser plugin `dsh-client-ui-web-access` mounts its generated Remote face and calls it. It injects `agents`, `typert`, and `web` and needs no configuration.

- `webAccess.state(sessionId)` → the Session's switch as its log states it.
- `webAccess.set(sessionId, enabled)` → record the value and read it back; a value the log already states records nothing.

Both ask the web service whether the deployment permits this member to search, fresh on every call, and refuse with `web-access/unavailable` when it does not, when the conversation is not open here, or when its log carries no `web/access` event because its composition offers no switch. The chip reads `state` when a conversation opens and stays hidden on a refusal.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `web/access` event it records, which `dsh-tool-web` turns into the presence or absence of the web tool schemas and their guidance.

#### KV Cache effect

None of its own. Recording a value adds or removes the `web_search`/`web_fetch` schemas that `dsh-tool-web` owns; the prefix invalidation is described there.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The wire type is self-contained** — the Remote face declares its own `{ enabled }` view rather than importing the switch's projection type from `dsh-tool-web`, so the two are kept in step by the tests rather than by a shared type.
- **No command node, by design** — a set through this Remote leaves no visible record in the conversation; the `/web` command remains for a member who wants one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The self-contained wire type is deliberate: a generated Remote face that followed the projection type into `@deepseek-ai/dsh-tool-web` would pull the Session-event module augmentation into the analyzer and crash it, the same reason the office Remote declares its own envelope.

</details>

**Runtime invariant:** No companion is published: the controller holds nothing between calls and owns no registry; that a set changes the log only when the value differs is enforced inside `set` and asserted by the package's tests.
