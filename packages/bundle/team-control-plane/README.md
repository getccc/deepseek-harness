---
description: "The dsh Team Edition Control Plane: a standalone server bundle that deliberately mounts no Agent, filesystem, shell, or code-execution capability, for deployments running the company services."
kind: "package-bundle"
---

# @deepseek-ai/dsh-team-control-plane

English | [中文](README.zh.md)

## Summary

`dsh-team-control-plane` is the administrator and company-resource server for Team Edition. It holds company credentials and answers every member Runner, which is why it carries no Agent, filesystem, shell, subprocess, or sandbox capability. The complete standalone tree includes account authentication, access control, audit, the administration console's own navigation, device authorization, quota, the model gateway, Runner-facing authentication endpoints, and the administration API and application. It does not compose a member browser login or confirmation page.

It does not start unconfigured: both Runner authentication and the administration API require the deployment's organization ID. They fail rather than guessing which account namespace they serve.

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

You do not mount this bundle directly. Select the profile that names it:

```sh
dsh --profile team-control-plane
```

The profile composes this bundle alone and listens on `127.0.0.1:3095`. Ordinary members do not browse this port; administrators reach `/team/admin/`, while Runners call the device, model, and knowledge endpoints.

### Production binding

The default binds loopback. A production deployment terminates TLS in a reverse proxy in front of this listener rather than exposing it directly. A deployment that must bind all interfaces states that in its own profile patch, restating every key the `webserver` row owns.

### Deploying private knowledge

Three rows have no default and the composition fails to load without them: `sourceCode`, `baseUrl`, and `credentialRef` on the knowledge source. A Control Plane that guessed which knowledge deployment it governs would read a stranger's knowledge, and one that guessed a source code would mint knowledge references that outlive the mistake.

The credential must resolve to a WeKnora **space** key, not a platform key. A space key is fixed to the space it belongs to; a platform key reaches any space and takes a tenant header to say which, so a Control Plane holding one could read knowledge outside the space it governs.

Run the knowledge deployment on this host and give `baseUrl` its loopback address. Reaching it over loopback is what makes "a member cannot read company knowledge except through a decision made here" a network fact rather than a policy: there is no origin for a member to discover, and no credential in flight across a segment. A deployment that must separate the two hosts restores the equivalent restriction — a private segment and a service identity — before it moves the address off loopback.

The `sourceCode` is bounded at 19 characters over the audit token alphabet. It is the part of a knowledge reference a deployment chooses, and the reference as a whole has to fit what the audit store will record, so a longer one fails at load rather than at the first refused search.

### Storage and instance count

Every store is a SQLite file under the DSH home, which limits a deployment to one active Control Plane process with durable storage and backup. That is a real constraint rather than a default: two processes over copies of these files would disagree about grants and about which knowledge bases exist. Horizontal replicas need a shared-database design, not copies.

### Running beside a Runner

The port is distinct from the Team Runner's `3090` and `dsh web`'s `3080`, so a maintainer can run all three on one machine while developing without hitting a bind conflict.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Why it does not stack the base bundle

Every other Team bundle is a patch layer over an existing tree. This one is a complete tree of its own, in the same shape as [`dsh-sdk-minimal`](../sdk-minimal/README.md), because the capability set it must *not* have is precisely what `dsh-base` provides.

That absence is a composition fact rather than a runtime one, so tests hold it in two independent places: this package asserts its patch names no local-execution package and its manifest declares no dependency on one, and `app-boot` asserts the profile template names no bundle that would reintroduce them. A row added without its package declaration fails to load rather than quietly mounting, so the manifest is a second barrier and not a restatement of the first.

### Source map

| Path | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The complete tree this profile boots |
| [`src/index.ts`](src/index.ts) | Module identity only; the bundle exposes no runtime API |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

### Invariant ownership

The package is a static patch-list carrier: it mounts no service, emits no events, and owns no mutable relation to check, so its companion installs nothing. The capability absence it exists to guarantee is not observable at runtime — nothing is there to observe — so the composition tests own it instead.

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-team`](../team/README.md) — the member-side Runner surface this server answers.
- [`dsh-sdk-minimal`](../sdk-minimal/README.md) — the other standalone bundle, and the shape this one follows.
- [app-boot profile section](../../boot/app-boot/README.md) — how profiles resolve and layer.
- [Bundle package map](../README.md) — the other surfaces and how they compose.

<a id="model-experience"></a>
## Model Experience

None, as the Control Plane runs no Agent and mounts no prompt section, tool, or request context.

#### KV Cache effect

The bundle drives no model request at all, so it has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of this bundle, not a task backlog.

- **Organization bootstrap remains external** — a deployment must create the organization, initial administrator secret, admin-entry grant, and action grants before the console can administer itself.
- **Capability absence is enforced at composition, not at runtime** — a deployment that adds a local-execution row to its own profile patch defeats it. The tests bind what this repository ships, not what an operator later composes.
- **Loopback by default** — reaching the server from another host requires a reverse proxy in front, or a deployment patch that restates the whole `webserver` row.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The forbidden-package list in the composition test is written out entry by entry rather than matched by prefix, so that adding a capability package forces a deliberate decision here instead of silently matching a pattern or silently escaping one.

</details>
