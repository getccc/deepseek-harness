---
description: "Package map for the BI-analysis capability family: the BI service seam that a Team Runner asks for the saved charts its member may analyze."
kind: "package-group"
---

# bi/ — BI analysis capability family

English | [中文](README.zh.md)

## Summary

The `bi/` group gives the harness the company's BI system through one provider-neutral service (`ctx.bi`). Saved charts are governed: which projects a member may analyze is a role decision an administrator makes, it can change between questions, and the credential that reaches the BI source must not sit in a member's process. The seam therefore names product operations only; in Team Edition a Runner-side provider forwards each one to a Control Plane that authorizes it. The group owns the vocabulary — `BiProjectRef`, `BiChartRef`, the `bi/scope` Session event, the closed failure set — and no client, storage, or tool.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Eight packages play the BI roles; the subsystem reference owns the exhaustive vocabulary and contracts, and the Agent Note names the browser packages the rest of the capability adds.

| Package | Role | ctx key |
|---|---|---|
| [`bi/`](bi/README.md) | BI service: the authorized project directory, saved-chart listing, chart run, the stable references, and the Session scope | `ctx.bi` |
| [`bi-source/`](bi-source/README.md) | Upstream source seam: listing a source's projects and one project's charts, placing a chart, and running one already-authorized chart | `ctx.biSource` |
| [`bi-webi/`](bi-webi/README.md) | Speaks webi's four fixed routes, holding the personal access token in the Control Plane | registers on `ctx.biSource` |
| [`bi-gateway/`](bi-gateway/README.md) | Governed gateway seam: the durable project catalog, and the authorized directory, chart listing, and chart run | `ctx.biGateway` |
| [`bi-gateway-sqlite/`](bi-gateway-sqlite/README.md) | Durable catalog over SQLite, with synchronization, per-project authorization, and audit | registers on `ctx.biGateway` |
| [`bi-gateway-http/`](bi-gateway-http/README.md) | The three routes a Runner calls, with token verification and protocol-version negotiation | registers routes on `ctx.webServer` |
| [`bi-team/`](bi-team/README.md) | Runner-side provider: one Control Plane request per directory read, chart listing, or chart run, carrying the device token | registers on `ctx.bi` |
| [`tool-bi/`](tool-bi/README.md) | What a model sees: the two tools, the scope prompt section, and scope-driven visibility | registers on `ctx.tools` and `ctx.systemPrompt` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the proposal that explains why the seam is shaped this way.

- [BI subsystem](../../docs/subsystems/bi.md) — the directory, chart listing, chart run, Session scope, stable references, and the closed failure taxonomy.
- [Team BI analysis Agent Note](../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — why BI stays behind the Control Plane, and what the first delivery leaves out.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
