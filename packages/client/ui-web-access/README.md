---
description: "Web access switch for the Web GUI: the composer control that turns web search and page fetching on or off for one conversation; for users and maintainers of the chat composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-web-access

English | [中文](README.zh.md)

## Summary

This package renders the web access switch in the Web GUI: a 联网 chip at the left of the composer tool row that shows whether this conversation's agent is offered `web_search` and `web_fetch`, and flips it with one click. The chip appears only for a conversation whose agent preset mounts the switch (the shipped `chat` preset, off by default) and reads the host-computed `webAccess` projection, so a reload, a second browser, and the model agree. The switch itself, the `/web` command, and the logged `web/access` state belong to `dsh-tool-web`; this package sends what a user could equally type.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin alongside `ui-conversation` in a deployment whose chat preset mounts `dsh-tool-web` with a `sessionSwitch`; the chip then occupies the composer's left zone before the knowledge and office chips. Click it to turn web access on or off for the current conversation; the same change is available as `/web on` and `/web off` from the composer's `+` Command menu.

### What the chip shows

The chip is a pressed toggle: untinted with the globe icon and the label while web access is off, tinted while it is on, and named "Web access on, press to turn off" or "Web access off, press to turn on" for assistive technology. A click sends the opposite value and disables the chip until the command settles; the new state shows when the projection confirms it. A conversation whose composition offers no switch, such as a work session on the standard preset, shows no chip at all. Below a 460px composer the label collapses to the icon.

### Failures

A refused flip (a command the host did not admit, a business error, or a transport fault) shows an inline "Failed to switch web access" line whose tooltip carries the reason; the chip keeps the projected state and accepts the next click.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The chip joins the conversation-declared `conversation.input.left` list at order 50; the node half is an empty apply (the roster row). Reads ride the generic projection pair through the standard-kit `useProjection`: the `webAccess` value is `{ enabled: boolean | null }`, and `null` means the composition mounted no switch, which renders nothing. The entry's injected face carries one verb, `setEnabled`, which executes `/web on` or `/web off` through `ctx.remote.commands.execute` and maps an RPC failure, an unmatched command, or the command's own error result to a failure line the chip shows inline. No switch state lives in the browser.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the chip is not enough. They move from the control to the switch it drives and the composer that hosts it.

- [dsh-tool-web](../../web/tool-web/README.md) — owns the `sessionSwitch` config, the `/web` command, the `webAccess` projection, and the per-session tool restriction.
- [dsh-agent-presets](../../preset/agent-presets/README.md) — the shipped `chat` preset that mounts the switch off by default.
- [ui-conversation](../ui-conversation/README.md) — declares the composer's `conversation.input.left` zone.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `/web on` or `/web off` command line the chip dispatches: `dsh-tool-web` owns the model-visible tool schemas, their guidance, and the logged state that line drives.

#### KV Cache effect

Turning web access on or off adds or removes the `web_search`/`web_fetch` schemas and their guidance sections from the next request and therefore changes the request prefix once; the chip itself adds no prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current switch chip. They are current package constraints, not a task backlog.

- **The chip belongs to the default composer** — a pending whole-composer interaction such as plan review temporarily replaces the InputBar and its chip.
- **One switch per conversation** — the chip flips both web tools together; a deployment that wants search without fetch configures `dsh-tool-web` rather than the chip.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The switch state and tool visibility are owned by dsh-tool-web, while the control is a slot effect whose declaration, registration, and teardown are exercised by this package.
