# GMO Supply-Chain Analysis

English | [中文](gmo.zh.md)

The GMO supply-chain analysis seam — a [capability seam](../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md) spanning **four operations** (category directory, result listing, result description, and question) on one `ctx.gmo` service. The Service Definition is [dsh-gmo](../../packages/gmo/gmo); its Team provider is [dsh-gmo-team](../../packages/gmo/gmo-team) and the model-facing tools are [dsh-tool-gmo](../../packages/gmo/tool-gmo), both designed in the [Control Plane GMO capability](../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md). GMO analysis is **one optional capability**, not part of the agent-loop spine, so its vocabulary lives here rather than in [core.md](core.md).

The seam names product operations, never upstream ones. A Runner holding `ctx.gmo` cannot name an address, a token, a statement of its own, or an upstream category or result id, because no operation has a place for one. That is what lets a governed deployment put every GMO decision — which member, which device, which category, right now — behind a service the member's own process cannot bypass.

Source: [`packages/gmo/gmo/src/types.ts`](../../packages/gmo/gmo/src/types.ts)

## Naming a category

A `GmoCategoryRef` is `<providerKind>:<sourceCode>:<upstreamId>` — for example `exceltools:gmo:gb`. It is the category's identity across upstream renames, and the only category identifier that leaves a Control Plane. A category is a business line of the source, such as GB / GL allocation; the upstream key inside the reference is meaningful only to the provider that minted it.

Three bounds hold, and all three fail where a reference is built rather than where one is used:

| Bound | Value | Why |
|---|---|---|
| Reference length | 64 characters | The audit store's `resource_id` carries `AUDIT_TOKEN`; a longer reference is one no operation could record |
| Segment alphabet | letters, digits, `. _ @ -` | The audit token alphabet without `:`, which separates the segments, and without `/`, which separates a result from its category |
| Source code length | 19 characters | The bound private knowledge and BI derived, kept equal so one deployment source code serves every catalog |

`formatGmoCategoryRef` throws `InvalidGmoRefError` naming which bound failed. `parseGmoCategoryRef` answers `undefined` instead, because its callers — a wire decoder, a log reader, a stored-row validator — are deciding whether to accept a value rather than diagnosing one.

Source: [`packages/gmo/gmo/src/brand.ts`](../../packages/gmo/gmo/src/brand.ts)

## Naming a result

A `GmoResultRef` is a category reference, a `/`, and the upstream result id — `exceltools:gmo:gb/09032da5…`. It is a separate brand rather than a longer `GmoCategoryRef` because the two are bounded by different things: a category reference has to fit the audit token, and a result is never an audit resource. What an operation on a result records is the category it belongs to, which is also what a grant names and what an administrator enables.

A step of a multi-step result is its own result: the source's `<id>~<stage>` is spelled `<id>.<stage>` in the reference, because `~` is outside the alphabet and only a provider translates it. `categoryRefOf` and `upstreamResultIdOf` take a proved reference apart without a second parse.

## The Session GMO scope

Which category a Session analyzes is recorded in the Session log as `gmo/scope`, a versioned whole-value replace where the last event wins:

```ts
import { GmoCategoryRef, type GmoScope } from '@deepseek-ai/dsh-gmo'

const ref = GmoCategoryRef('exceltools:gmo:gb')

export const off: GmoScope = { version: 1, mode: 'off' }
export const selected: GmoScope = {
  version: 1,
  mode: 'selected',
  category: { ref, displayName: 'GB / GL 分配' },
}
```

A log with no such event folds to `off`, so every Session starts with GMO analysis unavailable and stays there until a member chooses. `foldGmoScope(events, end?)` performs that fold; the optional `end` folds a prefix, which is how rewind and fork read what the log said at a point. `categoryOf` answers the recorded category, or `undefined` for `off`.

Scope is model-visible input twice over — it decides the prompt section that names the chosen category, and whether the GMO tools are offered at all — so it lives in the log and nowhere else. The `selected` arm records a display name beside the reference because a model may only be told names the log holds; a category renamed afterwards does not change what an already-recorded Session's prompt says. The scope names one category or none, with no arm meaning every category, and it only ever narrows current authorization.

