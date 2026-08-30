---
description: "The Control Plane's device-confirmation page: what a member compares before a computer is bound to their account, and the three proofs that binding needs."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-shell

English | [中文](README.zh.md)

## Summary

`dsh-team-shell` serves one page: a member confirming that the computer asking to connect is theirs. It stays server-rendered because of where a member arrives from — a link on the pairing page their own Runner served — and what they do on arrival, which is compare a code and press one button. Administration is a browser application; this is the page that has to be readable the instant a cross-site navigation lands on it.

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

```yml
- name: '@deepseek-ai/dsh-team-shell'
  config:
    maxRequestBodyBytes: 16384
```

The page lives at `/team/confirm/<transaction id>`; a Runner builds that address from the transaction it just opened. There is no other route and no other configuration: the session this page resolves is opened by [`team-admin-api`](../team-admin-api/README.md), and a browser carrying none is sent to the administration console to sign in and come back.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### A confirmation needs all three

A session, an `Origin` naming this same authority, and a CSRF token derived from the session. They fail differently: the token refuses a forged form, and the origin refuses a request from a page that never rendered one. Binding a computer to an account is the one act on this page, and a cookie alone travels with requests a member never made.

### The refusal names the seam's own word

`expired`, `already-confirmed`, and anything else become three different sentences, taken from the word the device-authorization seam produced rather than guessed at. A failure carrying no word at all is this deployment's, not the member's: it answers 500 and records `outcome: 'error'`, because a record saying the member was refused when they were not is worse than no record.

### An unsigned browser goes to the console, and comes back

The redirect carries `next`, so a member following a pairing link lands on the page they were sent rather than on an administration view they did not ask for.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The route, the three proofs, and the audit record |
| [`src/pages.ts`](src/pages.ts) | The confirmation page and the page that says why something cannot continue |
| [`src/paths.ts`](src/paths.ts) | The two addresses this package names |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Team-handoff subsystem](../../../docs/subsystems/team-handoff.md) — the three addresses and the callback's same-site bounce.
- [`team-browser-session`](../team-browser-session/README.md) — the cookie and CSRF derivation this page shares with the administration API.

<a id="model-experience"></a>
## Model Experience

None, as this serves a member's browser and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **No way to refuse from the page** — a member who does not recognize the request closes the tab; the transaction then expires on its own rather than being denied on the spot.
- **The page shows one transaction at a time** — a member with two pending requests has no view that lists them, and confirms each from its own link.
- **English only** — this page is not routed through a locale dictionary, unlike the administration console.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests open a browser session directly through the account store rather than signing in, because signing in belongs to the administration API and this package must not depend on it to be tested.

</details>
