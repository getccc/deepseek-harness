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

One package plays the BI role today; the subsystem reference owns the exhaustive vocabulary and contracts, and the Agent Note names the packages the rest of the capability adds.

| Package | Role | ctx key |
|---|---|---|
| [`bi/`](bi/README.md) | BI service: the authorized project directory, saved-chart listing, chart run, the stable references, and the Session scope | `ctx.bi` |

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
