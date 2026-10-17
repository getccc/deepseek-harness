---
description: "Package map for the GMO supply-chain capability family: the GMO service that a Team Runner asks for the processing results its member may analyze."
kind: "package-group"
---

# gmo/ — GMO supply-chain analysis capability family

English | [中文](README.zh.md)

## Summary

The `gmo/` group gives the harness the company's GMO supply-chain platform, excel-tools, through one provider-neutral service (`ctx.gmo`). Its results are governed: which business lines (categories such as GB / GL allocation) a member may analyze is a role decision an administrator makes, and the token reaching excel-tools must not sit in a member's process. In Team Edition a Runner-side provider forwards each operation to a Control Plane that authorizes it. The group owns the vocabulary — category and result references, the question vocabulary, the `gmo/scope` Session event, the closed failure set — and the model-facing tools that read it.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Eight packages in this group play the GMO roles; the controller and the composer control sit beside the other Team browser packages. The subsystem reference owns the exhaustive vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`gmo/`](gmo/README.md) | GMO service: the authorized category directory, result listing, description, questions, the stable references, and the Session scope | `ctx.gmo` |
| [`gmo-source/`](gmo-source/README.md) | Upstream source seam: listing a source's categories and results, placing and describing a result, and asking one already-authorized result a question | `ctx.gmoSource` |
| [`gmo-excel-tools/`](gmo-excel-tools/README.md) | Speaks excel-tools' fixed read-only gateway routes, holding the gateway token in the Control Plane | registers on `ctx.gmoSource` |
| [`gmo-gateway/`](gmo-gateway/README.md) | Governed gateway seam: the durable category catalog, and the authorized directory, listing, description, and question | `ctx.gmoGateway` |
| [`gmo-gateway-sqlite/`](gmo-gateway-sqlite/README.md) | Durable catalog over SQLite, with synchronization, per-category authorization, and audit | registers on `ctx.gmoGateway` |
| [`gmo-gateway-http/`](gmo-gateway-http/README.md) | The four routes a Runner calls, with token verification and protocol-version negotiation | registers routes on `ctx.webServer` |
| [`gmo-team/`](gmo-team/README.md) | Runner-side provider: one Control Plane request per operation, carrying the device token | registers on `ctx.gmo` |
| [`tool-gmo/`](tool-gmo/README.md) | What a model sees: the five tools, the scope prompt section, and scope-driven visibility | registers on `ctx.tools` and `ctx.systemPrompt` |

Two packages elsewhere complete the capability: [`api/gmo-controller`](../api/gmo-controller/README.md), the Team-only Remote that serves the browser its authorized categories and records the choice, and [`client/ui-gmo`](../client/ui-gmo/README.md), the composer control.

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the proposal that explains why the capability is shaped this way.

- [GMO subsystem](../../docs/subsystems/gmo.md) — the directory, listing, description, question vocabulary, Session scope, stable references, and the closed failure taxonomy.
- [Team GMO supply-chain analysis Agent Note](../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — why the category is the authorization unit, why the business rules travel with the data, and what the first delivery leaves out.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
