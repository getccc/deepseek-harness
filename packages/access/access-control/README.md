---
description: "The access-control seam and its code-seeded permission catalog: default-deny authorization over roles, grants, and governed resources."
kind: "package-reference"
---

# @deepseek-ai/dsh-access-control

English | [中文](README.zh.md)

## Summary

`dsh-access-control` is the one question every company-resource entry and every administrative operation asks: may this principal perform this action on this resource? The evaluation it specifies is deliberately small — default deny, a role's grants admit, several roles union, a disabled resource is always refused — with no explicit deny, no role inheritance, and no expression language, so a decision can be explained by naming the grants that produced it. The package also owns the permission catalog, seeded from code and closed: an administrator composes roles out of registered `(resourceType, action)` pairs and cannot invent a permission string. Pair it with a backend such as [`access-control-sqlite`](../access-control-sqlite/README.md).

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

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import '@deepseek-ai/dsh-access-control'

declare const ctx: Context
declare const orgId: OrgId
declare const principalId: UserId

const decision = await ctx.accessControl.authorize({
  orgId, principalId, action: 'model.invoke', resourceType: 'model', resourceId: 'deepseek-v4',
})
if (decision.allowed) {
  // decision.matchedGrantIds names what admitted it; decision.policyRevision is
  // the revision it was computed against.
}
```

The principal always comes from an authenticated token. A caller never passes a role, a grant, or a scope: those are read here, so nothing a request body carries can widen what it is allowed to do.

### Granting

A **type grant** lets a role perform one action on every enabled resource of a type, including resources governed after the grant was written. A **resource grant** names one resource. Both are refused unless the catalog governs the pair.

`listRoleGrants` returns both grant kinds with the target identity an administrative surface needs; it does not make an authorization decision or imply that the reader may edit them.

### Reading a refusal

`no-grant` covers both "no grant admits this" and "no such resource", so a refusal never confirms that a resource exists to a principal who holds nothing on it. `default-deny` means the principal holds no roles at all. `resource-disabled` is the deliberate exception that does confirm existence: it answers a principal who *does* hold a grant, and telling them the resource is switched off is the difference between a useful message and a confusing one.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Why the catalog is closed

Permissions are values in code, not strings a database accepts. A pair outside [`PERMISSION_CATALOG`](src/permissions.ts) is not a permission, so a typo fails where the grant is written rather than silently admitting or refusing when a request arrives. Action names are fully qualified and need not repeat their resource type verbatim: the type is what a grant matches on, the action is what a person reads in an audit row.

### Why there is no explicit deny

With allow-only grants, a decision is the union of what the principal's roles carry, and explaining it means listing those grants. Adding deny would make order and precedence part of the answer, and "why was this refused?" would need a policy engine replay instead of a list.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The abstract service, its failures, and `ctx.accessControl` |
| [`src/permissions.ts`](src/permissions.ts) | The closed permission catalog and its membership test |
| [`src/brand.ts`](src/brand.ts) | Role, group, resource, and grant identities |
| [`src/types.ts`](src/types.ts) | Entity, request, and decision shapes, types only |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`access-control-sqlite`](../access-control-sqlite/README.md) — the shipped backend.
- [Access-control subsystem](../../../docs/subsystems/access-control.md) — the evaluation rules in full.
- [`account-store`](../../account/account-store/README.md) — the identities authorized and the policy revision advanced.

<a id="model-experience"></a>
## Model Experience

None, as authorization is server-side and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **No explicit deny and no role inheritance** — both are deliberate, and both would change what a decision means. Adding either needs its own design, not a field.
- **One organization per request, resolved by the caller** — `authorize` takes an `orgId`; nothing here decides which organization a request belongs to.
- **Quota is a separate question** — this answers whether a principal may use a resource, never whether budget remains. Merging them would make a refusal ambiguous.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`scopes` on an allow carries only the resource the request named. Assembling a multi-scope assertion is a gateway's loop over its own authorized list; adding a bulk query here would invite callers to authorize once and act many times.

</details>