Source: [`packages/gmo/gmo/src/scope.ts`](../../packages/gmo/gmo/src/scope.ts)

## Directory, results, description, and questions

`catalog()` answers the categories the current principal may analyze right now — reference and display name. It is a permission-shaped view, not a listing of what exists: a category the principal holds nothing on, or one an administrator has not enabled, is absent rather than marked.

`results()` answers one page of one category's processing results, newest first, each a `GmoResultSummary` carrying its governed reference, name, tool, period, row count, creation time, and the steps of a multi-step result.

`describe()` answers what a reader needs to ask good questions of one result: each column's key, type, filter kind, and the business meaning its owner wrote; the dashboard's measure, date columns, and dimensions; the source's current date; and the category's written business rules in Markdown. The meaning travels with the data so a new category needs no Runner release.

`ask()` answers one question from a closed vocabulary, `GmoQuery`:

| Kind | Asks |
|---|---|
| `aggregate` | A sum of a numeric column, a row count, or a distinct count, over up to two group columns, with a date grain, an order, a limit, and filters |
| `overview` | One of the source's ready-made dashboards: totals and week buckets, a timeline, a ranking, a flow, a heat map, demand structure, data quality, or a supply-demand view |
| `rows` | A page of detail rows, filtered and sorted |

The vocabulary is read by `readGmoQuery`, `readGmoFilters`, and `readGmoCount`, which a Runner's tools and the Control Plane both apply: a key the vocabulary does not define is refused rather than ignored. The columns and values in a question are validated by the source against the result's own columns, so nothing here can name a column the result does not have. An answer is the source's own bounded JSON beside the references it answers for; the figures are the source's to compute.

No operation returns a partial answer. A directory that could not be authorized, a listing on a refused category, and a question about a misplaced result all raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

## Failures

Every failure is a `GmoError` carrying one reason from a closed set, so a Runner, a tool result, and a UI all distinguish "sign in again" from "ask an administrator" from "try later" without parsing a message.

| Reason | Means |
|---|---|
| `unauthenticated` | No valid device token, an inactive member, or a revoked device |
| `not-allowed` | No grant admits the operation, or the named category is unknown, disabled, or not yet enabled |
| `scope-unavailable` | The conversation's category is no longer in the principal's authorized directory |
| `result-unavailable` | The source holds no such result, or it no longer belongs to the conversation's category |
| `unsupported` | The result exists and has no such view, such as demand structure on an allocation result |
| `invalid-query` | The source refused a column, a filter, or a value |
| `upstream-unavailable` | The GMO service did not answer in time or at all, or refused the token |
| `upstream-invalid` | The GMO service answered something this build cannot read |
| `too-large` | The answer exceeded the source's size bound; a narrower question fits |
| `control-plane-unreachable` | The Control Plane could not be reached from this computer |
| `update-required` | The Control Plane refuses this operation's protocol version; operations it does serve keep working |
| `cancelled` | The caller aborted the operation |

`not-allowed` deliberately covers an unknown reference as well as an unauthorized one, so a refusal never confirms that a category exists to a principal holding nothing on it. No upstream response body reaches any of these: the reason is the whole diagnosis a product surface receives.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxgmo--gmo-abstract-seam"></a>

### `ctx.gmo` — `Gmo` (abstract seam)

GMO supply-chain analysis, as a Runner sees it. A provider mounts this service; consumers inject `gmo`.

Every method fails with GmoError carrying a closed reason. None returns a partial answer: a directory that could not be authorized, a listing on a refused category, and a question about a result outside its category all raise, because a quietly narrowed result is indistinguishable from a correct one to the model that reads it.

