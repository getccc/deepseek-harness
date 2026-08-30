---
description: "The dsh Team Edition surface: the shared local Runner layered over dsh-web-app on its own loopback port, for deployments composing the team profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-team

English | [中文](README.zh.md)

## Summary

`dsh-team` is the layer that turns the local web surface into a Team Runner. It stacks on top of [`dsh-base`](../base/README.md) and [`dsh-web-app`](../web-app/README.md) rather than replacing either, so the browser application, session store, and every local capability stay exactly where they already live. What this layer owns is the loopback port — the Team Runner listens on `3090`, leaving `3080` to `dsh web`, so a developer can run both at once — the team account this computer holds, and the three local addresses a browser navigates to. The model and knowledge gateways arrive here as their packages land.

It does not bind unconfigured: the account-client row names no Control Plane and no Runner version, so a Runner nobody told which company it belongs to fails to load rather than sending a public key to a stranger.

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

You do not mount this bundle directly. Select the profile that stacks it:

```sh
dsh --profile team
```

The profile composes `dsh-base`, then `dsh-web-app`, then this layer, and opens the same browser application `dsh web` serves — at `http://127.0.0.1:3090`.

### Running alongside `dsh web`

Both are ordinary loopback servers, so they cannot share a port: whichever binds second fails. Keeping the Team Runner on its own default means you can leave a development `dsh web` on `3080` running while the Team Runner serves `3090`, with no configuration edit on either side.

### Choosing another port

`--port` still wins over the composed default:

```sh
dsh --profile team --port 8080
```

A deployment that needs a different fixed port overrides the `webserver` row from the profile's own `cordis.patch.yml`, restating every key it keeps. The port is deliberately fixed rather than scanned: a company entry point navigates the browser to a known address, so a Runner that silently relocated would be unreachable rather than merely absent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Composition mechanics

The package's substance is `cordis.patch.yml`, named by the `dsh.bundle.patch` manifest field. The profile composer applies each bundle's patch in the order the profile lists them, so this layer sees the rows `dsh-base` and `dsh-web-app` already inserted and overrides them by id.

A patch replaces the targeted row's whole `config`, so the `webserver` row here restates every key it owns — `host`, `port`, `compression`, `compressionLevel`, and `compressionThresholdBytes` — while `name` and `inject` stay with the row the earlier layer inserted.

### Source map

| Path | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The layer itself: the rows this bundle overrides |
| [`src/index.ts`](src/index.ts) | Module identity only; the bundle exposes no runtime API |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

### Invariant ownership

The package is a static patch-list carrier: it mounts no service, emits no events, and owns no mutable relation to check, so its companion installs nothing. The `webserver` row it overrides carries its own bind invariants in [`dsh-host-webserver`](../../host/webserver/README.md).

-----

<a id="further-exploration"></a>
## Further Exploration

- [app-boot profile section](../../boot/app-boot/README.md) — how profiles resolve, layer, and reload.
- [`dsh-web-app`](../web-app/README.md) — the browser surface this layer extends.
- [Bundle package map](../README.md) — the other surfaces built on `dsh-base`.
- [Generated composition graph](../../../apps/cli/composition.md) — the exact plugin set each shipped profile uses.

-----

<a id="model-experience"></a>
## Model Experience

None, as the layer overrides one transport address and inserts no prompt section, tool, or request context of its own.

#### KV Cache effect

The bundle adds nothing to the request prefix; every model-facing row belongs to `dsh-base` and `dsh-web-app`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of this layer, not a task backlog.

- **One Team Runner per machine at a time** — the loopback port is a machine-wide resource, so a second Runner started by another operating-system user fails to bind rather than relocating. Concurrent multi-user machines are out of scope for this layer.
- **Overrides replace whole settings blocks** — a later patch that changes one `webserver` key must restate the rest; nothing merges automatically.
- **Team identity and company resources are not here yet** — this layer currently owns only the loopback address. The account client, company model and knowledge transports, and the local login handoff land as their packages arrive.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The profile keeps `patchReload: live`, matching `web`, because it serves the same browser surface. A background service that recomposes on a user patch edit is the same behavior the web profile already ships; revisit only if service-managed deployments need the startup-only variant.

</details>
