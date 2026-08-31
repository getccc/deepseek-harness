# Agent Note: Console navigation is organization data, and menu access is a grant

Status: implemented

English | [中文](2026-08-31-navigation-is-data-and-menu-access-is-a-grant.zh.md)

## Problem

The administration console described in [the browser-application note](../architecture/2026-08-30-administration-console-as-a-browser-application.md) shipped a fixed sidebar: six views listed in `App.tsx`, each guarded by one permission written beside it. Three things follow from that, and all three are defects rather than simplifications.

An administrator cannot see the organization chart, because no chart exists — accounts carry no department, and there is nothing between the organization and an account. The users table therefore cannot answer "who is in Technology", and the organization page is a single card with one editable field, which is not a page.

An administrator cannot see what a role admits without reading permission strings. A role has a display name and a list of `resourceType|action` pairs. Nothing connects those pairs to the pages an administrator navigates, so composing a role means knowing the catalog by heart.

An administrator cannot change what the console offers. Reordering a page, hiding one a deployment does not use, or grouping devices and models under one heading are all source edits and a rebuild.

## Decision

**Navigation becomes durable data, in its own seam.** [`dsh-team-console-menu`](../../../../packages/team/team-console-menu/README.md) declares the record; [`dsh-team-console-menu-sqlite`](../../../../packages/team/team-console-menu-sqlite/README.md) stores it. An entry names its words, its address, the page component that renders it, its icon, its order, whether it is in service, and whether it is drawn. The tree this build ships is a code constant seeded per organization on start, matched on a stable key: a deployment's rename, reorder, or hidden entry survives every restart, and a deleted shipped entry returns at its shipped settings.

**An entry declares a permission from the closed catalog, and that is what menu access grants.** `POST /roles/:id/menus` takes the entries a role is to reach and makes the role's type grants match: it adds the permission each chosen entry declares, revokes the permissions of entries not chosen, and leaves alone every pair no entry declares. So "菜单权限" is a view over grants rather than a second authorization system, and an administrator composing a role by page is composing it out of the same `PERMISSION_CATALOG` a grant has always named. Navigation still enforces nothing: every route asks access control again, so an entry visible to someone holding nothing is a navigation mistake and not a way in.

**The organization chart lives in the account store.** A `department` table holds a per-organization tree with a code unique inside the organization, a category, a lead who is an account, contact fields, an order, and a status. Accounts gain `phone`, `gender`, and `department_id`. Both are the account store's business — an organization and the people in it — and keeping departments there is what lets `account_user.department_id` be a real foreign key rather than an id in another database.

**Roles gain a code and a creation moment.** The code is the stable identifier a deployment's own configuration names a role by, so renaming a role for a reader breaks nothing. A role stored by an earlier build takes its own id as a starting code, which is unique by construction; it carries no creation moment, because a made-up timestamp reads exactly like a real one.

**The console's four administration pages take the shape of the reference the request named.** Departments is a tree table whose root row is the organization itself — editing that row is the rename the organization page used to be, and the standalone organization page is gone. Users is a department tree beside a filtered, paginated table. Roles carries code, reach, holders, and menu access. Menus is the tree itself, edited in place.

## Alternatives considered

**Keep navigation in the source and add a menus page that only reorders.** Rejected because the request is a management page, and a page whose New button is absent is not one. Storing the tree also removes the sidebar's dependence on a rebuild, which is the reason the shipped list existed.

**Let a menu entry name any permission string.** Rejected for the reason a grant cannot: the closed catalog is what makes a typo fail where it is written. A backend refuses an entry naming a pair the catalog does not govern, and the console's field is a select over the catalog rather than a text box.

**Give a role its own stored data-scope setting.** Rejected because nothing would enforce it. The reach column reads the grants themselves — a grant over a resource type admits every resource of it, a grant over one resource admits that one — so the column cannot disagree with what the role actually does.

**Give a role a status toggle, as the reference does.** Rejected because a suspended role is not a concept this build has, and a control that changes a column nobody reads is worse than an absent control. Unbinding the role, or deleting it, is the act that exists.

**Offer deleting an account.** Rejected here because an account anchors audit records and device credentials, and suspension already ends every session the member holds and is reversible. [A later note](../architecture/2026-08-31-a-role-that-covers-the-permission-catalog.md) takes that further: the audit rows do stay, and the account row goes.

**Put departments in a new package beside menus.** Rejected because an organization and the accounts in it are the account store's own subject, and a department in another database would make an account's department an unenforced reference.

**Seed navigation from inside the store.** Rejected because the store does not know which organization a Control Plane serves. The administration API is the one component whose config names it, so seeding is a call that component makes.

## Consequences

An administrator can build the organization chart, place accounts in it, filter the directory by department, compose a role out of the pages it may open, and change what the console offers — all without a rebuild and all through the same session, origin, CSRF, access-control, and audit path every other administrative write takes.

`SCHEMA_VERSION` advances for the account store (departments and the three account columns) and for access control (a role's code and creation moment). Both add columns to tables an earlier build wrote, so both bring the additive `ALTER TABLE` that `CREATE TABLE IF NOT EXISTS` cannot: a database an earlier build wrote keeps its rows and gains the columns. A change that alters or drops an existing column still has no path.

The Control Plane composition gains one row, and the permission catalog gains `department.read`, `department.manage`, `menu.manage`, `member.update`, `role.update`, and `role.delete`. A deployment that binds roles by naming permissions must add the new ones for the pages to appear.

Deferred, and deliberately absent rather than shown as controls that do nothing: bulk import of accounts, moving a department or a navigation entry to a different parent, account deletion, a role status, and per-viewer column preferences. The console still targets a single-instance, single-organization deployment.
