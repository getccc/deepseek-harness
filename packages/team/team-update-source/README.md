---
description: "The Runner's loopback release route: the desktop shell asks it, and the Runner asks the Control Plane with the device credential the shell does not hold; for maintainers of the Team desktop application."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-update-source

English | [中文](README.zh.md)

## Summary

This package answers one loopback route, `/team/update/manifest`, with the release this deployment offers the signed-in member. The desktop shell asks it because the shell has no member credential and should not have one, while the Runner already holds the device credential the deployment issued. The Runner adds nothing the shell trusts: it hands back the signed document unchanged, and the shell verifies the release key's signature itself before anything is downloaded.

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

Mount it in a Team Runner composition that carries `webServer` and `teamAccountClient`; the desktop installer writes this row with the deployment it was packaged for.

```yaml
- id: team-update-source
  name: '@deepseek-ai/dsh-team-update-source'
  config:
    controlPlaneUrl: https://control.example.com
    controlPlaneCa: /absolute/path/to/control-plane-ca.crt
```

`GET /team/update/manifest` answers what the Control Plane answered: `200` with the manifest, its signature, and the version floor; `404` when nothing is published for this member; `401` when this Runner holds no credential; `503` when the deployment is unreachable; `502` when something other than the Control Plane answered.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The route reads the Runner's access token per request rather than caching one, so a revoked device stops being offered releases on the next check. The Control Plane call carries the deployment's pinned certificate authority, like every other Runner call, because Node ignores the operating system's trust store.

Each failure keeps its own status: unreachable, unreadable, and unauthenticated mean different things to the shell, which reports the reason to the member and keeps the installed build running in all three.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [dsh-team-release-http](../team-release-http/README.md) — the Control Plane route this one asks.
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.md) — the shell that asks this route, verifies, downloads, and installs.
- [dsh-team-account-client](../team-account-client/README.md) — the device credential this route carries.
- [Team package map](../README.md) — adjacent Team packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as the route registers no model input.

#### KV Cache effect

Nothing here joins a model request, so there is no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Loopback only, and unauthenticated there** — anything that can reach the Runner's port can read this route. What it returns is a public signed document, and the route neither installs nor downloads anything.
- **No caching** — every check asks the Control Plane again, which is what makes a revoked device take effect immediately and what costs one request per check.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The credential, the decision, and the release are each owned and asserted by another package; this route carries an answer between two of them.
