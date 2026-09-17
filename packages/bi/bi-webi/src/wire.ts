/**
 * The webi HTTP contract this provider speaks: the routes it calls, the
 * envelopes it decodes, and the fields it reads.
 *
 * webi is a Lightdash-derived server, and these are Lightdash routes at the
 * version the deployment runs: the v1 organization and saved-chart routes, and
 * the v2 content listing and asynchronous query routes. Every route accepts
 * the personal access token as `Authorization: ApiKey <token>`.
 * @module @deepseek-ai/dsh-bi-webi/wire
 */

/** Lists every project the token's organization holds. */
export const PROJECTS_PATH = '/api/v1/org/projects'

/**
 * One page of the saved charts in one project, newest first.
 *
 * The content listing takes no keyword, so the provider reads one page as
 * wide as its own bound and leaves narrowing to the gateway.
 * @param projectUuid - the project to list.
 * @param pageSize - how many charts to ask for.
 * @returns the path to GET, query included.
 */
export function contentPath(projectUuid: string, pageSize: number): string {
  const query = new URLSearchParams({
    projectUuids: projectUuid,
    contentTypes: 'chart',
    page: '1',
    pageSize: String(pageSize),
  })
  return `/api/v2/content?${query.toString()}`
}

/**
 * One saved chart's own record, which is what says which project holds it.
 * @param chartUuid - the source's chart id.
 * @returns the path to GET.
 */
export function savedChartPath(chartUuid: string): string {
  return `/api/v1/saved/${encodeURIComponent(chartUuid)}`
}

/**
 * Start one asynchronous run of a saved chart, as it was saved.
 * @param projectUuid - the project the chart sits in.
 * @returns the path to POST to.
 */
export function chartQueryPath(projectUuid: string): string {
  return `/api/v2/projects/${encodeURIComponent(projectUuid)}/query/chart`
}

/**
 * One page of a run's results, or the run's state while it is not ready.
 * @param projectUuid - the project the chart sits in.
 * @param queryUuid - the run the source started.
 * @param pageSize - how many rows to ask for.
 * @returns the path to GET, query included.
 */
export function queryResultsPath(projectUuid: string, queryUuid: string, pageSize: number): string {
  const query = new URLSearchParams({ page: '1', pageSize: String(pageSize) })
  return `/api/v2/projects/${encodeURIComponent(projectUuid)}/query/${encodeURIComponent(queryUuid)}?${query.toString()}`
}

/**
 * Stop a run nobody is waiting for any more.
 * @param projectUuid - the project the chart sits in.
 * @param queryUuid - the run to cancel.
 * @returns the path to POST to.
 */
export function queryCancelPath(projectUuid: string, queryUuid: string): string {
  return `/api/v2/projects/${encodeURIComponent(projectUuid)}/query/${encodeURIComponent(queryUuid)}/cancel`
}

/** The header webi authenticates with. */
export const AUTHORIZATION_HEADER = 'Authorization'

/** The scheme that header carries a personal access token under. */
export const API_KEY_SCHEME = 'ApiKey'

/**
 * One project as `GET /org/projects` returns it.
 *
 * The deployment answers each project with its `warehouseConnection`, a
 * record whose `type` names the warehouse and whose other fields name its
 * host, user, and database; only `type` is read. `warehouseType` is the
 * flat form the organization's project summary uses.
 */
export interface WireProject {
  readonly projectUuid: string
  readonly name: string
  readonly type?: unknown
  readonly description?: unknown
  readonly warehouseType?: unknown
  readonly warehouseConnection?: unknown
}

/** One chart as the content listing returns it. */
export interface WireChartContent {
  readonly uuid: string
  readonly name: string
  readonly description?: unknown
  readonly chartKind?: unknown
  readonly space?: unknown
  readonly lastUpdatedAt?: unknown
  readonly createdAt?: unknown
}

/**
 * One saved chart as `GET /saved/{uuid}` returns it.
 *
 * `chartConfig.type` is the picture's family and, for a cartesian chart, the
 * series and layout inside `chartConfig.config` decide the kind; the listing
 * answers a ready-made `chartKind` instead, which is why the record is read
 * through {@link chartKindOf} and the listing is not.
 */
export interface WireSavedChart {
  readonly uuid: string
  readonly projectUuid: string
  readonly name: string
  readonly description?: unknown
  readonly spaceName?: unknown
  readonly chartConfig?: unknown
  readonly updatedAt?: unknown
}

/** What starting a run answers: the run's id, and the query it will execute. */
export interface WireExecuteResults {
  readonly queryUuid: string
  readonly metricQuery?: unknown
  readonly fields?: unknown
}

/** One results page, or the state of a run that has none yet. */
export interface WireResultsPage {
  readonly status: string
  readonly rows?: unknown
  readonly fields?: unknown
  readonly totalResults?: unknown
}

/**
 * Read a successful envelope's `results`.
 *
 * Every route answers `{ status: 'ok', results }`. A body that is not that is
 * `upstream-invalid` rather than an empty result, because a reader cannot
 * tell a source with nothing from a source it failed to understand.
 * @param body - the decoded JSON body.
 * @returns the results value, or undefined when the envelope is not a success envelope.
 */
export function okResults(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (record['status'] !== 'ok') return undefined
  return record['results']
}

/**
 * Read a failure envelope's HTTP status.
 *
 * webi answers failures as `{ status: 'error', error: { statusCode, name,
 * message } }`. Only `statusCode` is read; `name` and `message` are upstream
 * prose and never leave this module.
 * @param body - the decoded JSON body.
 * @returns the status the envelope carries, or undefined when it carries none.
 */
export function errorStatus(body: unknown): number | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as Record<string, unknown>)['error']
  if (typeof error !== 'object' || error === null) return undefined
  const status = (error as Record<string, unknown>)['statusCode']
  return typeof status === 'number' ? status : undefined
}
