---
description: "Package map for the private-knowledge capability family: the knowledge service seam that a Team Runner asks for company knowledge its member may reach."
kind: "package-group"
---

# knowledge/ — private knowledge capability family

English | [中文](README.zh.md)

## Summary

The `knowledge/` group gives the harness private company knowledge — an authorized directory and passage search over it — through one provider-neutral service (`ctx.knowledge`). It exists because company knowledge is governed: which knowledge bases a member may search is a role decision an administrator makes, it can change between one question and the next, and the credential that reaches the knowledge source must not sit in a member's process. The seam therefore names product operations only, and in Team Edition a Runner-side provider forwards each one to a Control Plane that authorizes it against the current account, device, and grants. This group owns the vocabulary: the `KnowledgeRef` that names a knowledge base across renames, the `knowledge/scope` Session event that records which knowledge a Session may use, and the closed failure set. It owns no upstream client, no storage, and no model-facing tool.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Five packages play the knowledge roles; the subsystem reference owns the exhaustive vocabulary and contracts.

| Package | Role | ctx key |
|---|---|---|
| [`knowledge/`](knowledge/README.md) | Knowledge service: the authorized directory, passage search, the stable reference, and the Session scope | `ctx.knowledge` |
| [`knowledge-source/`](knowledge-source/README.md) | Upstream source seam: listing a source and searching an already-authorized set of its knowledge bases | `ctx.knowledgeSource` |
| [`knowledge-weknora/`](knowledge-weknora/README.md) | Speaks WeKnora's two fixed endpoints, holding the credential in the Control Plane | registers on `ctx.knowledgeSource` |
| [`knowledge-gateway/`](knowledge-gateway/README.md) | Governed gateway seam: the durable catalog, and the authorized directory and search | `ctx.knowledgeGateway` |
| [`knowledge-gateway-sqlite/`](knowledge-gateway-sqlite/README.md) | Durable catalog over SQLite, with synchronization, per-resource authorization, and audit | registers on `ctx.knowledgeGateway` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then the proposal that explains why the seam is shaped this way.

- [Knowledge subsystem](../../docs/subsystems/knowledge.md) — the directory, search, Session scope, stable references, and the closed failure taxonomy.
- [Team private knowledge Agent Note](../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md) — why private knowledge stays behind the Control Plane, and what the first delivery leaves out.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
