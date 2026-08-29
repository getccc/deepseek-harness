---
description: "Package map for the team handoff: the Control Plane's Runner-facing binding endpoints, the Runner's account custody, and the local addresses a browser navigates to."
kind: "package-group"
---

# team/ — getting from the company site to this computer

English | [中文](README.zh.md)

## Summary

The `team/` group carries a member from the company site into the application running on their own computer, and keeps the credential that results. It is deliberately not a tunnel: no workspace, session, terminal output, or diff crosses the network, and the site is the habitual entry rather than a checkpoint — opening the local address directly gets the same application, which is what keeps the product usable when the Control Plane is unreachable.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three packages, split by which side of the network they run on; each child README owns the full contract.

| Package | Side | Role | ctx key |
|---|---|---|---|
| [`team-control-plane-http/`](team-control-plane-http/README.md) | Control Plane | Runner-facing binding endpoints: start, redeem, refresh | — |
| [`team-account-client/`](team-account-client/README.md) | Runner | The device key, the credential, and the calls to the Control Plane | `ctx.teamAccountClient` |
| [`team-local-handoff/`](team-local-handoff/README.md) | Runner | The three local addresses a browser navigates to | — |

-----

<a id="related-documentation"></a>
## Related documentation

- [Team-handoff subsystem](../../docs/subsystems/team-handoff.md) — the three addresses, the callback's same-site bounce, and what the local state does.
- [Device-authorization subsystem](../../docs/subsystems/device-authorization.md) — the seam these endpoints expose and this client drives.
- [`client/connection`](../client/connection/README.md) — owns the local browser session these endpoints hand out.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The one detail that must not be "simplified": `/team/callback` answers 200 with a self-navigating page rather than a redirect. A `SameSite=Strict` cookie is withheld from every request in a cross-site navigation chain, so a redirect lands the browser on the application without the session it was just given.

</details>
