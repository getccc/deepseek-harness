---
description: "The Team Runner GMO provider (ctx.gmo): the authorized category directory, result listing, description, and questions over the company Control Plane, carrying the current device token and nothing else."
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo-team

English | [中文](README.zh.md)

## Summary

`dsh-gmo-team` is the Runner-side provider for `ctx.gmo`: one Control Plane request per directory read, result listing, description, or question, carrying the current device access token and a governed reference. What it sends is a reference, a page, or a question from the closed vocabulary. What it does not send, and could not, because the protocol has no place for it, is an excel-tools address, a token, an upstream id, or a statement of its own.

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

Mount it in a Team Runner beside the account client; `dsh-tool-gmo` and the composer control build on it.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-gmo-team'
  config:
    controlPlaneUrl: https://dsh.company.com
```

| Field | Default | Meaning |
|---|---|---|
| `controlPlaneUrl` | none, required | Origin of the company Control Plane |
| `controlPlaneCa` | none | Path to a PEM file whose certificates are the only ones accepted for the Control Plane |

### Tokens

The access token is read per call from the account client rather than held, because the client refreshes it. A computer that is not signed in fails with `unauthenticated` before anything is sent.

### Failures

A refusal's reason word is decoded against the closed set; a word this build does not know reads as `control-plane-unreachable`, because inventing a meaning would tell a member to do something that may not help. A DNS failure, a TLS failure, a proxy that ate the request, a body that is not JSON, and a Control Plane that is down are the same fact to a member and read the same way.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The provider validates what comes back at the wire: references must parse, fields must have their types, rows of an answer pass through as the Control Plane forwarded them. A reply this build cannot read is `upstream-invalid` rather than a partial answer, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The provider, its config, and the readers of the Control Plane's answers |
| [`dsh-team-governed-wire`](../../team/team-governed-wire/README.md) | The opening sequence, the route handler, the shared refusal statuses, and the Runner call |

<a id="further-exploration"></a>
## Further Exploration

- [GMO subsystem](../../../docs/subsystems/gmo.md) — the vocabulary the answers are read into.
- [Team GMO supply-chain analysis Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) — why the Runner holds no excel-tools address or token.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-gmo`, which renders result listings, descriptions, and answers to the model and owns the scope prompt section. This provider contributes no prompt and registers no schema.

#### KV Cache effect

No direct invalidation; the named consumer owns the request-prefix change a category choice causes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **One request per operation** — there is no batching and no cache, so a conversation that asks ten questions makes ten Control Plane calls.
- **No retry** — a failed call is reported as the closed reason and the model or the member decides whether to ask again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the provider owns no registry and emits no events; what leaves the computer is asserted field by field in the package's tests, which run against a recording HTTP server.
