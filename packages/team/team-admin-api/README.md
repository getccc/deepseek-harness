---
description: "The administration console's browser API: JSON over the Control Plane session, asking the same three questions and leaving the same audit record a form post did."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-admin-api

English | [中文](README.zh.md)

## Summary

`dsh-team-admin-api` is the only thing the administration console talks to. It answers JSON over the Control Plane's browser session, and every route asks the same three questions a form post asked — is there a session, did this come from this site, does access control admit it — before it asks the service that owns the record. The console decides what to show a member; it decides nothing about what they may do.

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
- name: '@deepseek-ai/dsh-team-admin-api'
  config:
    organizationId: 019400a1-0000-7000-8000-000000000000
    sessionMaxAgeSeconds: 43200
    secureCookie: true
    maxRequestBodyBytes: 16384
```

`organizationId` has no default: a Control Plane that guessed which organization it serves would authenticate members against the wrong one, so the row fails to load until a deployment supplies it. `secureCookie` must be false for a deployment served over plain HTTP, because a browser drops a `Secure` cookie on such an origin and the member would never stay signed in.

Reads are `GET`; writes are `POST`, `PATCH`, and `DELETE` under `/team/api`. Every write carries the session's CSRF value in the `x-dsh-csrf` header, which `GET /team/api/session` hands out.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### A write needs all three

A session, an `Origin` naming this authority, and the CSRF value derived from that session. They fail differently: the token check refuses a forged request, and the origin check refuses one from a page that never loaded this console at all. Signing in is a write like any other, because a form on another site could otherwise sign a member into an account that site controls.

### `permissions` hides controls; it does not enforce anything

`GET /team/api/session` answers the `resourceType|action` pairs the member holds, so the console can leave out a button nobody could use. Every route then asks access control again. A console that showed a control it should not have still gets a refusal.

### A refusal names a word, not a sentence

`unauthenticated`, `forbidden`, `malformed`, `conflict`, `not-found`, `too-large`, `unavailable`. The console switches on the word; `detail` is for a person to read and never the only thing separating two outcomes. A failed sign-in is one answer for every cause, because which of "no such member", "wrong password", and "locked" it was is exactly what an attacker wants.

### The wire is narrower than the record

An account's failed-attempt count and lock deadline are the authentication provider's business, not an administrator's table. A policy revision is a `bigint` and travels as a decimal string, because JSON has no such number. A member's roles are narrowed to this organization's: nothing stops a binding from naming another organization's role, and a role this console names is one it could also take away.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The routes, the three proofs, authorization, and the audit record |
| [`src/http.ts`](src/http.ts) | Reading a bounded JSON body and answering with one |
| [`src/types.ts`](src/types.ts) | What the console receives, types only |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`team-browser-session`](../team-browser-session/README.md) — the cookie, the CSRF derivation, and the same-origin decision this API uses.
- [Access-control subsystem](../../../docs/subsystems/access-control.md) — the closed permission catalog a grant may name.

<a id="model-experience"></a>
## Model Experience

None, as this serves an administrator's browser and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One organization, named in configuration** — the API authenticates against the organization it is configured with, and nothing resolves which organization a request belongs to.
- **No enrollment or password route** — an administrator adds a member, and setting that member's first password still needs a separate path.
- **Type grants only** — a grant for one named resource is read and revoked here but created through the access-control service, until the console has a resource picker that cannot confuse a display name with the governed resource id.
- **Whole collections, no pagination** — a write answers with the list it changed, and a read answers all of it, which targets the deployment sizes this version serves.
- **No audit query** — `organization.audit.read` is in the catalog and no route serves it yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The refusal tests matter more than the success tests: each of the three proofs is dropped in turn and the store is checked to have changed nothing. `readJson` stops reading an oversized body rather than destroying the socket — destroying it takes the response with it, and the console sees a dropped connection instead of the refusal.

</details>
