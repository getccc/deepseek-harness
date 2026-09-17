# BI Analysis

English | [中文](bi.zh.md)

The BI-analysis seam — a [capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) spanning **three operations** (project directory, chart listing, and chart run) on one `ctx.bi` service. The Service Definition is [dsh-bi](../../packages/bi/bi); its Team providers and the model-facing tools arrive with the [Control Plane BI capability](../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md). BI is **one optional capability**, not part of the agent-loop spine, so its vocabulary lives here rather than in [core.md](core.md).

The seam names product operations, never upstream ones. A Runner holding `ctx.bi` cannot name an address, a credential, a query of its own, or an upstream project or chart id, because no operation has a place for one. That is what lets a governed deployment put every BI decision — which member, which device, which project, right now — behind a service the member's own process cannot bypass.

Source: [`packages/bi/bi/src/types.ts`](../../packages/bi/bi/src/types.ts)

## Naming a project

A `BiProjectRef` is `<providerKind>:<sourceCode>:<upstreamId>` — for example `webi:prod:55d61de1-ed86-4ad4-b96e-205114de5245`. It is the project's identity across upstream renames, and the only project identifier that leaves a Control Plane. The upstream id inside it is meaningful only to the provider that minted it; nothing outside the Control Plane can turn a reference back into an upstream address.

Three bounds hold, and all three fail where a reference is built rather than where one is used:

| Bound | Value | Why |
|---|---|---|
| Reference length | 64 characters | The audit store's `resource_id` carries `AUDIT_TOKEN`; a longer reference is one no operation could record |
| Segment alphabet | letters, digits, `. _ @ -` | The audit token alphabet without `:`, which separates the segments, and without `/`, which separates a chart from its project |
| Source code length | 19 characters | The bound private knowledge derived, kept equal so one deployment source code serves both catalogs |

`formatBiProjectRef` throws `InvalidBiRefError` naming which bound failed. `parseBiProjectRef` answers `undefined` instead, because its callers — a wire decoder, a log reader, a stored-row validator — are deciding whether to accept a value rather than diagnosing one.

Source: [`packages/bi/bi/src/brand.ts`](../../packages/bi/bi/src/brand.ts)

## Naming a chart

A `BiChartRef` is a project reference, a `/`, and the upstream chart id — `webi:prod:55d61de1-…/aa064703-…`. It is a separate brand rather than a longer `BiProjectRef` because the two are bounded by different things: a project reference has to fit the audit token, and a chart is never an audit resource. What an operation on a chart records is the project it belongs to, which is also what a grant names and what an administrator disables.

The chart id is bounded at 64 characters over the same alphabet. `formatBiChartRef` throws `InvalidBiRefError`; `parseBiChartRef` answers `undefined`, for the same reason its project counterpart does. `projectRefOf` and `upstreamChartIdOf` take a proved reference apart without a second parse.

## The Session BI scope

Which project a Session analyzes is recorded in the Session log as `bi/scope`, a versioned whole-value replace where the last event wins:

```ts
import { BiProjectRef, type BiScope } from '@deepseek-ai/dsh-bi'

const ref = BiProjectRef('webi:prod:55d61de1-ed86-4ad4-b96e-205114de5245')

export const off: BiScope = { version: 1, mode: 'off' }
export const selected: BiScope = {
  version: 1,
  mode: 'selected',
  project: { ref, displayName: 'Demo YH' },
}
```

A log with no such event folds to `off`, so every Session starts with BI unavailable and stays there until a member chooses. `foldBiScope(events, end?)` performs that fold; the optional `end` folds a prefix, which is how rewind and fork read what the log said at a point. `projectOf` answers the recorded project, or `undefined` for `off`.

Scope is model-visible input twice over — it decides the prompt section that names the chosen project, and whether the BI tools are offered at all — so it lives in the log and nowhere else. That is also why the `selected` arm records a display name beside the reference: a model may only be told names the log holds. The name is a snapshot of the moment of choice, so a project renamed afterwards does not change what an already-recorded Session's prompt says, while the composer control resolves the current name from the authorized directory.

The scope names one project or none. There is no arm meaning "every project", because charts in different projects answer unrelated questions and one conversation analyzes one project; a conversation that needs another changes its scope.

Scope only ever narrows current authorization. It never adds a project, and a stale or forged reference still reaches an authorization decision that cannot be widened from a Session log.

