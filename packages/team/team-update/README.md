---
description: "Deciding whether an offered release may be installed: manifest signature, version monotonicity, upgrade path, platform artifact, and the background service definition an installer writes."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-update

English | [中文](README.zh.md)

## Summary

`dsh-team-update` answers one question — may this offered release replace the Runner running here? — and renders the background service definition an installer writes. Both are pure functions over data: the package downloads nothing, writes nothing, and launches nothing, because those need privileges and platform knowledge that belong to the installer. What belongs here is the decision, since a Runner replaces its own executable and being wrong about a manifest hands the machine to whoever produced it.

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
import { decideUpdate, serviceDefinitionFor } from '@deepseek-ai/dsh-team-update'
import type { ServiceDefinition, UpdateManifest, UpdateTarget } from '@deepseek-ai/dsh-team-update'

declare const manifest: UpdateManifest
declare const signature: string
declare const target: UpdateTarget
declare const definition: ServiceDefinition

const decision = decideUpdate(manifest, signature, target)
if ('install' in decision) {
  // decision.install names the artifact for this platform and processor.
}

const { filename, document } = serviceDefinitionFor('darwin', definition)
```

`decideUpdate` returns either the artifact to install or the word for why not — `signature`, `manifest-version`, `not-newer`, `upgrade-path`, `no-artifact`, or `malformed-version`. Each is a different thing for an installer to say and a different thing for a member to do.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The signature is checked first, against canonical bytes

Every later check reads a value the release key vouched for rather than one the document merely claims. The bytes are built by [`canonicalManifestBytes`](src/manifest.ts) with a fixed field order and sorted artifacts, so the same release signs identically however its artifacts were ordered, and a document that reorders its fields cannot present a different signature as valid.

### Versions compare numerically, ignoring prerelease tags

The harness ships prerelease tags in its own version, and an update decision must not turn on how those sort. A string that does not start with a number is refused as `malformed-version` rather than guessed at.

### `minimumFrom` makes an upgrade path expressible

A release that cannot be applied on top of an older build states the oldest one it accepts. A Runner below it installs an intermediate release first, rather than discovering the problem after replacing itself.

### The service runs as the member

A launchd *agent*, a systemd *user* unit, and a Windows *scheduled task* — never a daemon, a system unit, or a service. The Runner executes the member's own work with the member's own permissions, and each platform's elevated form would run it as something else. All three restart a crash with a ten-second floor, so a Runner that cannot start fails visibly instead of spinning.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The update decision and its refusals |
| [`src/manifest.ts`](src/manifest.ts) | The manifest format and the bytes a release key signs |
| [`src/version.ts`](src/version.ts) | Comparing dotted numeric versions |
| [`src/service.ts`](src/service.ts) | The three service definitions an installer writes |
| [`src/types.ts`](src/types.ts) | What a decision reads and answers, types only |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Team-handoff subsystem](../../../docs/subsystems/team-handoff.md) — the protocol version this Runner negotiates with the Control Plane.
- [`team-account-client`](../team-account-client/README.md) — where a protocol refusal tells a member to update.

<a id="model-experience"></a>
## Model Experience

None, as this decides installation and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **Nothing here downloads, verifies, or applies an artifact** — the manifest names a digest and a size; checking the bytes against them and replacing the executable belong to the installer that has the privileges to do it.
- **No signed platform installers are produced by this repository** — a `.pkg`, `.msi`, or `.deb` needs code-signing certificates and platform toolchains, and this package covers only the decisions those installers carry out.
- **One release key, passed in** — key rotation means a target that trusts more than one key, which needs its own design rather than a second parameter.
- **The service definitions are rendered, not installed** — writing them into `~/Library/LaunchAgents`, `~/.config/systemd/user`, or Task Scheduler, and removing them on uninstall, is the installer's job.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests drive a real Ed25519 release key and edit signed manifests field by field, because the property under test is not that a good manifest is accepted but that an edited one is not. The Windows document quotes an argument for the command line and then escapes the quotes for XML; a test asserting the unescaped form is asserting a broken document.

</details>

**Runtime invariant:** No companion is published: the package is a pure decision over a manifest and what this computer is; it mounts nothing, holds no state, and a release installed only when its signature verifies is a property of one function, which its tests observe directly.
