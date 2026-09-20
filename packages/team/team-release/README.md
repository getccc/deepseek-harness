---
description: "Published desktop releases: the signed manifests a deployment offers, who each one is offered to, and the oldest build it still accepts; for maintainers of a Team deployment's release process."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-release

English | [中文](README.zh.md)

## Summary

This package holds what a deployment has published: for each release, the signed manifest exactly as the release machine produced it, its signature, whether it is offered to everyone or only to staged members, and whether it was withdrawn. It also holds the one version floor a deployment enforces. It signs nothing and decides nothing about members — a compromised Control Plane can withhold a release or offer an older one, which an installed application refuses as `not-newer`, but cannot publish a release of its own.

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

Mount it in a Control Plane composition with a database path; the console publishes into it and [`dsh-team-release-http`](../team-release-http/README.md) answers Runners from it.

```yaml
- id: team-release
  name: '@deepseek-ai/dsh-team-release'
  config:
    path: !!js dshHomePath('control-plane', 'releases.sqlite')
```

`publish` records one release, or replaces the record of a version published before — promoting a staged release to everyone is the same call with `channel: 'general'`. `withdraw` stops offering one without forgetting it existed. `offered` answers the newest release a member may take, and `floor` the version below which this deployment's application refuses to run.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The manifest and signature are stored as text, byte for byte, because the signature covers the manifest's canonical bytes and re-encoding the document would invalidate it. Publishing checks one thing: that the document describes the version it is published as, which is the mistake that would otherwise ship a signature over another release's files.

Versions are ordered in memory by their numbers rather than by SQLite's text collation, using the same comparison the installed application makes, so `1.0.10` is newer than `1.0.9` here for the same reason it is there. A deployment holds a handful of releases, so the sort costs nothing worth indexing for.

Withdrawal is a timestamp rather than a deletion, so an administrator can tell a release that was pulled from one that was never published.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-team-release-http](../team-release-http/README.md) — the Runner-facing route that answers from this store.
- [dsh-team-update](../team-update/README.md) — the decision an installed application makes about what this store offers it.
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.md) — the shell that publishes into it and installs from it.
- [Team package map](../README.md) — adjacent Team packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as publishing and offering releases register no model input.

#### KV Cache effect

Nothing here joins a model request, so there is no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Two channels, not arbitrary cohorts** — a release is offered to everyone or to members whose roles grant the staged channel; a deployment that wants several independent pilot groups needs more than this store holds.
- **No signature verification** — the store records a signature it cannot check, because the release public key lives in the installed application. A console that publishes a corrupt signature learns about it when a member's application refuses the release.
- **One floor per organization** — the version floor applies to every member and every platform.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The store owns its own rows, and authorization stays with access control, which this package cannot assert anything to.