Source: [`packages/bi/bi/src/scope.ts`](../../packages/bi/bi/src/scope.ts)

## Directory, charts, and run

`catalog()` answers the projects the current principal may analyze right now — reference and display name. It is a permission-shaped view, not a listing of what exists: a project the principal holds nothing on is absent rather than marked.

`charts()` answers one page of one project's saved charts, each a `BiChartSummary` carrying its governed reference, name, space, description, kind, and last update. An optional keyword keeps only charts whose name, space, or description holds it. The page reports the source's `total` only when the source gives one; absent means "the source did not say" and must not be read as zero.

`query()` runs one saved chart as it was saved and answers a `BiQueryResult`: the chart's fields in row order, its saved filters as one line of text, the rows as raw cells, the row count the source reported, and whether rows or cells were cut. The request carries a row bound and nothing else — no filter, parameter, sort, or SQL of the caller's own reaches a warehouse. The chart's project is resolved from the source and authorized on every call, so a chart reference from another project is refused before any row is read.

No operation returns a partial answer. A directory that could not be authorized, a listing on a refused project, and a run on a misplaced chart all raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

## Failures

Every failure is a `BiError` carrying one reason from a closed set, so a Runner, a tool result, and a UI all distinguish "sign in again" from "ask an administrator" from "try later" without parsing a message.

| Reason | Means |
|---|---|
| `unauthenticated` | No valid device token, an inactive member, or a revoked device |
| `not-allowed` | No grant admits the operation, or the named project is unknown or disabled |
| `scope-unavailable` | The conversation's project is no longer in the principal's authorized directory |
| `chart-unavailable` | The source holds no such chart, or it no longer belongs to the conversation's project |
| `query-failed` | The source ran the chart and the warehouse refused or failed |
| `upstream-unavailable` | The BI service did not answer in time or at all, or refused the credential |
| `upstream-invalid` | The BI service answered something this build cannot read |
| `control-plane-unreachable` | The Control Plane could not be reached from this computer |
| `update-required` | The Control Plane refuses this operation's protocol version; operations it does serve keep working |
| `cancelled` | The caller aborted the operation |

`not-allowed` deliberately covers an unknown reference as well as an unauthorized one, so a refusal never confirms that a project exists to a principal holding nothing on it. No upstream response body reaches any of these: the reason is the whole diagnosis a product surface receives.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbi--bi-abstract-seam"></a>

### `ctx.bi` — `Bi` (abstract seam)

BI analysis, as a Runner sees it. A provider mounts this service; consumers inject `bi`.

Every method fails with BiError carrying a closed reason. None returns a partial answer: a directory that could not be authorized, a listing on a refused project, and a run on a chart outside its project all raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

```ts cordis-catalog
/**
 * The projects the current principal may analyze right now.
 * @param signal - aborts the operation.
 * @returns the authorized directory, empty when the principal holds nothing.
 * @throws {BiError} when the principal cannot be established or the directory cannot be read.
 */
abstract catalog(signal?: AbortSignal): Promise<readonly BiProjectEntry[]>

/**
 * One page of the saved charts in one authorized project.
 *
 * The project is authorized on this call, like every other operation: a
 * reference that was in the directory a moment ago is not standing
 * permission to list it now.
 * @param request - the project, an optional keyword, and which page.
 * @returns the page, empty when the project holds no matching chart.
 * @throws {BiError} when the project is refused or the upstream does not answer usably.
 */
abstract charts(request: BiChartsRequest): Promise<BiChartPage>

/**
 * Run one saved chart as it was saved and answer its rows.
 *
 * The chart's project is resolved from the source and authorized on this
 * call, and a chart the source places in another project is refused before
 * any row is read: holding a reference proves nothing.
 * @param request - the chart, and the most rows the caller wants.
 * @returns the chart's definition summary, its fields, and its bounded rows.
 * @throws {BiError} when the project is refused, the chart is unknown or
 * misplaced (`chart-unavailable`), the warehouse fails (`query-failed`), or the
 * upstream does not answer usably.
 */
abstract query(request: BiQueryRequest): Promise<BiQueryResult>
```

Source: [`packages/bi/bi/src/index.ts`](../../packages/bi/bi/src/index.ts)
<!-- END GENERATED cordis-surface -->
