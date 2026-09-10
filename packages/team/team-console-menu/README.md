---
description: "Console-menu Service Definition: the administration console's navigation tree, the permission each entry names, and the shipped catalog an organization starts from."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-console-menu

English | [中文](README.zh.md)

## Summary

`dsh-team-console-menu` makes the administration console's navigation an organization's own data rather than a list inside the browser application. An entry says what it is called, where it goes, which page component renders it, and — the part that matters — which permission from the access-control catalog it needs. That last field is what a role's menu access is composed from, so giving a role a page is granting the permission the page declares, and navigation an administrator writes can never name authority this build does not govern. The package owns the vocabulary and the tree this build ships; pair it with a backend such as [`team-console-menu-sqlite`](../team-console-menu-sqlite/README.md).

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

Consumers declare `inject = ['consoleMenu']` and read or write the tree:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import '@deepseek-ai/dsh-team-console-menu'

declare const ctx: Context
declare const orgId: OrgId

const entries = await ctx.consoleMenu.listMenus(orgId)
const first = entries[0]
if (first !== undefined) await ctx.consoleMenu.updateMenu(first.id, { visible: false })
```

A Control Plane calls `seedShipped(orgId)` once as it starts. The call is idempotent and never an overwrite: an entry a deployment renamed, hid, or reordered keeps its edit, and one it deleted comes back at its shipped settings on the next start.

### What an entry is

| Kind | Means |
|---|---|
| `catalog` | A group with nowhere of its own to go |
| `menu` | A page: it has an address and names the component that renders it |
| `action` | Neither — it exists so a control inside a page can name the permission it needs |

`status` and `visible` are separate: a suspended entry is out of service, while a hidden one is simply not drawn in the sidebar.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Navigation decides nothing

The tree says what is worth offering. It is not what enforces anything: every request the console makes is authorized again by the administration API, so an entry visible to someone holding nothing is a navigation mistake rather than a way in.

### The permission an entry names is not free text

`isMenuPermission` checks a `resourceType|action` pair against [`dsh-access-control`](../../access/access-control/README.md)'s code catalog, and a backend refuses an entry that names anything else. An administrator composes navigation; they cannot invent a permission string, which is the same rule grants already follow.

### A shipped entry carries the console's own words

The console renders in more than one language, so an entry the product ships carries a `labelKey` the console translates through its dictionary. Renaming the entry drops that key: the words become the organization's own, and they are not this build's to translate.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The Service Definition, its failures, and the permission check |
| [`src/types.ts`](src/types.ts) | The record, the create and update inputs, and the shipped-entry shape |
| [`src/catalog.ts`](src/catalog.ts) | The navigation this build ships |
| [`src/brand.ts`](src/brand.ts) | The branded menu identity |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`team-console-menu-sqlite`](../team-console-menu-sqlite/README.md) — the backend that stores this.
- [`team-admin-api`](../team-admin-api/README.md) — the routes that read and write the tree, and turn menu access into grants.
- [`access-control`](../../access/access-control/README.md) — the permission catalog an entry may name.

<a id="model-experience"></a>
## Model Experience

None, as the package declares an administrator's navigation that no prompt section, tool, or request context reaches.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of this seam, not a task backlog.

- **A parent is chosen once** — `UpdateConsoleMenu` cannot move an entry to a different parent. Moving a subtree is a different operation from editing an entry, and the walk that orders the tree relies on a parent that never changes.
- **The component list belongs to the browser application** — an entry may name any `componentPath`, and only the console knows which components this build ships. One that names something else is navigation to a page that does not exist, and the console says so where the page would go.
- **One organization at a time in practice** — the records are organization-scoped, but the shipped tree is seeded by whichever component knows which organization a deployment serves, which today is the single-organization administration API.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Adding a page to the console means adding it here — a shipped entry with its key, copy key, route, component path, and permission — and adding the component to the browser application's own registry. The key is what re-seeding matches on, so it must never be reused for a different page.

</details>

**Runtime invariant:** No companion is published: the package declares an abstract service, a shipped catalog, and one pure check over the permission catalog; an organization's stored tree against the entries this build ships belongs to the provider that seeds it and its tests.