```ts cordis-catalog
/**
 * The categories the current principal may analyze right now.
 * @param signal - aborts the operation.
 * @returns the authorized directory, empty when the principal holds nothing.
 * @throws {GmoError} when the principal cannot be established or the directory cannot be read.
 */
abstract catalog(signal?: AbortSignal): Promise<readonly GmoCategoryEntry[]>

/**
 * One page of the processing results in one authorized category, newest first.
 *
 * The category is authorized on this call, like every other operation: a
 * reference that was in the directory a moment ago is not standing
 * permission to list it now.
 * @param request - the category and which page.
 * @returns the page, empty when the category holds no result.
 * @throws {GmoError} when the category is refused or the upstream does not answer usably.
 */
abstract results(request: GmoResultsRequest): Promise<GmoResultPage>

/**
 * Describe one result: its columns with their business meaning, its
 * dashboard dimensions, the upstream's current date, and the category's
 * written business rules.
 *
 * The result's category is resolved from the source and authorized on this
 * call, so holding a reference proves nothing.
 * @param request - the result to describe.
 * @returns the description.
 * @throws {GmoError} when the category is refused, the result is unknown or
 * misplaced (`result-unavailable`), or the upstream does not answer usably.
 */
abstract describe(request: GmoDescribeRequest): Promise<GmoDescription>

/**
 * Ask one question of one result: a free-form aggregation, one of the
 * ready-made dashboards, or a page of detail rows.
 *
 * The result's category is resolved from the source and authorized on this
 * call, and a result the source places in another category is refused
 * before any figure is read.
 * @param request - the result and the question.
 * @returns the upstream's bounded answer.
 * @throws {GmoError} when the category is refused, the result is unknown or
 * misplaced (`result-unavailable`), the result has no such view
 * (`unsupported`), the source refuses the question (`invalid-query`), the
 * answer is too large (`too-large`), or the upstream does not answer usably.
 */
abstract ask(request: GmoAskRequest): Promise<GmoAnswer>
```

Source: [`packages/gmo/gmo/src/index.ts`](../../packages/gmo/gmo/src/index.ts)

<a id="ctxgmogateway--gmogateway-abstract-seam"></a>

### `ctx.gmoGateway` — `GmoGateway` (abstract seam)

The governed catalog and the decision in front of it. A provider mounts this service; consumers inject `gmoGateway`.

Administration methods take an organization because an administrator has already been authorized by the route that called them. Member-facing methods take a principal because they authorize it themselves, per category, on every call.

```ts cordis-catalog
/**
 * Reconcile the durable catalog against one successful full listing.
 *
 * Serialized: concurrent callers join the operation already in flight rather
 * than racing two reconciliations over the same rows. A source that does not
 * answer leaves the last successful snapshot in place and records the
 * failure, because one failed listing must not disable every category an
 * organization governs. A category the source newly lists starts disabled:
 * a role granted every category must not gain a business line the moment the
 * source starts serving it.
 * @param orgId - the organization whose catalog is reconciled.
 * @returns the catalog as it stands after the attempt, successful or not.
 */
abstract sync(orgId: OrgId): Promise<GmoCatalogView>

/**
 * Read the durable catalog without contacting the source.
 * @param orgId - the organization to read.
 * @returns every governed entry and the source's health.
 */
abstract catalogView(orgId: OrgId): Promise<GmoCatalogView>

/**
 * Switch one entry on or off for the whole organization.
 *
 * Synchronization never overrides this choice: an administrator who enabled
 * or disabled a category finds it still so after the next listing.
 * @param orgId - the organization the entry belongs to.
 * @param ref - the entry to change.
 * @param enabled - whether it may be analyzed at all.
 * @throws {GmoError} `not-allowed` when the catalog holds no such entry.
 */
abstract setEnabled(orgId: OrgId, ref: GmoCategoryRef, enabled: boolean): Promise<void>

/**
 * The categories this principal may analyze right now.
 * @param principal - who is asking, from a verified token.
 * @returns the authorized directory, empty when the principal holds nothing.
 */
abstract directory(principal: GmoPrincipal): Promise<readonly GmoCategoryEntry[]>

/**
 * Authorize one result listing and perform it.
 *
 * The category is evaluated on this call, as every other operation's is. A
 * member who may ask a category's results may see which results are in it:
 * the decision is the same permission, asked separately so it can be
 * tightened without a new authorization path.
 * @param request - who is asking, which category, and which page.
 * @returns the page, with results addressed by governed references.
 * @throws {GmoError} with the reason the operation was refused or failed.
 */
abstract results(request: GovernedResultsRequest): Promise<GmoResultPage>

/**
 * Authorize one description and perform it.
 *
 * Two things are proved before anything is read: the category the reference
 * names admits this principal now, and the source agrees that the result
 * belongs to that category. The second is what makes an unsigned reference
 * safe: a reference whose halves disagree is refused, and possession of one
 * is never authority.
 * @param request - who is asking and which result.
 * @returns the description, with references in place of upstream ids.
 * @throws {GmoError} with the reason the operation was refused or failed.
 */
abstract describe(request: GovernedDescribeRequest): Promise<GmoDescription>

/**
 * Authorize one question and perform it, on the same two proofs as
 * {@link describe}, and refuse an answer the source attributes to a
 * different category than the one authorized.
 * @param request - who is asking, which result, and the question.
 * @returns the source's bounded answer.
 * @throws {GmoError} with the reason the operation was refused or failed.
 */
abstract ask(request: GovernedAskRequest): Promise<GmoAnswer>
```

