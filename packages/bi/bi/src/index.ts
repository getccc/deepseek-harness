/**
 * The BI seam: one service a Runner asks for the BI projects its signed-in
 * member may analyze, for the saved charts in one of them, and for the rows
 * one of those charts produces.
 *
 * The seam is deliberately small, a directory, a chart listing, and a chart
 * run, because every operation it names has to be one the Control Plane can
 * authorize against a current account, a current device, and current grants.
 * There is no operation for naming an address, passing a credential, running
 * a query of the caller's own, or changing a chart, so a Runner holding this
 * service still cannot reach a BI source except through a decision made
 * elsewhere.
 * @module @deepseek-ai/dsh-bi
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { BiChartPage, BiChartsRequest, BiProjectEntry, BiQueryRequest, BiQueryResult } from './types.ts'

export {
  BI_CHART_ID_MAX_LENGTH,
  BI_REF_MAX_LENGTH,
  BI_REF_SEGMENT,
  BI_SOURCE_CODE_MAX_LENGTH,
  BiChartRef,
  BiProjectRef,
  InvalidBiRefError,
  formatBiChartRef,
  formatBiProjectRef,
  isBiChartRef,
  isBiProjectRef,
  parseBiChartRef,
  parseBiProjectRef,
  projectRefOf,
  upstreamChartIdOf,
  type BiChartRefParts,
  type BiProjectRefParts,
} from './brand.ts'
export {
  DEFAULT_BI_SCOPE,
  foldBiScope,
  parseBiScope,
  projectOf,
} from './scope.ts'
export { BiError } from './error.ts'
export {
  type BiCell,
  type BiChartKind,
  type BiChartPage,
  type BiChartSummary,
  type BiChartsRequest,
  type BiFailureReason,
  type BiField,
  type BiProjectEntry,
  type BiQueryRequest,
  type BiQueryResult,
  type BiScope,
  type BiScopeMode,
  type BiScopeProject,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    bi: Bi
  }
}

/**
 * BI analysis, as a Runner sees it. A provider mounts this service; consumers
 * inject `bi`.
 *
 * Every method fails with {@link BiError} carrying a closed reason. None
 * returns a partial answer: a directory that could not be authorized, a
 * listing on a refused project, and a run on a chart outside its project all
 * raise, because a quietly narrowed result is indistinguishable from a
 * correct one to the model that reads it.
 */
export abstract class Bi extends Service {
  constructor(ctx: Context) {
    super(ctx, 'bi')
  }

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
}
