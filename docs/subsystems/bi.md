# BI Analysis

English | [中文](bi.zh.md)

The BI-analysis seam — a [capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) spanning **three operations** (project directory, chart listing, and chart run) on one `ctx.bi` service. The Service Definition is [dsh-bi](../../packages/bi/bi); its Team provider is [dsh-bi-team](../../packages/bi/bi-team) and the model-facing tools are [dsh-tool-bi](../../packages/bi/tool-bi), both designed in the [Control Plane BI capability](../../.agents/notes/proposed/feature/2026-09-17-team-bi-analysis-through-the-control-plane.md). BI is **one optional capability**, not part of the agent-loop spine, so its vocabulary lives here rather than in [core.md](core.md).

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

<a id="ctxbigateway--bigateway-abstract-seam"></a>

### `ctx.biGateway` — `BiGateway` (abstract seam)

The governed catalog and the decision in front of it. A provider mounts this service; consumers inject `biGateway`.

Administration methods take an organization because an administrator has already been authorized by the route that called them. Member-facing methods take a principal because they authorize it themselves, per project, on every call.

```ts cordis-catalog
/**
 * Reconcile the durable catalog against one successful full listing.
 *
 * Serialized: concurrent callers join the operation already in flight rather
 * than racing two reconciliations over the same rows. A source that does not
 * answer leaves the last successful snapshot in place and records the
 * failure, because one failed listing must not disable every project an
 * organization governs.
 * @param orgId - the organization whose catalog is reconciled.
 * @returns the catalog as it stands after the attempt, successful or not.
 */
abstract sync(orgId: OrgId): Promise<BiCatalogView>

/**
 * Read the durable catalog without contacting the source.
 * @param orgId - the organization to read.
 * @returns every governed entry and the source's health.
 */
abstract catalogView(orgId: OrgId): Promise<BiCatalogView>

/**
 * Switch one entry on or off for the whole organization.
 *
 * Synchronization never overrides this choice: an administrator who disabled
 * a project finds it still disabled after the next listing.
 * @param orgId - the organization the entry belongs to.
 * @param ref - the entry to change.
 * @param enabled - whether it may be analyzed at all.
 * @throws {BiError} `not-allowed` when the catalog holds no such entry.
 */
abstract setEnabled(orgId: OrgId, ref: BiProjectRef, enabled: boolean): Promise<void>

/**
 * The projects this principal may analyze right now.
 * @param principal - who is asking, from a verified token.
 * @returns the authorized directory, empty when the principal holds nothing.
 */
abstract directory(principal: BiPrincipal): Promise<readonly BiProjectEntry[]>

/**
 * Authorize one chart listing and perform it.
 *
 * The project is evaluated on this call, as a run's is. A member who may
 * run a project's charts may see which charts are in it: the decision is
 * the same permission, asked separately so it can be tightened without a
 * new authorization path.
 * @param request - who is asking, which project, a keyword, and which page.
 * @returns the page, with the charts addressed by governed references.
 * @throws {BiError} with the reason the operation was refused or failed.
 */
abstract charts(request: GovernedChartsRequest): Promise<BiChartPage>

/**
 * Authorize one chart run and perform it.
 *
 * Two things are proved before any row is read: the project the reference
 * names admits this principal now, and the source agrees that the chart
 * belongs to that project. The second is what makes an unsigned reference
 * safe: a reference whose halves disagree is refused, and possession of one
 * is never authority.
 * @param request - who is asking, which chart, and the caller's row bound.
 * @returns the chart's definition summary, its fields, and its bounded rows.
 * @throws {BiError} with the reason the operation was refused or failed.
 */
abstract query(request: GovernedQueryRequest): Promise<BiQueryResult>
```

Types: [OrgId](account.md)

Source: [`packages/bi/bi-gateway/src/index.ts`](../../packages/bi/bi-gateway/src/index.ts)

<a id="ctxbisource--bisource-abstract-seam"></a>

### `ctx.biSource` — `BiSource` (abstract seam)

One upstream BI product. A provider mounts this service; the governed gateway injects `biSource`.

Failures are raised as `BiError` with `upstream-unavailable`, `upstream-invalid`, `chart-unavailable`, or `query-failed`. A provider never raises an authorization reason: it does not know who is asking, which is the point.

```ts cordis-catalog
/**
 * Every project the configured source holds.
 * @param signal - aborts the operation.
 * @returns every project, in whatever order the source lists them.
 * @throws {BiError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listProjects(signal?: AbortSignal): Promise<readonly UpstreamProject[]>

/**
 * The saved charts of one already-authorized project.
 * @param request - the authorized upstream id.
 * @returns the listing, empty when the project holds no chart.
 * @throws {BiError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listCharts(request: UpstreamChartsRequest): Promise<UpstreamChartListing>

/**
 * Where one chart sits, so the gateway can authorize the project that holds
 * it before running anything in it.
 * @param upstreamChartId - the source's own chart id.
 * @param signal - aborts the operation.
 * @returns the project it belongs to, and the chart.
 * @throws {BiError} `upstream-unavailable`, `upstream-invalid`, or
 * `chart-unavailable` when the source holds no such chart.
 */
abstract describeChart(upstreamChartId: string, signal?: AbortSignal): Promise<UpstreamChartPlacement>

/**
 * Run one already-authorized saved chart as it was saved.
 * @param request - the project, the chart, and the caller's row bound.
 * @returns the fields, the saved filters, and the bounded rows.
 * @throws {BiError} `upstream-unavailable`, `upstream-invalid`,
 * `chart-unavailable` when the source no longer holds the chart, or
 * `query-failed` when the source ran it and the warehouse refused or failed.
 */
abstract runChart(request: UpstreamRunRequest): Promise<UpstreamRun>
```

Source: [`packages/bi/bi-source/src/index.ts`](../../packages/bi/bi-source/src/index.ts)
<!-- END GENERATED cordis-surface -->
