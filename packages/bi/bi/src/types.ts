/**
 * The BI vocabulary every provider and consumer shares: the authorized project
 * directory, one project's saved charts, one chart run and its rows, the
 * Session scope, and the closed set of ways an operation ends badly.
 *
 * Nothing here names an upstream service, an address, or a credential. A
 * Runner-side consumer builds a request out of these types alone, which is
 * what makes the Control Plane the only party that can reach a BI source.
 * @module @deepseek-ai/dsh-bi/types
 */

import type { BiChartRef, BiProjectRef } from './brand.ts'

/** One project a principal may analyze, as the directory presents it. */
export interface BiProjectEntry {
  readonly ref: BiProjectRef
  /** The upstream display name, refreshed on each directory read. */
  readonly displayName: string
}

/**
 * What kind of picture a saved chart draws, as the source classifies it.
 *
 * The source's own words, closed so a tool schema can enumerate them and a
 * model can pick a matching series. A kind this build does not know reads as
 * `other`, which promises nothing about the picture.
 */
export type BiChartKind =
  | 'line'
  | 'horizontal_bar'
  | 'vertical_bar'
  | 'scatter'
  | 'bubble'
  | 'waterfall'
  | 'area'
  | 'mixed'
  | 'pie'
  | 'table'
  | 'big_number'
  | 'funnel'
  | 'map'
  | 'sankey'
  | 'radar'
  | 'gauge'
  | 'gantt'
  | 'custom'
  | 'other'

/** One saved chart in a project, as the chart listing presents it. */
export interface BiChartSummary {
  readonly chartRef: BiChartRef
  /** The project it belongs to, which is what authorized listing it. */
  readonly ref: BiProjectRef
  /** The chart's name, as its author saved it. */
  readonly name: string
  /** The space the chart sits in, empty when the source names none. */
  readonly spaceName: string
  /** The author's description, empty when the source supplies none. */
  readonly description: string
  readonly kind: BiChartKind
  /** Epoch milliseconds the source last changed it, or undefined when it supplies no timestamp. */
  readonly updatedAt: number | undefined
}

/** What a consumer asks for one page of a project's saved charts. */
export interface BiChartsRequest {
  /** The project to list; authorized on every call. */
  readonly ref: BiProjectRef
  /**
   * Keep only charts whose name, space, or description holds this text,
   * compared without regard to case. Absent lists every chart.
   */
  readonly query?: string
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many charts one page holds; the provider's own maximum still applies. */
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

/** One page of a project's saved charts. */
export interface BiChartPage {
  /** The project listed, echoed so a page reads without its request. */
  readonly ref: BiProjectRef
  readonly charts: readonly BiChartSummary[]
  /** The page returned, counting from one. */
  readonly page: number
  /** The page size actually applied, after the provider's bounds. */
  readonly pageSize: number
  /**
   * How many charts matched in total, or undefined when the source does not
   * say. Absent rather than guessed: a total inferred from one page would
   * tell a reader the list ends where it does not.
   */
  readonly total: number | undefined
}

/** What one column of a chart run holds, as the chart defined it. */
export interface BiField {
  /** The source's own field id, which is also the column's position key. */
  readonly id: string
  /** The label the chart shows for it, falling back to the id when the source supplies none. */
  readonly label: string
  /** Whether the chart groups by it or aggregates it. */
  readonly role: 'dimension' | 'metric'
  /** The source's own word for the value type, such as `number` or `date`; empty when it supplies none. */
  readonly type: string
}

/**
 * One value in one row of a chart run.
 *
 * The raw value rather than the source's formatted text, because a model
 * charts and compares numbers and a formatted string would have to be parsed
 * back. `null` is a value the source held no data for.
 */
export type BiCell = string | number | boolean | null

/** What a consumer asks the BI service to run. */
export interface BiQueryRequest {
  /** The saved chart to run, as it was saved; authorized through its project on every call. */
  readonly chartRef: BiChartRef
  /** At most this many rows; the provider's own maximum still applies. */
  readonly limit?: number
  /** Aborts the operation, including the upstream query it started. */
  readonly signal?: AbortSignal
}

/** What one chart run answers. */
export interface BiQueryResult {
  /** The chart run, echoed so a transcript reads without its request. */
  readonly chartRef: BiChartRef
  /** The project it belongs to, named for a reader. */
  readonly ref: BiProjectRef
  readonly name: string
  readonly kind: BiChartKind
  /** The author's description, empty when the source supplies none. */
  readonly description: string
  /** The columns, in the order each row's cells follow. */
  readonly fields: readonly BiField[]
  /**
   * The chart's saved filters as one line of text, empty when it has none.
   * What a reader needs to know which subset the rows describe.
   */
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
 * The project named in a Session scope, with the display name recorded
 * beside it.
 *
 * The name travels with the reference because the scope reaches the model as
 * prompt text, and a model-visible name has to be reconstructable from the
 * Session log. A name recorded here is a snapshot of the moment of choice: a
 * project renamed afterwards does not change what an already-recorded
 * Session's prompt says.
 */
export interface BiScopeProject {
  readonly ref: BiProjectRef
  readonly displayName: string
}

/**
 * Which BI project the current Session analyzes.
 *
 * `off` is the state a Session starts in and the only one a log without a
 * scope event folds to. Scope narrows authorization and never widens it: a
 * `selected` project is still authorized on every operation, and there is no
 * arm meaning "every project", because one conversation analyzes one.
 */
export type BiScope =
  | { readonly version: 1; readonly mode: 'off' }
  | { readonly version: 1; readonly mode: 'selected'; readonly project: BiScopeProject }

/** Every mode a {@link BiScope} can carry. */
export type BiScopeMode = BiScope['mode']

/**
 * Every way a BI operation ends badly.
 *
 * The set is closed so a Runner, a tool result, and a UI all distinguish
 * "sign in again" from "ask an administrator" from "try later" without
 * parsing a message. `not-allowed` deliberately covers an unknown project as
 * well as an unauthorized one, so a refusal never confirms that a project
 * exists to a principal holding nothing on it.
 */
export type BiFailureReason =
  /** No valid device token, an inactive member, or a revoked device. */
  | 'unauthenticated'
  /** No grant admits the operation, or the named project is unknown or disabled. */
  | 'not-allowed'
  /** The conversation's project is no longer in the principal's authorized directory. */
  | 'scope-unavailable'
  /** The source holds no such chart, or it no longer belongs to the conversation's project. */
  | 'chart-unavailable'
  /** The source ran the chart and the warehouse refused or failed. */
  | 'query-failed'
  /** The upstream BI service did not answer in time or at all, or refused the credential. */
  | 'upstream-unavailable'
  /** The upstream BI service answered something this build cannot read. */
  | 'upstream-invalid'
  /** The Control Plane could not be reached from this computer. */
  | 'control-plane-unreachable'
  /** This Runner speaks a BI protocol version the Control Plane refuses. */
  | 'update-required'
  /** The caller aborted the operation. */
  | 'cancelled'
