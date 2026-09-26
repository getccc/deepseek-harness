---
description: "Desktop update control for the Web GUI: the button beside the member row that downloads and installs a newer build, shown only inside the desktop shell; for members and maintainers of the Team desktop application."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-desktop-update

English | [中文](README.zh.md)

## Summary

This package renders the update control at the sidebar foot, beside the member row: a circular button that appears when a newer build is available, downloads it on one click while drawing its own progress, and restarts the application into it. Checking, downloading, and installing belong to the desktop shell, which exposes them on `window.dshTeamDesktop`; this package registers nothing when that bridge is absent, so the same page in a plain browser or a source launch shows an unchanged sidebar.

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

Mount this plugin in a composition that also mounts `dsh-team-local-login`, which declares the `team.account.action` list this control joins. The Team bundle does both. Nothing else configures it: the shell decides whether an update exists, and the control shows what the shell reports.

### What the button shows

The button is absent while the installed build is current and while a check is in flight — a member with nothing to install sees the sidebar foot unchanged. An accepted release turns it into a filled download button whose tooltip names the version; one click starts the download. During the download the button draws the percentage as a ring and takes no clicks. When the download finishes, the application stops the Runner and restarts into the new build, so the ready state is brief by design. A failure turns the button into a warning whose tooltip carries the reason, and a click asks again.

### Failures

A check or download that fails leaves the installed build running and untouched. The reason the shell reported is the tooltip's text; the member can retry from the same button, and a deployment can always distribute a complete installer instead.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The browser half reads `window.dshTeamDesktop` once, at apply, and returns without registering anything when the object is missing or its `protocolVersion` is not the one this build speaks. With a bridge it registers the dictionaries and joins `team.account.action` at order 100, passing the bridge's three calls through the entry's injected face. The node half is an empty apply — the roster row that puts the browser half in the boot graph.

The control holds one piece of state: the last state the shell published. It subscribes on mount and also calls `check()` once, because the shell may have finished its own check before the page loaded and a subscription only carries what happens next. Each phase maps to a glyph, an accessible name, a tooltip, and what a click does; `idle` and `checking` map to nothing rendered.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the control is not enough. They move from the button to the shell that acts on it.

- [dsh-team-local-login](../team-local-login/README.md) — renders the member row and declares the `team.account.action` list.
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.md) — the shell that checks, downloads, installs, and exposes the bridge.
- [The Team desktop updates itself from the Control Plane](../../../.agents/notes/proposed/feature/2026-09-20-team-desktop-self-update.md) — why updates are published through the deployment's own Control Plane.
- [Team package map](../README.md) — adjacent Team packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the control registers no model input.

#### KV Cache effect

Nothing here joins a model request, so there is no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only inside the desktop shell** — a member reaching the same Runner from a browser has no way to update from this control, because only the shell can replace an installed application.
- **One button for the whole application** — an update replaces the shell, the Runner, and the plugin tree together; there is no per-component update to offer.
- **No release notes** — the tooltip carries the version and, on failure, the reason; what changed in a release is distributed outside the application.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The bridge declaration in `src/client/desktop-bridge.ts` and the shell's `TeamDesktopUpdateApi` are separate declarations of one object, because the two programs compile independently and neither should depend on the other's build. `DESKTOP_UPDATE_PROTOCOL` is what a drift between them trips on: a shell that speaks another version registers no control rather than calling into a bridge it does not match.

</details>

**Runtime invariant:** No companion is published. The shell owns every update operation, while the control is a slot effect whose declaration, registration, and teardown are exercised by this package.
