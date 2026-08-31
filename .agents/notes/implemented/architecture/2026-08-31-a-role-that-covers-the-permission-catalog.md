# Agent Note: A role that covers the permission catalog, and what an administrator may take away

Status: implemented

English | [中文](2026-08-31-a-role-that-covers-the-permission-catalog.zh.md)

## Problem

[The navigation note](../feature/2026-08-31-navigation-is-data-and-menu-access-is-a-grant.md) added six permissions to the catalog. Every console control they gate went dead in the deployment that was already running: its administrator role held thirty-five of the thirty-nine pairs, and the four it lacked — `department.manage`, `member.update`, `role.update`, `role.delete` — were exactly the New, Delete, and Edit buttons an administrator reported as unclickable.

That is not a mistake in one deployment. Grants are stored rows, so a role holds what it was given and nothing else, and the permission catalog is seeded from code, so it grows with every build. Every build that governs something new therefore locks the administrator out of it, and the only way back is to name the new pairs by hand — through a dialog that adds one permission at a time, chosen from a flat list of forty strings.

The second half of the same problem is what an administrator cannot do at all. An account could be suspended but never deleted, so a directory accumulated rows nobody could remove.

## Decision

**A role may be marked as covering the catalog, and the Control Plane keeps that true.** `Role.coversCatalog` says the role holds every permission this build governs; `AccessControl.syncCatalogRole` grants the pairs it lacks, and the administration API runs it for every marked role in its organization as the process starts. The grants are real rows rather than a wildcard, so evaluation stays what it was — default deny, a role's grants admit — and a decision can still be explained by naming the grant that produced it.

The sync is additive only. A pair the catalog no longer names stays where it is, because the grant may still be the reason something works, and a start that grants nothing writes no audit row: nothing about what the role admits changed.

**The schema migration marks the system role.** Before this column existed, a deployment's bootstrap created its administrator with `kind: 'system'` and granted it the whole catalog by hand. Marking those roles once, as the column is added, keeps that intent working across the upgrade rather than requiring every existing deployment to discover the four missing grants. A role created from now on is marked only when someone asks.

**Marking a role is grant management, not editing.** The route accepts `coversCatalog` under `role.update` like the other fields, and additionally asks `role.grant.manage` whenever the request carries it, because that field widens what the role admits while the others only change how it reads.

**A role's permissions are set as a set, from a tree.** `POST /roles/:id/permissions` makes a role's type grants exactly the pairs it was given: checking grants, clearing revokes. Grants over one named resource are not in that list and are left alone — a catalog editor must not silently drop what it does not show. The console renders both this and menu access as checkable trees, the catalog branching by resource type and navigation by its own parents, which is the same tree an administrator already reads on the menus page.

**An account can be deleted.** `member.delete` gates it. The store removes the account and the browser sessions it held, and leaves a department it led without a lead rather than deleting the department with the person. The route first unbinds the account's roles and revokes the computers it bound, because a binding or a credential naming an account that is gone would admit work nobody can account for. Audit rows stay: they are the history of what the account did, and history does not leave with it. An administrator cannot delete the account they are signed in as, which would end the session carrying out the request.

## Alternatives considered

**A super-admin that authorization short-circuits.** Rejected because it is the one thing this evaluation does not have. `AccessDecision` names the grants that admitted a request, and a wildcard admits with nothing to name; every explanation, audit reading, and "why can they do that" answer would acquire a special case. Materializing the grants keeps one story.

**Treating `kind: 'system'` as covering the catalog forever.** Rejected because a system role means the product ships it and nobody can delete it, not that it holds everything; a deployment that later ships a limited system role would have it silently widened by an upgrade. The migration uses `kind` once, to read the intent that was already there, and the explicit mark carries it from then on.

**Re-running the deployment's bootstrap script on start.** Rejected because a bootstrap creates an organization and an administrator, and a start must not do either. What has to stay current is one role's grants, which is what the API asks for.

**Leaving account deletion out.** Recorded as rejected in [the navigation note](../feature/2026-08-31-navigation-is-data-and-menu-access-is-a-grant.md) on the grounds that an account anchors audit records. That reasoning was about the audit rows, and it holds — they stay. It does not reach the account row, which nothing else needs: a directory that can only grow is not a directory an administrator can keep.

**Keeping "add one permission" beside the new set editor.** Rejected because two controls that write the same grants disagree about what unchecking means. The tree shows what the role holds and writes what it shows.

## Consequences

An administrator who holds `role.grant.manage` can bring a role up to the catalog in one action, and a role marked as covering it never falls behind a build again. A deployment upgrading from an earlier schema finds its administrator role marked and complete on the next start, with an audit row naming what that start granted.

`SCHEMA_VERSION` advances for access control, adding `covers_catalog` with the one-time backfill above. The permission catalog gains `member.delete`, so a deployment binding roles by naming permissions adds it for the control to appear — unless the role covers the catalog, which is the point.

Deletion is the only irreversible act the console offers. It refuses the signed-in account and nothing else: an organization can still be left with no administrator by deleting the second-to-last one, which the console does not detect.
