---
description: "The Runner's team account: the device key it keeps, the credential it holds, and the calls it makes to the Control Plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-account-client

English | [中文](README.zh.md)

## Summary

`dsh-team-account-client` is what a member's computer holds of its team account. It generates the device key pair on first use and keeps the private half here; it stores the credential the Control Plane issues; and it makes the three calls that binding and refreshing need. No company provider credential ever arrives on this computer — what it holds is a refresh token for its own device and a short-lived access token.

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

```yaml
plugins:
  '@deepseek-ai/dsh-team-account-client':
    controlPlaneUrl: https://dsh.company.com
    callbackUri: http://127.0.0.1:3080/team/callback
    runnerVersion: 2.4.1
    refreshLeadMs: 60000
```

Binding is two steps with a person in between: `begin()` opens a transaction and returns what the local pairing page shows, and `complete()` runs only after the member confirmed on the Control Plane and the browser came back with a code. `accessToken()` serves the stored token, refreshing first when it is close enough to lapsing to lose its own race.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The PKCE verifier lives only in this process

It is written nowhere. A transaction therefore cannot be completed by anything that reads this computer's disk without also being this Runner, and a Runner restarted mid-binding starts the flow again rather than pretending it can finish one it cannot prove it began.

### Both records go through the credential provider

The device key and the credential are stored as credential records rather than in a file this package writes, so whatever protection a deployment gives credentials covers them too, and a person has one place to inspect and clear. Both writes use the provider's read-decide-replace, so two Runners racing at first start end with one key rather than two identities.

### Signing out keeps the computer

It forgets the credential and keeps the device key, the workspaces, and the sessions. The computer is still the same computer; it just stops holding a team account, and binding again reuses its key.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The service: begin, complete, state, accessToken, signOut |
| [`src/storage.ts`](src/storage.ts) | Where the device key and the credential live |
| [`src/types.ts`](src/types.ts) | What the Runner keeps, types only |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [Team-handoff subsystem](../../../docs/subsystems/team-handoff.md) — the whole flow, both sides.
- [`team-local-handoff`](../team-local-handoff/README.md) — the local addresses that drive this client.
- [`device-authorization`](../../account/device-authorization/README.md) — what the Control Plane does with what this sends.

<a id="model-experience"></a>
## Model Experience

None, as account custody is Runner-side infrastructure and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One binding in flight per process** — the verifier for the pending transaction is a single value, so opening a second pairing page abandons the first.
- **No policy control channel** — this client obtains credentials; being told that a device was revoked, rather than discovering it at the next refresh, arrives with the control channel.
- **A plugin in this process can read the device key** — short lifetimes and revocation reduce the window; they do not isolate it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The tests run against a real Control Plane composition rather than a stubbed one. The calls this client makes are only correct if the other side accepts them, and the signatures it produces are only correct if a key it generated itself verifies against a digest the Control Plane stored.

</details>
