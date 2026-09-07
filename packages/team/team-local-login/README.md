---
description: "The Team Runner's local account login, application entry, and sign-out routes."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-local-login

English | [中文](README.zh.md)

## Summary

`dsh-team-local-login` keeps the ordinary-member browser on the Team Runner origin. It serves the responsive account-and-password form at `/team/login`, sends a locked `/team/open` browser there, and hands a successful sign-in to the local browser-session service. Inside the application it replaces the Settings trigger with the signed-in member launcher. The browser never navigates to the Control Plane administration origin.

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
  '@deepseek-ai/dsh-team-local-login':
    applicationPath: /
    maxRequestBodyBytes: 16384
    locale: en-US
```

Compose it after `client-connection` and `team-account-client`. Configure the Web runtime to open `/team/open`; unlike the standalone Web root, this entry must not receive a process-token URL.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Login stays local; authentication remains authoritative

The HTML form is served by the loopback Runner. On submission, the Runner opens a device transaction and sends the credentials to the configured Control Plane through `team-account-client`. The Control Plane verifies the password, approves that transaction, and the Runner redeems it using its PKCE verifier and device-key signature. The local page never stores the password, but the deployment must still protect the Control Plane connection with TLS.

The form requires browser same-origin metadata before it reads credentials. A normal `Origin` must name the request's authority. The login page's `Referrer-Policy: no-referrer` can instead produce `Origin: null`; that submission is accepted only when the browser-controlled `Sec-Fetch-Site` header says `same-origin`.

The login document is a standalone responsive page with bilingual copy, keyboard focus treatment, password-manager metadata, reduced-motion handling, and no external assets. It remains independent of the application bundle because it must render while that application is locked.

### Entry does not silently reuse a stored team credential

`/team/open` enters the application only when this browser already holds a valid local session. A locked browser returns to `/team/login`, even if the process still holds a team credential, so a newly opened browser cannot inherit an account without authenticating.

### Sign-out clears both layers

`/team/logout` accepts an authenticated local navigation, forgets the process's team credential, expires the browser cookie, and redirects directly to `/team/login`. An unauthenticated navigation only returns to the login page and cannot clear the process credential.

### The application footer shows the local member

The browser half occupies the Settings shell's optional `settings.launcher` slot. It reads `/team/account` with the local browser cookie, shows the returned display name and text avatar, and opens a menu containing Settings and Sign out. Settings calls the shell-owned panel action; Sign out navigates to `/team/logout`. The identity response contains only `loginName` and `displayName`.

### The blank conversation greets the member by their own clock

The same browser half fills the Conversation shell's `conversation.hero.headline` slot from the same `/team/account` read. The headline is 小微's whole figure over two lines: a greeting in which the assistant addresses the display name, and a tagline under it. The greeting belongs to the part of the day the member's browser clock is in — late night, early morning, the morning gathering, the rest of the morning, midday, afternoon, evening — and the tagline to the half hour, with the part boundaries in [`day-parts.ts`](src/client/day-parts.ts) and the copy in [`locales.ts`](src/client/locales.ts). A conversation left open crosses into the next half hour on its own. Until the identity arrives the headline stays empty rather than greeting nobody.

Every turn in the transcript then opens with a header from the same figure — hanging in the gutter left of the content column where the column leaves room — with the name, an `Agent` tag, and the turn's clock, through the Chat view's `conversation.chat.assistant-identity` slot; the header sits above the first row of the reply, whether that is the process control, injected context, or the first step.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Request validation and the four local routes |
| [`src/pages.ts`](src/pages.ts) | Standalone HTML rendered before the application is unlocked |
| [`src/paths.ts`](src/paths.ts) | Fixed local paths |
| [`src/client/`](src/client/) | Localized member launcher, account menu, and hero greeting |
| [`src/xiaowei-avatar.ts`](src/xiaowei-avatar.ts) | 小微's whole figure, inlined for the hero and the reply row |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Team sign-in subsystem](../../../docs/subsystems/team-handoff.md) — both sides of member authentication and device binding.
- [`team-account-client`](../team-account-client/README.md) — device-key and credential custody.
- [`team-admin-api`](../team-admin-api/README.md) — the separate administrator-only browser API.

<a id="model-experience"></a>
## Model Experience

None, as the routes and account launcher register no model input.

#### KV Cache effect

Nothing here joins a model request, so there is no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One active account per Runner process** — signing in again replaces the process credential for every browser using that Runner.
- **No member self-service password page** — an administrator replaces a password in the Control Plane, which revokes every browser session and device credential family for that account.
- **Two pre-application locales** — the server-rendered form currently supports `en-US` and `zh-CN`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Route tests pin the clean local entry, same-origin form requirement, generic authentication refusal, session issuance, authenticated identity response, and sign-out ordering. Browser tests pin the localized account launcher and its Settings and sign-out actions. The account client tests drive the password flow against a real Control Plane endpoint and device-authorization provider.

</details>
