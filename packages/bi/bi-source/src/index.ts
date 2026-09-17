/**
 * The upstream BI-source seam: what a Control Plane provider offers the
 * governed gateway in front of it.
 *
 * This is the only place an upstream BI product is spoken to, and it is
 * mounted in the Control Plane alone. Every operation is one the gateway can
 * authorize: enumerate the projects a source holds, list one project's saved
 * charts, place one chart in its project, and run one saved chart as it was
 * saved. There is no operation that takes a URL, a caller-chosen header, a
 * filter, a parameter, or a query of the caller's own, so the gateway cannot
 * be talked into an operation the permission catalog does not govern.
 *
 * Everything here is in upstream terms, upstream ids rather than
 * `BiProjectRef`s, because mapping between the two is the catalog's job, and
 * a provider that knew about governed resources would be authorizing.
 * @module @deepseek-ai/dsh-bi-source
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { BiCell, BiChartKind, BiField } from '@deepseek-ai/dsh-bi'

declare module '@deepseek-ai/cordis' {
  interface Context {
    biSource: BiSource
  }
}

/** One project as its upstream source describes it. */
export interface UpstreamProject {
  /** The source's own identifier, meaningful only to this provider. */
  readonly upstreamId: string
  readonly name: string
  /** The source's own word for what kind of project it is, empty when it supplies none. */
  readonly projectType: string
  /** The source's own word for the warehouse behind it, empty when it supplies none. */
  readonly warehouseType: string
}

/** What the gateway asks a source for one project's saved charts. */
export interface UpstreamChartsRequest {
  /** The project to list, already authorized. */
  readonly upstreamId: string
  readonly signal?: AbortSignal
}

/** One saved chart as its upstream source describes it. */
export interface UpstreamChart {
  /**
   * The source's own chart identifier, meaningful only to this provider.
   *
   * A provider returns only ids the governed reference grammar accepts,
   * within `BI_CHART_ID_MAX_LENGTH` and over the reference alphabet, and
   * refuses a row with anything else as `upstream-invalid`. That is what lets
   * the gateway mint a reference from one without a second guard: a chart it
   * could not address is one no later operation could name.
   */
  readonly upstreamChartId: string
  readonly name: string
  /** The space the chart sits in, empty when the source names none. */
  readonly spaceName: string
  /** The author's description, empty when the source supplies none. */
  readonly description: string
  readonly kind: BiChartKind
  /** Epoch milliseconds, or undefined when the source supplies no timestamp. */
  readonly updatedAt: number | undefined
}

/**
 * Every saved chart of one project, as far as the provider's own bound reaches.
 *
 * A whole listing rather than a page, because the keyword a member narrows by
 * is applied by the gateway over names the source does not index: the source
 * answers what it holds, and the gateway pages what matched.
 */
export interface UpstreamChartListing {
  readonly charts: readonly UpstreamChart[]
  /** Whether the source holds more charts than the provider's bound let it read. */
  readonly truncated: boolean
}

/** What the gateway asks a source about where one chart sits. */
export interface UpstreamChartPlacement {
  /** The project the source says holds it. */
  readonly upstreamId: string
  /** The chart itself, as a listing would describe it. */
  readonly chart: UpstreamChart
}

/** What the gateway asks a source to run. */
export interface UpstreamRunRequest {
  /** The project the chart sits in, already authorized and already agreed by the source. */
  readonly upstreamId: string
  /** The saved chart to run, as it was saved. */
  readonly upstreamChartId: string
  /** The most rows to return, before the provider's own maximum applies. */
  readonly limit: number
  readonly signal?: AbortSignal
}

/** What one run answers, in the terms the gateway forwards unchanged. */
export interface UpstreamRun {
  /** The columns, in the order each row's cells follow. */
  readonly fields: readonly BiField[]
  /** The chart's saved filters as one line of text, empty when it has none. */
  readonly filters: string
  /** The rows, each holding one cell per field in {@link fields} order. */
  readonly rows: readonly (readonly BiCell[])[]
  /** How many rows the source reported in total, or undefined when it did not say. */
  readonly rowCount: number | undefined
  /** Whether rows were dropped to reach the requested or the provider's row bound. */
  readonly truncated: boolean
  /** Whether any text cell was cut to the provider's per-cell character bound. */
  readonly cellsTruncated: boolean
}

/**
 * One upstream BI product. A provider mounts this service; the governed
 * gateway injects `biSource`.
 *
 * Failures are raised as `BiError` with `upstream-unavailable`,
 * `upstream-invalid`, `chart-unavailable`, or `query-failed`. A provider never
 * raises an authorization reason: it does not know who is asking, which is
 * the point.
 */
export abstract class BiSource extends Service {
  constructor(ctx: Context) {
    super(ctx, 'biSource')
  }

  /**
   * Which upstream product this is, as the first segment of a `BiProjectRef`.
   *
   * A constant of the provider rather than configuration: it names the code
   * that speaks the protocol, and a deployment renaming it would change the
   * identity of every project already governed.
   */
  abstract readonly providerKind: string

  /**
   * The deployment's code for this source, as the second `BiProjectRef`
   * segment. Configuration, because one company's `prod` is another's `bi`.
   */
  abstract readonly sourceCode: string

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
}
