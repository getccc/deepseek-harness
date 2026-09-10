---
description: "The administration console's browser API: JSON over the Control Plane session, asking the same three questions and leaving the same audit record a form post did."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-admin-api

English | [中文](README.zh.md)

## Summary

`dsh-team-admin-api` is the only thing the administration console talks to. A password creates a browser session only when the account also holds `organization.admin.access`. Every later route rechecks that console-entry permission, the request's session and origin, and the action-specific grant before it asks the service that owns the record. The console decides what to show an administrator; it decides nothing about what they may do.

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

| Collection | Reading it needs | Changing it needs |
|---|---|---|
| `/organization`, `/overview` | `organization.read` | `organization.settings.manage` |
| `/members` | `member.read` | `member.create`, `member.update`, `member.password.reset`, `member.delete`, `member.disable`, `member.enable`, `member.role.bind` |
| `/departments` | `department.read` | `department.manage` |
| `/roles`, `/grants` | `role.read` | `role.create`, `role.update`, `role.delete`, `role.grant.manage` |
| `/menus` | a session, and no grant | `menu.manage` |
| `/devices` | `device.inventory.read` | `device.revoke` |
| `/models` | `model.catalog.read` | `model.catalog.manage` |

Navigation is the exception in that table. The console cannot draw itself without it, it names only what this build ships, and every page it leads to asks access control again, so reading it needs a session and nothing more — the same rule `/permissions` follows.

`POST /roles/:id/menus` takes the navigation entries a role is to reach and makes its type grants match: it adds the permission each chosen entry declares, revokes the permissions of entries not chosen, and leaves alone every pair no entry declares. Menu access is a view over grants, not a second authorization system. `POST /roles/:id/permissions` does the same over the catalog itself, so a role's type grants become exactly the pairs it was given; grants over one named resource are outside both lists and are left as they are.

`POST /roles/:id/models` is the resource-specific exception. It resolves catalog model ids to their governed resource ids, replaces that role's exact `model.discover` and `model.invoke` grants, and clears `coversCatalog`. The Runner asks the model gateway for discovery under its current device access token, so only active models allowed by those exact grants appear.

`POST /models` is also the edit. The stable model ref is the entry's identity, so a write naming one already stored replaces its route and leaves its status and the grants written against that ref alone; changing a ref means registering a second entry. The body's optional `inputModalities` declares what a request to the model may carry, `text` alone or `text` and `image`; an omitted list means `text`, and an empty, repetitive, or unknown list is refused with reason `modalities`. Member Runners read the declaration from the model catalog and refuse an image for a model that does not list `image`. `PATCH /models/:ref` only withdraws a model from service or returns it, while `DELETE /models/:ref` takes the entry out of the catalog with every grant that named it.

`POST /members` requires the member's initial password in the same write that creates the account. `PATCH /members/:id/password` replaces it, revokes every browser session and device credential family owned by that account, and expires the request's administration cookie when an administrator resets their own password.

A role marked `coversCatalog` holds every permission this build governs, and is brought up to the catalog as the Control Plane starts — which is what keeps an administrator's role current when a build adds a permission. The mark is grant management: `PATCH /roles/:id` asks `role.grant.manage` in addition to `role.update` whenever the request carries that field.

The initial administrator bootstrap must grant `organization.admin.access` outside the console together with the action permissions that administrator needs. Ordinary member accounts authenticate through the Runner-facing endpoint instead and receive no administration session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### A write needs all three

A session, an `Origin` naming this authority, and the CSRF value derived from that session. They fail differently: the token check refuses a forged request, and the origin check refuses one from a page that never loaded this console at all. Signing in is a write like any other, because a form on another site could otherwise sign a member into an account that site controls.

### `permissions` hides controls; it does not enforce anything

`GET /team/api/session` answers the `resourceType|action` pairs the member holds, so the console can leave out a button nobody could use. Every route then asks access control again. A console that showed a control it should not have still gets a refusal.

The same answer carries `secretPolicy`, the deployment's password requirement, so a console checks a new password as it is typed instead of sending one the Control Plane will refuse. It enforces nothing: `POST /members` and `PATCH /members/:id/password` apply the policy to whatever arrives.

### A refusal names a word, not a sentence

`unauthenticated`, `forbidden`, `malformed`, `conflict`, `not-found`, `too-large`, `unavailable`. The console switches on the word; `detail` is for a person to read and never the only thing separating two outcomes. A failed sign-in is one answer for every cause, because which of "no such member", "wrong password", and "locked" it was is exactly what an attacker wants.

### The company is a row of the department tree

`PATCH /organization` takes the same descriptive fields a department takes — a name, a code, a lead, a phone number, and an email address — because the console draws the organization as the root row of that tree and edits it there. The name is required; every other field is cleared by sending it empty. What the organization does not take is a parent, a category, and an order: it is the root, it is the company, and there is one of it.

### The wire is narrower than the record

An account's failed-attempt count and lock deadline are the authentication provider's business, not an administrator's table. A policy revision is a `bigint` and travels as a decimal string, because JSON has no such number. A member's roles are narrowed to this organization's: nothing stops a binding from naming another organization's role, and a role this console names is one it could also take away.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The routes, the three proofs, authorization, and the audit record |
| [`src/http.ts`](src/http.ts) | Reading a bounded JSON body and answering with one |
| [`src/types.ts`](src/types.ts) | What the console receives, types only |

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
- **Whole collections, no pagination** — a write answers with the list it changed, and a read answers all of it, which targets the deployment sizes this version serves.
- **No audit query** — `organization.audit.read` is in the catalog and no route serves it yet.
- **Deleting an account is not deleting its history** — the account, its role bindings, its sessions, and the credentials of the computers it bound all go; the audit rows it left stay, and the organization or department it led is left without a lead.
- **Nothing counts the remaining administrators** — the API refuses only the account the request was made from, so an organization can still be left with no administrator.
- **A parent is chosen once** — neither a department nor a navigation entry can be moved to a different parent; both are created where they belong.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The refusal tests matter more than the success tests: each of the three proofs is dropped in turn and the store is checked to have changed nothing. `readJson` stops reading an oversized body rather than destroying the socket — destroying it takes the response with it, and the console sees a dropped connection instead of the refusal.

</details>

**Runtime invariant:** No companion is published: this package owns no data of its own; every write it accepts lands in the account, access-control, device, or model service that owns it, each of which checks its own relations, and an allowed write beside its audit row is asserted by the route tests.
