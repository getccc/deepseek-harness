---
description: "The Control Plane's own pages: signing in, confirming a computer, and the administrative pages for members, roles, and devices."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-shell

English | [中文](README.zh.md)

## Summary

`dsh-team-shell` serves the pages a member and an administrator use on the Control Plane: signing in, confirming a computer that is asking to connect, and the administrative pages for members, roles, and devices. Every write is authorized twice — the session says who is asking, and access control says whether they may — and every administrative act leaves an audit record naming the principal that made it. The pages are server-rendered with no script, because a member reaches the first of them before anything else has loaded.

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
  '@deepseek-ai/dsh-team-shell':
    organizationId: 019400a1-0000-7000-8000-000000000000
    sessionMaxAgeSeconds: 43200
    secureCookie: true
```

`organizationId` is required. The first version is single-organization, and naming it keeps that a stated fact rather than something the shell infers from whatever the store happens to hold.

`secureCookie` must be false for a deployment served over plain HTTP, because a browser drops a `Secure` cookie on such an origin and the member would never stay signed in.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### A write needs all three

A session, an `Origin` naming this same authority, and a CSRF token derived from the session. The token is derived rather than stored, so there is no second record to keep in step, and it is a different value from the cookie so that carrying the cookie is not by itself enough to submit a form.

### The session cookie is Lax, not Strict

A member reaches the confirmation page by following a link from the pairing page their own Runner served, which is a cross-site top-level navigation. `Strict` would withhold the session there and ask them to sign in again for no reason.

### Signing in succeeds for anyone; doing anything does not

Authentication answers who, and every page and action then asks access control whether. A member with no grants signs in and can still do nothing — including reading the member list.

### A failed sign-in records no account

Which of "no such member", "wrong password", and "locked" it was is exactly what an attacker wants, so the page answers one message for all three and the audit record names no account.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The routes, the three checks every write passes, and the audit records |
| [`src/session.ts`](src/session.ts) | The session token, the CSRF derivation, and the same-origin decision |
| [`src/pages.ts`](src/pages.ts) | Every page, server-rendered with no script |
| [`src/paths.ts`](src/paths.ts) | The addresses the shell serves |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Team-handoff subsystem](../../../docs/subsystems/team-handoff.md) — both halves of the flow this page completes.
- [`access-control`](../../access/access-control/README.md) — what every administrative action asks before it acts.
- [`audit`](../../access/audit/README.md) — where every administrative act is recorded.

<a id="model-experience"></a>
## Model Experience

None, as these are Control Plane pages and register no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One organization, named in configuration** — the shell authenticates against the organization it is configured with, and nothing resolves which organization a request belongs to.
- **No grant editing** — roles can be created and bound, but the grants inside a role are set through the access-control service rather than through a page.
- **No enrollment link** — an administrator adds a member, and setting that member's first password still needs a separate path.
- **Pages are unstyled and unpaginated** — a long member or device list renders in full, which is fine for the sizes this version targets and will not stay so.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

A failure that carries no refusal word answers 500 and records `outcome: 'error'`, not 400. Reporting a store problem as "that request is not one this site knows about" would be false as well as unhelpful, and the audit record would say the member was refused when they were not.

</details>
