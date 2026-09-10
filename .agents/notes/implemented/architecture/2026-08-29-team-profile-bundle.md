# Agent Note: The team profile stacks on web-app instead of forking it

Status: implemented

English | [中文](2026-08-29-team-profile-bundle.zh.md)

## Problem

Team Edition needs its own `dsh` surface: company accounts, RBAC, the model and knowledge gateways, and a local login handoff. Every one of those is additive to the browser application `dsh web` already serves — none of them replaces it.

Two shapes were available. A team bundle could restate the browser surface itself, owning its own copy of the rows `dsh-web-app` inserts, or it could sit above `dsh-web-app` as one more patch layer. The first shape duplicates a large, actively changing row set and guarantees the two copies drift. The second requires that everything Team adds can be expressed as an override or an insert over an already-composed tree.

A second problem arrives with the first row this layer needs. A Team Runner is a long-lived background service, while `dsh web` is a foreground tool a developer starts by hand. Both are ordinary loopback servers, so they cannot share a port: whichever binds second fails. `dsh web` defaults to `3080`, so a Team Runner that also defaulted to `3080` would fail to start on every machine that had ever run `dsh web` — and the failure would land on the product that must work without configuration, while the development tool kept the port.

## Decision

`@deepseek-ai/dsh-team` is a patch-list carrier stacked above `dsh-web-app`, and the `team` profile template composes `dsh-base`, `dsh-web-app`, then this layer. The browser application, session store, and every local capability stay owned by the bundles that already own them.

The layer's first and currently only row overrides `webserver` to default to `3090`, restating every key that row owns because a patch replaces the whole `config`. `--port` still wins, and `inject` stays with the row `dsh-web-app` inserted.

The port is fixed rather than scanned. A company entry point navigates the browser to a known loopback address, so a Runner that silently relocated after a port conflict would be unreachable rather than merely absent — a worse failure than refusing to start with a diagnostic.

The profile keeps `patchReload: live`, matching `web`, because it serves the same browser surface.

### Package topology

| Path | Role |
|---|---|
| `packages/bundle/team/cordis.patch.yml` | The layer: rows this bundle overrides |
| `packages/bundle/team/src/index.ts` | Module identity; no runtime API |
| `packages/boot/app-boot/src/profile.ts` | The `team` entry in `PROFILE_TEMPLATES` |

The bundle declares no dependency on the packages whose rows it overrides. `dsh-base` declares dependencies for the packages it *inserts*; a layer that only overrides existing rows by id inserts nothing, so its dependency closure stays empty. The layering relationship lives in the profile template's bundle list, which is the composer's own input.

## Alternatives considered

**A team bundle that restates the browser surface.** Rejected: it duplicates the row set `dsh-web-app` owns, and the copies drift on every web-app change. Stacking keeps one owner per row.

**Deriving the port per operating-system user.** Rejected for this layer: a company entry point cannot learn the target user's port from the browser, so a derived port needs a local launcher or a custom protocol entry to be reachable at all. Until one of those exists, a fixed port keeps the entry point addressable.

**Scanning for a free port on conflict.** Rejected: it converts a loud startup failure into a silently unreachable Runner, because the entry point still navigates to the configured address.

**`patchReload: startup` for a background service.** Deferred rather than rejected: recomposing on a user patch edit is the behavior the `web` profile already ships, and no service-managed deployment yet needs the startup-only variant.

## Consequences

Only one Team Runner can hold the loopback port on a machine at a time, so a second Runner started by another operating-system user fails to bind. Concurrent multi-user machines are therefore out of scope for this layer; lifting that limit requires the local launcher or protocol entry named above.

Every later Team row — the account client, the company model and knowledge transports, the local handoff endpoints — lands in this same patch file, and each must restate the whole `config` of any row it overrides.

Changing `dsh web`'s default port would silently re-create the collision this layer exists to avoid; the bundle's test asserts the two defaults stay distinct.
