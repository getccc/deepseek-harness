---
description: "Composition row that masks the global tools one agent preset's agents see, by allow-list or deny-list, for users and maintainers composing a preset with a smaller tool surface than the host registers."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-restriction

English | [中文](README.zh.md)

## Summary

Use this package inside an agent preset to state which global tools that preset's agents see. An allow-list keeps only the named tools, a deny-list removes the named ones, and an empty allow-list removes every global tool, which is how the shipped `chat` preset stays tool-less whatever the host registers later. The row is scope-only: mounted in the host composition it fails loud, because a context-global mask would cover every agent. Names are checked against the tools registered when the row mounts, so a misspelled name fails the preset's first session instead of guarding nothing.

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

Add one row to a preset's `agent.cordis.yml`. Tools the preset's own rows register are never affected; only the tools every scope inherits from the host composition are masked.

### When to choose it

Choose it when a preset must see fewer tools than the host registers for everyone — a conversation-only preset, or one that must never reach a deployment-added tool such as knowledge search. Avoid it when the tool you want gone is registered by the preset itself, because a scope's own registrations are not restrictable; remove the row that registers it instead.

### Declaring the mask

```yaml
- id: tool-restriction
  name: '@deepseek-ai/dsh-tool-restriction'
  config:
    allow: []
```

| Field | Default | Meaning |
|---|---|---|
| `allow` | absent | Global tool names that stay visible; every other global tool is removed. `[]` removes them all |
| `allowWhenRegistered` | absent | Beside `allow` only: global tool names that also stay visible when a deployment has registered them by the time the row mounts, and are skipped rather than refused when it has not |
| `deny` | absent | Global tool names removed from visibility |

At least one list must be declared: a row that masks nothing fails validation, and an absent list is never read as an empty one. Both lists together intersect. A name no registered global tool carries fails when the row mounts, which for a preset is the first session that composes it — except in `allowWhenRegistered`, which exists so a shipped preset can keep a tool only some deployments register (the `chat` preset and Team knowledge search) without failing the others. It gives up the misspelling check in exchange, and it is read once at mount: a tool registered afterwards stays masked until the preset mounts again. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-restriction) documents every accepted value.

### What you get

Agents joined to the preset see the masked catalog in their tool schemas and cannot execute a masked tool, exactly as if the host had never registered it. The mask is a standing filter over the live global layer, so a tool the deployment registers after the preset mounted is masked too. Other presets and the host's own view keep the whole surface.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The row is the configuration face of `ctx.tools.restrict()`: `apply` validates that at least one list is present, then registers the restriction as one effect on the mounting context, so disposing the row lifts the mask. Everything else — intersection with other restrictions, the exemption of scope-local registrations, the unknown-name and unscoped-context refusals — is the registry's own contract, documented with the tools subsystem.

The scope the mask attaches to is the scope of the context the row was plugged into. Inside an agent preset that is the preset's standing mount, an ancestor of every agent that joins the preset, which is why one row covers them all.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, the at-least-one-list check, the `restrict()` effect |
| — | No runtime invariant companion is published; the row owns one registry effect and no state an independent companion could observe diverging. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tools subsystem reference](../../../docs/subsystems/tools.md) — scoped layers, `restrict()`, and why a scope's own registrations stay visible.
- [Agent presets](../../preset/agent-presets/README.md) — the composition files this row is written into, and the shipped `chat` preset that uses it.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-restriction) — every accepted config field and its source declaration.
- [guard group map](../README.md) — the sibling guard packages.

-----

<a id="model-experience"></a>
## Model Experience

### Global tool catalog after the mask

#### What the model sees

Nothing is added. Every global tool the mask removes is absent from the request's `tools` schemas for the preset's agents, and a call naming one is answered with the registry's `Error: unknown tool "<name>"` result, exactly as an unregistered tool would be.

#### Token effect

Zero direct tokens; the request carries fewer tool schemas than the unmasked host composition would send.

#### KV Cache effect

Prefix-stable: the masked catalog is fixed for the life of the preset's standing mount, so the tool-schema prefix of every request from its agents is identical. Lifting or re-mounting the row changes that prefix and invalidates reuse for requests after it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Global tools only** — a scope's own registrations are exempt by the registry's design, so a tool the preset's own row registers cannot be masked here; remove that row instead.
- **Mount-time name check** — a `deny` naming a tool the deployment registers only after the preset mounted fails the mount; declare it with `allow` instead, which never names what it removes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
