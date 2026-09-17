---
description: "The Runner-side BI-analysis provider: an outbound Control Plane request carrying the current device token, and no BI address or credential."
kind: "package-reference"
---

# @deepseek-ai/dsh-bi-team

English | [中文](README.zh.md)

## Summary

`dsh-bi-team` provides `ctx.bi` on a Team Runner by reaching the company Control Plane. What it sends is a governed reference, a keyword, or a row bound, and nothing more; what it does not send — and could not, because the protocol has no place for it — is a BI address, a credential, an upstream project or chart id, a filter, or a query of its own. The decision about who may run what is made on the other side, on every call. Mount it in the `team` profile beside the account client whose token it reads.

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

Mount it after `dsh-team-account-client`, which owns the device credential this provider reads.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-bi-team'
  config:
    controlPlaneUrl: https://dsh.company.com
    controlPlaneCa: /opt/company/control-plane-ca.crt
```

| Field | Default | Meaning |
|---|---|---|
| `controlPlaneUrl` | — | Origin of the company Control Plane |
| `controlPlaneCa` | — | PEM file holding the only certificates accepted for it |

`controlPlaneCa` names a PEM file, and is how a Runner reaches a Control Plane whose certificate no public authority signed. Its certificates replace the public authorities for Control Plane connections only, so the deployment's own certificate is pinned rather than added to what this Runner trusts everywhere. Absent, the Control Plane is verified like any other host. A file that cannot be read throws at load, because a Runner that quietly fell back to public trust would report a misconfigured deployment as an ordinary TLS failure much later.

`controlPlaneUrl` has no default and the row fails to load without it. A Runner that guessed which company it belongs to would ask a stranger which charts its member may run. The desktop installer's generated profile patch writes it here and into every other row that needs it, from one deployment fact.

### The token is read per call

The account client refreshes the device access token, so a cached one would be the stale copy. That is the same reason no BI credential comes here at all: the only thing this process holds is a short-lived proof of who is signed in.

### Failures

Every failure is a `BiError`. A refusal the Control Plane names is passed through unchanged, so a member sees "ask an administrator" rather than "try later" when that is the truth. Everything else — DNS, TLS, a proxy that ate the request, a Control Plane that is down, an answer this build cannot read — becomes `control-plane-unreachable`, because from a member's seat those are one fact and none of them is separately actionable.

A reason word this build does not know is treated as unreachable rather than passed on. A Control Plane speaking reasons this Runner cannot act on is one it cannot act on, and inventing a meaning would send a member after the wrong fix.

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

Every field of an answer is validated at the wire before it becomes a BI value. The Control Plane is trusted to decide, not to be well formed: a truncated response, a reverse-proxy error page, and a newer Control Plane's richer answer all reach this code, and only the last should still work. A chart kind this build does not know reads as `other` and a total it cannot read as unknown, never as zero, because the kind is a hint and the total is a promise about where the list ends.

### Source map

| File | Holds |
|---|---|
| [`src/index.ts`](src/index.ts) | The provider: the three calls, the wire validation, and the failure mapping |

<a id="further-exploration"></a>
## Further Exploration

- [BI subsystem](../../../docs/subsystems/bi.md) — the vocabulary this provider speaks.
- [Team BI analysis Agent Note](../../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md) — why the credential never reaches a Runner.

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-bi`, which renders chart listings and rows to the model and owns the scope prompt section. This provider contributes no prompt and registers no schema.

#### KV Cache effect

No direct invalidation; the named consumer owns the request-prefix change a project choice causes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is incomplete on its own. They are current package constraints.

- **No offline cache** — a Runner that cannot reach the Control Plane has no BI at all, deliberately: a cached row set would be one served without a current authorization decision.
- **No deadline of its own** — a caller's signal is forwarded and the Control Plane owns the operation's bound. A Runner whose Control Plane accepts a connection and never answers waits on the caller's own timeout.
- **No retry** — one attempt per call. Whether a transient failure is worth retrying belongs to the caller that knows what the member is waiting for.
- **No keyless snapshot lane** — the Team profile has no recorded-session snapshot tier, so the provider's evidence is its request-recording unit test rather than a replayed Session.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### The call shape is shared with the knowledge provider

The constructor, the per-call token read, and the request-and-decode stretch are the same mechanics `dsh-knowledge-team` carries, written here against three BI routes rather than the knowledge ones. The clone detector reports the shared stretches. Extracting one Control Plane call helper the two providers parameterize is the follow-up; it touches the knowledge provider and its tests, which is why it did not ride the change that added this package.

</details>

**Runtime invariant:** No companion is published: the provider holds nothing between calls and publishes no event stream; that no BI credential or address exists in this process to leak is an absence, which the package's tests assert by inspecting the requests it actually sends.
