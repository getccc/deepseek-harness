---
description: "Package map for the guard family: the advisory repeat-tool reminder, the per-tool-call timeout policy, and the per-composition tool-catalog restriction, for users and maintainers choosing or composing the guards."
kind: "package-group"
---

# guard/ — tool-call guard family

English | [中文](README.zh.md)

## Summary

The `guard/` group keeps tool calls productive and bounded. `repeat-tool-reminder` notices when the model repeats the exact same tool call and reminds it to change approach or finish. `timeout-policy` puts a time limit on tool calls that declare one, so a hung call returns a clear timed-out error instead of stalling the session. `tool-restriction` lets one agent preset state which global tools its agents see, so a tool-less composition stays tool-less whatever the host registers. The first two ship enabled in the `dsh` base bundle; the third is a row a preset composition mounts.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Three small plugins; each README below explains when to keep, tune, or remove it.

| Package | What it provides |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.md) | Reminds the model when it repeats the same tool call, so it changes approach or finishes |
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |
| [`tool-restriction/`](tool-restriction/README.md) | Masks global tools for the agents of one preset composition, by allow-list or deny-list |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the tools subsystem reference for the tool-call pipeline, then the reminder's configuration and the timeout-library decision behind the policy.

- [Tools subsystem reference](../../docs/subsystems/tools.md) — the tool-call pipeline and decisions the guards build on.
- [Generated configuration catalog](../../docs/config-catalog.md#deepseek-aidsh-repeat-tool-reminder) — every accepted field of the repeat-call reminder.
- [Timeout deadline library Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.md) — the timing/termination split `timeout-policy` enforces.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