Types: [OrgId](account.md)

Source: [`packages/gmo/gmo-gateway/src/index.ts`](../../packages/gmo/gmo-gateway/src/index.ts)

<a id="ctxgmosource--gmosource-abstract-seam"></a>

### `ctx.gmoSource` — `GmoSource` (abstract seam)

One upstream GMO service. A provider mounts this service; the governed gateway injects `gmoSource`.

Failures are raised as `GmoError` with `upstream-unavailable`, `upstream-invalid`, `result-unavailable`, `unsupported`, `invalid-query`, or `too-large`. A provider never raises an authorization reason: it does not know who is asking, which is the point.

```ts cordis-catalog
/**
 * Every category the configured source holds that has at least one tool.
 * @param signal - aborts the operation.
 * @returns every category, in whatever order the source lists them.
 * @throws {GmoError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listCategories(signal?: AbortSignal): Promise<readonly UpstreamCategory[]>

/**
 * One page of an already-authorized category's results, newest first.
 * @param request - the authorized upstream id and the page.
 * @returns the page, empty when the category holds no result.
 * @throws {GmoError} `upstream-unavailable` or `upstream-invalid`.
 */
abstract listResults(request: UpstreamResultsRequest): Promise<UpstreamResultListing>

/**
 * Where one result sits, cheaply and without reading any figure, so the
 * gateway can authorize the category that holds it before asking anything.
 * @param upstreamResultId - the source's own result id.
 * @param signal - aborts the operation.
 * @returns the category it belongs to.
 * @throws {GmoError} `upstream-unavailable`, `upstream-invalid`, or
 * `result-unavailable` when the source holds no such result.
 */
abstract placeResult(upstreamResultId: string, signal?: AbortSignal): Promise<UpstreamPlacement>

/**
 * Describe one already-authorized result.
 * @param upstreamResultId - the source's own result id.
 * @param signal - aborts the operation.
 * @returns the description, with the category the source says holds it.
 * @throws {GmoError} `upstream-unavailable`, `upstream-invalid`,
 * `result-unavailable`, or `too-large`.
 */
abstract describeResult(upstreamResultId: string, signal?: AbortSignal): Promise<UpstreamDescription>

/**
 * Ask one already-authorized result one question.
 * @param request - the category, the result, and the question.
 * @returns the bounded answer and the category the source says answered.
 * @throws {GmoError} `upstream-unavailable`, `upstream-invalid`,
 * `result-unavailable`, `unsupported` when the result has no such view,
 * `invalid-query` when the source refuses a column, filter, or value, or
 * `too-large` when the answer exceeds the source's size bound.
 */
abstract ask(request: UpstreamAskRequest): Promise<UpstreamAnswer>
```

Source: [`packages/gmo/gmo-source/src/index.ts`](../../packages/gmo/gmo-source/src/index.ts)
<!-- END GENERATED cordis-surface -->
