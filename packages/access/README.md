---
description: "Package map for the governance family: the closed permission catalog and default-deny authorization seam, the append-only audit trail, and the SQLite backends behind both."
kind: "package-group"
---

# access/ — what a member may do, and what they did

English | [中文](README.zh.md)

## Summary

The `access/` group decides whether a principal may perform an action on a resource, holds the roles, grants, and governed resources that decision reads, and records what was decided. The evaluation is small — default deny, a role's grants admit, several roles union, a disabled resource is always refused — with no explicit deny, role inheritance, or expression language, so a refusal can be explained by naming the grants that produced it. Both halves are closed catalogs seeded from code: administrators compose roles from registered permission pairs, and an audit record carries catalog words, never anyone's work.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three capability seams, six packages; each child README owns the full contract.

| Package | Role | ctx key |
|---|---|---|
| [`access-control/`](access-control/README.md) | Service Definition and the code-seeded permission catalog | `ctx.accessControl` |
| [`access-control-sqlite/`](access-control-sqlite/README.md) | Stores roles, grants, and governed resources, and evaluates over them | registers `ctx.accessControl` |
| [`audit/`](audit/README.md) | Service Definition, the action and metadata catalogs, and the record check | `ctx.audit` |
| [`audit-sqlite/`](audit-sqlite/README.md) | Stores the append-only trail and declares the same rules to the database | registers `ctx.audit` |
| [`quota/`](quota/README.md) | Service Definition: reserve before an upstream call, settle once afterwards | `ctx.quota` |
| [`quota-sqlite/`](quota-sqlite/README.md) | Keeps the ledger and reconciles what nobody settled | registers `ctx.quota` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Access-control subsystem](../../docs/subsystems/access-control.md) — the evaluation rules and the records they read.
- [Audit subsystem](../../docs/subsystems/audit.md) — the closed vocabularies and the storage rules that keep task content out.
- [Quota subsystem](../../docs/subsystems/quota.md) — a reservation as the ceiling, and one settlement per request.
- [`account/`](../account/README.md) — the identities this authorizes, and the organization whose policy revision it advances.
- [Capability seams](../../docs/capability-seams.md) — the Service Definition / Service Provider / Consumer split this family follows.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Quota lives beside authorization rather than inside it: authorization answers whether a principal may use a resource, and quota answers whether there is budget left. A single refusal covering both would be ambiguous to the member reading it, so a gateway asks each in turn.

Authorization and audit are separate seams rather than one service that decides and records, because the store that evaluates a request knows no principal's device, correlation, or intent. A record is written by the operation that had them.

</details>
