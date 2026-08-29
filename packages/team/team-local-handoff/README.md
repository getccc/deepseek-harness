---
description: "The Runner's three local addresses: begin a binding, enter the application, and receive the browser back from the Control Plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-local-handoff

English | [中文](README.zh.md)

## Summary

`dsh-team-local-handoff` serves the three addresses a member's browser navigates to on their own computer: `/team/start` shows the pairing code, `/team/open` is the daily entry, and `/team/callback` receives the browser back from the Control Plane. The callback answers 200 with a self-navigating page rather than a redirect, because a `SameSite=Strict` cookie does not survive a redirect inside a cross-site navigation chain — that one detail is what makes the handoff work at all.

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

```yaml
plugins:
  '@deepseek-ai/dsh-team-local-handoff':
    applicationPath: /
```

The three paths are fixed, not configurable: a Control Plane registers its redirect target against them, so a deployment that renamed one would break every already-bound computer.

Each answers 405 unless the request is a top-level document navigation. They carry no RPC, read no request body, and reach no Host capability, so the browser-trust fence that guards `/api` has nothing to guard here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Why the callback is not a redirect

The local session cookie is `SameSite=Strict`, and the navigation that reaches `/team/callback` was started by the company site. A browser withholds a Strict cookie from every request in a cross-site navigation chain, including the one a redirect produces, so setting the cookie and answering 303 lands the browser on the application without it. Answering 200 with a page that navigates itself makes that navigation same-site, and the cookie travels with it.

### What the local state does, and does not do

The state ties a callback to the pairing page this process served, which is what stops a link someone else assembled from binding this computer to their account. It does not stop a replay: the Control Plane's authorization code is one-time, and that is what refuses a second callback carrying it. The state deliberately survives a failed completion, because spending it there would turn a moment of Control Plane trouble into a full restart for the member.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The three routes, the navigation check, and the state |
| [`src/paths.ts`](src/paths.ts) | The three fixed addresses |
| [`src/pages.ts`](src/pages.ts) | The pairing page and the problem page |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Team-handoff subsystem](../../../docs/subsystems/team-handoff.md) — the whole flow, both sides.
- [`team-account-client`](../team-account-client/README.md) — what these addresses drive.
- [`client/connection`](../../client/connection/README.md) — owns the local browser session these addresses hand out.

<a id="model-experience"></a>
## Model Experience

None, as these are navigation endpoints and register no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **The pairing page is plain and unstyled** — it is served while the application is not yet unlocked, so it must not depend on the application's own assets loading.
- **A browser that reports no Sec-Fetch facts is treated as navigating** — rejecting those requests would lock older browsers out of an endpoint that is safe without the hint.
- **One binding in flight** — a second `/team/start` replaces the state the first minted, so the earlier pairing page stops working.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests use `node:http` rather than `fetch`, because `fetch` overrides `Sec-Fetch-Mode` with its own value: a test using it could never present what a real navigation presents, and these endpoints answer on exactly that header.

</details>
