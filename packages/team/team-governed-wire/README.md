---
description: "The wire the governed knowledge, BI, and GMO endpoints share between a Team Runner and the Control Plane: request opening and refusal envelopes on one end, the device-token call and refusal decoding on the other."
kind: "package-library"
---

# @deepseek-ai/dsh-team-governed-wire

English | [中文](README.zh.md)

## Summary

`dsh-team-governed-wire` lets a governed capability serve and call its Runner endpoints without re-implementing the wire. On the Control Plane it checks the method, the body bound, the protocol version, and the device token, in that order, and answers a closed refusal word with its HTTP status. On the Runner it posts the version and fields with the current token and turns every answer into a capability error. A capability keeps its paths, versions, reasons, and fields.

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

### When to use it

Use the Control Plane end in a `*-gateway-http` plugin and the Runner end in the matching `*-team` provider. `dsh-knowledge-gateway-http`, `dsh-bi-gateway-http`, and `dsh-gmo-gateway-http` import the first; `dsh-knowledge-team`, `dsh-bi-team`, and `dsh-gmo-team` import the second. An endpoint with another envelope, such as model traffic, does not use it.

### Entry point

The Control Plane end wraps each route; the function decodes the body and returns the operation, or `undefined` when the body is malformed:

```text
const serve = (parse: ParseRoute) => governedHandler({ protocol, limit, verify, reasonOf }, parse)
const results = { kind: 'exact', path, handler: serve(opened => ref === undefined ? undefined : () => gateway.results({ ...opened.principal, ref })) }
```

The Runner end binds the capability once and calls it per operation:

```text
const call = governedClient({ fail, reasons, fetch, baseUrl, account })
const body = await call(PATH, PROTOCOL_VERSION, { ref }, signal) // throws the capability's error
```

`COMMON_REFUSAL_STATUS` holds the refusal words every capability shares with their statuses. A capability adds its own words to a copy of it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The two ends live in one package so the facts they must agree on have one owner: the `authorization` bearer header, the version range check that runs before any other field is decoded, the `{ error, reason }` refusal envelope, and the `update-required` body that tells a Runner to update.

Opening a request refuses in a fixed order. A method other than POST answers 405. A body over the bound, not JSON, or not an object answers 400. A version outside the range answers 426 before the token is looked at, because an out-of-date Runner cannot fix itself by signing in again. An unknown, lapsed, or revoked token answers one 401. Decoding runs outside the failure handling, so a field this build cannot read is a 400 and never an authorization outcome. A failure the capability names answers its reason and status; any other failure answers 500 with no reason word.

On the Runner, a fetch that fails, an answer that is not a JSON object, and a refusal word this build does not know all become `control-plane-unreachable`: a member cannot act on those differently. A token that cannot be read becomes `unauthenticated`.

| File | Holds |
|---|---|
| [`src/server.ts`](src/server.ts) | Request opening, the route handler, and refusal answers |
| [`src/client.ts`](src/client.ts) | The bound Runner call and refusal decoding |
| [`src/protocol.ts`](src/protocol.ts) | The header and the shared refusal table |
| [`src/types.ts`](src/types.ts) | The protocol, options, and handler types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [`dsh-gmo-gateway-http`](../../gmo/gmo-gateway-http/README.md) — the routes of one capability on this wire.
- [`dsh-gmo-team`](../../gmo/gmo-team/README.md) — its Runner provider.
- [`dsh-team-account-client`](../team-account-client/README.md) — the fetch and the access token the Runner end uses.

<a id="model-experience"></a>
## Model Experience

None, as the package transports closed words, references, and a version over HTTP and registers no prompt, schema, or result text; the Runner-side tools own everything the model sees.

#### KV Cache effect

No request prefix changes here; a refusal word reaches the model only through a Runner-side tool result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is incomplete on its own. They are current package constraints.

- **One protocol version range per capability** — the Control Plane end checks a single minimum and current version; the knowledge capability sends a version per operation and relies on the range.
- **Model and release traffic keep their own envelopes** — `dsh-web-search-gateway-http`, `dsh-model-gateway-http`, and `dsh-team-release-http` repeat parts of the request opening and are not migrated.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published: the package holds no state, and the order of the refusals is driven by the tests of this package and of each capability over a real HTTP server.
