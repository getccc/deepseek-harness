---
description: "The Control Plane's Runner-facing release route: which published release a member is offered, decided by the roles they hold, and the version floor this deployment enforces; for maintainers of a Team deployment."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-release-http

English | [中文](README.zh.md)

## Summary

This package answers one question for a Runner: which release is this member offered? It verifies the device access token, asks access control whether the member's roles include the staged channel, and answers with the newest release they may take — the signed manifest exactly as it was published — together with the version floor this deployment enforces. It hands back a document it cannot produce, so a Control Plane under someone else's control can withhold a release but cannot make an installed application take one.

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

Mount it in a Control Plane composition that carries `webServer`, `teamReleases`, `deviceAuthorization`, and `accessControl`:

```yaml
- id: team-release-http
  name: '@deepseek-ai/dsh-team-release-http'
  config:
    maxRequestBodyBytes: 4096
```

`POST /team/updates/manifest` with `{"protocolVersion": 1}` and `Authorization: Bearer <device access token>` answers `200` with the manifest, its signature, and `minimumVersion`; `404` when nothing is published for that member, still carrying the floor; `401` for a token that is unknown, lapsed, or revoked; `426` for another protocol version; `405` for another method.

### Who is offered a staged release

The route registers one governed resource, **Staged releases**, so the console's role editor can grant `release.staged` to a role. A member holding it is offered the newest release of either channel; everyone else is offered the newest `general` release, even when a staged one is newer.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The protocol version is decided before the token is verified, because decoding a body under a grammar its sender did not mean is how a version check stops being one, and sending an out-of-date Runner to sign in again cannot help it.

The decision is asked fresh on every call rather than cached, so a role change, a suspended member, and a revoked device all take effect on the next check for an update. The governed resource is registered once per organization per process; registration is idempotent on the identity it names.

The answer re-encodes the stored document as JSON, which is safe because the signature covers the manifest's canonical bytes rather than the bytes of any particular transmission.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-team-release](../team-release/README.md) — the store this route reads.
- [dsh-team-update](../team-update/README.md) — what the installed application does with the answer.
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.md) — the shell that asks, verifies, downloads, and installs.
- [Team package map](../README.md) — adjacent Team packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the route registers no model input.

#### KV Cache effect

Nothing here joins a model request, so there is no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One answer per member, not per device** — a member with two computers is offered the same release for both, even where only one platform has a build.
- **No release history for a Runner** — the route answers with the newest release a member may take; a Runner cannot ask what else was published.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Every relationship this route depends on — the token, the grant, the stored release — is owned and asserted by another package.
