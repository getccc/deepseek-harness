---
description: "Package map for the access-control capability family: the closed permission catalog and default-deny authorization seam, and the SQLite backend that stores roles, grants, and governed resources."
kind: "package-group"
---

# access/ — what a member may do

English | [中文](README.zh.md)

## Summary

The `access/` group decides whether a principal may perform an action on a resource, and holds the roles, grants, and governed resources that decision reads. The evaluation is deliberately small — default deny, a role's grants admit, several roles union, a disabled resource is always refused — with no explicit deny, no role inheritance, and no expression language, so a refusal can be explained by naming the grants that produced it. The permission catalog is seeded from code and closed: administrators compose roles out of registered pairs rather than inventing permission strings.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Two packages cover the capability; each child README owns the full contract.

| Package | Role | ctx key |
|---|---|---|
| [`access-control/`](access-control/README.md) | Service Definition and the code-seeded permission catalog | `ctx.accessControl` |
| [`access-control-sqlite/`](access-control-sqlite/README.md) | Stores roles, grants, and governed resources, and evaluates over them | registers `ctx.accessControl` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Access-control subsystem](../../docs/subsystems/access-control.md) — the evaluation rules and the records they read.
- [`account/`](../account/README.md) — the identities this authorizes, and the organization whose policy revision it advances.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Quota is deliberately not here: authorization answers whether a principal may use a resource, and quota answers whether there is budget left. Merging them would make a refusal ambiguous.

</details>
