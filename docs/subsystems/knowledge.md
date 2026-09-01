# Private Knowledge

English | [中文](knowledge.zh.md)

The private-knowledge seam — a [capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) spanning **two operations** (directory and search) on one `ctx.knowledge` service. The Service Definition is [dsh-knowledge](../../packages/knowledge/knowledge); its Team providers and the model-facing tool arrive with the [Control Plane knowledge capability](../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.md). Knowledge is **one optional capability**, not part of the agent-loop spine, so its vocabulary lives here rather than in [core.md](core.md).

The seam names product operations, never upstream ones. A Runner holding `ctx.knowledge` cannot name an address, a tenant, a credential, or an upstream document id, because no operation has a place for one. That is what lets a governed deployment put every knowledge decision — which member, which device, which knowledge bases, right now — behind a service the member's own process cannot bypass.

Source: [`packages/knowledge/knowledge/src/types.ts`](../../packages/knowledge/knowledge/src/types.ts)

## Naming a knowledge base

A `KnowledgeRef` is `<providerKind>:<sourceCode>:<upstreamId>` — for example `weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266`. It is the knowledge base's identity across upstream renames, and the only knowledge identifier that leaves a Control Plane. The upstream id inside it is meaningful only to the provider that minted it; nothing outside the Control Plane can turn a reference back into an upstream address.

Three bounds hold, and all three fail where a reference is built rather than where one is used:

| Bound | Value | Why |
|---|---|---|
| Reference length | 64 characters | The audit store's `resource_id` carries `AUDIT_TOKEN`; a longer reference is one no operation could record |
| Segment alphabet | letters, digits, `. _ @ -` | The audit token alphabet without `:`, which separates the segments |
| Source code length | 19 characters | What `weknora`, two separators, and a 36-character UUID leave inside the reference maximum |

`formatKnowledgeRef` throws `InvalidKnowledgeRefError` naming which bound failed. `parseKnowledgeRef` answers `undefined` instead, because its callers — a wire decoder, a log reader, a stored-row validator — are deciding whether to accept a value rather than diagnosing one.

Source: [`packages/knowledge/knowledge/src/brand.ts`](../../packages/knowledge/knowledge/src/brand.ts)

## The Session knowledge scope

Which private knowledge a Session may search is recorded in the Session log as `knowledge/scope`, a versioned whole-value replace where the last event wins:

```ts
import { KnowledgeRef, type KnowledgeScope } from '@deepseek-ai/dsh-knowledge'

export const off: KnowledgeScope = { version: 1, mode: 'off' }
export const all: KnowledgeScope = { version: 1, mode: 'all' }
export const selected: KnowledgeScope = {
  version: 1,
  mode: 'selected',
  bases: [{ ref: KnowledgeRef('weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'), displayName: '临港知识库' }],
}
```

A log with no such event folds to `off`, so every Session starts with knowledge unavailable and stays there until a member chooses. `foldKnowledgeScope(events, end?)` performs that fold; the optional `end` folds a prefix, which is how rewind and fork read what the log said at a point.

Scope is model-visible input twice over — it decides the prompt section that names the chosen knowledge bases, and whether the search tool is offered at all — so it lives in the log and nowhere else. That is also why the `selected` arm records a display name beside each reference: a model may only be told names the log holds. The names are a snapshot of the moment of choice, so an administrator who renames a knowledge base afterwards does not change what an already-recorded Session's prompt says, while the picker and the input chip resolve current names from the authorized directory.

`all` records no names, because the set it denotes is whatever the principal is authorized for at each call and cannot be snapshotted honestly.

Scope only ever narrows current authorization. It never adds a knowledge base, and a stale or forged reference still reaches an authorization decision that cannot be widened from a Session log.

Source: [`packages/knowledge/knowledge/src/scope.ts`](../../packages/knowledge/knowledge/src/scope.ts)

## Directory and search

`catalog()` answers the knowledge bases the current principal may search right now — reference, display name, description, and kind. It is a permission-shaped view, not a listing of what exists: a knowledge base the principal holds nothing on is absent rather than marked.

`search()` takes the query, the scope resolved from the Session, and the caller's bounds. `KnowledgeScopeSelection` keeps `all` as a mode rather than an expanded list, because expanding it is an authorization act only the Control Plane can perform; a Runner that expanded it would be asserting authorization it cannot compute.

Neither operation returns a partial answer. A directory that could not be authorized and a search whose scope was refused both raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

## Failures

Every failure is a `KnowledgeError` carrying one reason from a closed set, so a Runner, a tool result, and a UI all distinguish "sign in again" from "ask an administrator" from "try later" without parsing a message.

| Reason | Means |
|---|---|
| `unauthenticated` | No valid device token, an inactive member, or a revoked device |
| `not-allowed` | No grant admits the operation, or a named resource is unknown or disabled |
| `scope-unavailable` | A selected reference is no longer in the principal's authorized directory |
| `scope-incompatible` | Selected knowledge bases cannot be searched together by the upstream |
| `upstream-unavailable` | The knowledge service did not answer in time or at all |
| `upstream-invalid` | The knowledge service answered something this build cannot read |
| `control-plane-unreachable` | The Control Plane could not be reached from this computer |
| `update-required` | This Runner speaks a knowledge protocol version the Control Plane refuses |
| `cancelled` | The caller aborted the operation |

`not-allowed` deliberately covers an unknown reference as well as an unauthorized one, so a refusal never confirms that a knowledge base exists to a principal holding nothing on it. No upstream response body reaches any of these: the reason is the whole diagnosis a product surface receives.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxknowledge--knowledge-abstract-seam"></a>

### `ctx.knowledge` — `Knowledge` (abstract seam)

Private knowledge, as a Runner sees it. A provider mounts this service; consumers inject `knowledge`.

Both methods fail with KnowledgeError carrying a closed reason. Neither returns a partial answer: a directory that could not be authorized and a search whose scope was refused both raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

```ts cordis-catalog
/**
 * The knowledge bases the current principal may search right now.
 * @param signal - aborts the operation.
 * @returns the authorized directory, empty when the principal holds nothing.
 * @throws {KnowledgeError} when the principal cannot be established or the directory cannot be read.
 */
abstract catalog(signal?: AbortSignal): Promise<readonly KnowledgeBaseEntry[]>

/**
 * Search the knowledge bases one operation names.
 * @param request - the query, the scope resolved from the Session, and the caller's bounds.
 * @returns the passages, with the knowledge bases actually searched.
 * @throws {KnowledgeError} when any named knowledge base is refused, the scope
 * cannot be searched together, or the upstream does not answer usably.
 */
abstract search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>
```

Source: [`packages/knowledge/knowledge/src/index.ts`](../../packages/knowledge/knowledge/src/index.ts)
<!-- END GENERATED cordis-surface -->
