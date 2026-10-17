/**
 * The GMO supply-chain vocabulary every provider and consumer shares: the
 * authorized category directory, one category's results, a result's
 * description, the questions a member may ask of a result and their answers,
 * the Session scope, and the closed set of ways an operation ends badly.
 *
 * Nothing here names an upstream service, an address, or a credential. A
 * Runner-side consumer builds a request out of these types alone, which is
 * what makes the Control Plane the only party that can reach the GMO source.
 * @module @deepseek-ai/dsh-gmo/types
 */

import type { GmoCategoryRef, GmoResultRef } from './brand.ts'

/** One JSON value; what an upstream answer carries beyond the fields this vocabulary names. */
export type GmoJson = string | number | boolean | null | GmoJson[] | { [key: string]: GmoJson }

/** One category a principal may analyze, as the directory presents it. */
export interface GmoCategoryEntry {
  readonly ref: GmoCategoryRef
  /** The upstream display name, refreshed on each directory read. */
  readonly displayName: string
}

/** One step of a multi-step result, addressable as a result of its own. */
export interface GmoStage {
  /** The upstream's own word for the step, such as `total`, `net-gap`, or `allocation`. */
  readonly key: string
  /** The step's name for a reader, such as `3.净缺口`. */
  readonly label: string
  /** The reference that selects exactly this step's rows. */
  readonly resultRef: GmoResultRef
}

/** One processing result in a category, as the result listing presents it. */
export interface GmoResultSummary {
  readonly resultRef: GmoResultRef
  /** The category it belongs to, which is what authorized listing it. */
  readonly ref: GmoCategoryRef
  /** The result's name, as the upstream saved it. */
  readonly name: string
  /** The tool that produced it, for a reader. */
  readonly toolName: string
  /** The data period it covers, such as `2026-W42`. */
  readonly period: string
  /** How many detail rows it holds. */
  readonly rows: number
  /** When it was produced, as the upstream reports local time to the minute. */
  readonly createdAt: string
  /** The steps of a multi-step result, empty for a single-step one. */
  readonly stages: readonly GmoStage[]
}

/** What a consumer asks for one page of a category's results. */
export interface GmoResultsRequest {
  /** The category to list; authorized on every call. */
  readonly ref: GmoCategoryRef
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many results one page holds; the provider's own maximum still applies. */
  readonly pageSize?: number
  readonly signal?: AbortSignal
}

/** One page of a category's results, newest first. */
export interface GmoResultPage {
  /** The category listed, echoed so a page reads without its request. */
  readonly ref: GmoCategoryRef
  readonly results: readonly GmoResultSummary[]
  /** The page returned, counting from one. */
  readonly page: number
  /** The page size actually applied, after the provider's bounds. */
  readonly pageSize: number
  /** How many results the category holds in total. */
  readonly total: number
}

/** One column of a result, with the business meaning the upstream wrote for it. */
export interface GmoField {
  /** The column key a question names. */
  readonly key: string
  readonly label: string
  /** `string`, `number`, or `date`. */
  readonly type: string
  /** How the column filters: `multi`, `search`, `range`, or empty when it does not. */
  readonly filter: string
  /** What the column means in the business, empty when the upstream wrote none. */
  readonly description: string
}

/** The dashboard dimensions a result supports. */
export interface GmoDashboard {
  /** The numeric column an overview sums by default. */
  readonly measure: string
  /** The measure's name for a reader, such as `剩余缺口`. */
  readonly measureLabel: string
  /** The date columns, the first being the default. */
  readonly dateFields: readonly { readonly key: string; readonly label: string }[]
  /** Every dimension an overview can group by, key to name. */
  readonly dims: Readonly<Record<string, string>>
  readonly stackDims: readonly string[]
  readonly rankDims: readonly string[]
  readonly heatDims: readonly string[]
  readonly flow: readonly string[]
  /** The dimension a timeline row splits by, empty when it does not split. */
  readonly subDim: string
  /** Whether supply-demand balance views exist for the result. */
  readonly balance: boolean
  /** Whether the demand-structure view exists for the result. */
  readonly structure: boolean
}

/** What a consumer asks to describe one result. */
export interface GmoDescribeRequest {
  /** The result to describe; its category is authorized on every call. */
  readonly resultRef: GmoResultRef
  readonly signal?: AbortSignal
}

/**
 * Everything a reader needs to ask good questions of one result: its columns
 * with their business meaning, its dashboard dimensions, today's date as the
 * upstream sees it, and the category's written business rules.
 */
export interface GmoDescription {
  readonly resultRef: GmoResultRef
  /** The category it belongs to. */
  readonly ref: GmoCategoryRef
  readonly categoryLabel: string
  readonly name: string
  readonly toolName: string
  readonly period: string
  readonly rows: number
  readonly createdAt: string
  /** The upstream's current date; "this week" and "overdue" are relative to it. */
  readonly today: string
  /** The Monday of the upstream's current week. */
  readonly weekStart: string
  readonly stages: readonly GmoStage[]
  readonly fields: readonly GmoField[]
  readonly dashboard?: GmoDashboard
  /** The input files the result was built from. */
  readonly sources: readonly { readonly name: string; readonly slot: string; readonly rows: number | undefined }[]
  /** The category's business rules in Markdown, empty when none were written. */
  readonly glossary: string
}

/** The filters a question may carry; the upstream validates every key against the result's own columns. */
export interface GmoFilters {
  /** Column to the values it must equal; `__null__` stands for an empty value. */
  readonly multi?: Readonly<Record<string, readonly string[]>>
  /** Column to text it must contain. */
  readonly search?: Readonly<Record<string, string>>
  /** Date column to an inclusive `YYYY-MM-DD` range. */
  readonly range?: Readonly<Record<string, { readonly from?: string; readonly to?: string }>>
  /** Columns that must be empty. */
  readonly empty?: readonly string[]
}

/** The ready-made dashboards an overview question may ask for. */
export type GmoWidget =
  | 'kpi'
  | 'timeline'
  | 'ranking'
  | 'flow'
  | 'heatmap'
  | 'structure'
  | 'quality'
  | 'balance'
  | 'balance_analysis'
  | 'balance_material'

/** A free-form aggregation over a result's columns. */
export interface GmoAggregateQuery {
  readonly kind: 'aggregate'
  /** `sum` of a numeric column, `count` of rows, or `distinct` count of a column's values. */
  readonly metric: 'sum' | 'count' | 'distinct'
  /** The column to sum or count distinct values of; a sum defaults to the dashboard measure. */
  readonly field?: string
  /** Up to two columns to group by. */
  readonly groupBy?: readonly string[]
  /** How a date column groups: by `day`, by `week` (Monday start), or by `month`. */
  readonly dateGrain?: 'day' | 'week' | 'month'
  readonly orderBy?: 'value_desc' | 'value_asc' | 'group_asc'
  readonly limit?: number
  readonly filters?: GmoFilters
}

/** One of the upstream's ready-made dashboards. */
export interface GmoOverviewQuery {
  readonly kind: 'overview'
  readonly widget: GmoWidget
  readonly filters?: GmoFilters
  /** The date column the dashboard buckets by, defaulting to the result's first. */
  readonly dateField?: string
  /** The column a timeline stacks by. */
  readonly stack?: string
  /** The column each stacked series splits by. */
  readonly sub?: string
  readonly grain?: 'week' | 'month'
  /** `qty` for the measure or `rows` for the row count. */
  readonly metric?: 'qty' | 'rows'
  /** The column a ranking or heat map groups by, or the dimension of a balance analysis. */
  readonly dim?: string
  readonly top?: number
  /** A keyword narrowing the balance overview. */
  readonly search?: string
  /** The material a `balance_material` view details. */
  readonly material?: string
}

/** A page of the result's detail rows. */
export interface GmoRowsQuery {
  readonly kind: 'rows'
  readonly filters?: GmoFilters
  readonly sort?: { readonly field: string; readonly dir: 'asc' | 'desc' }
  readonly page?: number
  readonly pageSize?: number
}

/** The questions a member may ask of one result. */
export type GmoQuery = GmoAggregateQuery | GmoOverviewQuery | GmoRowsQuery

/** What a consumer asks a result. */
export interface GmoAskRequest {
  /** The result to ask; its category is authorized on every call. */
  readonly resultRef: GmoResultRef
  readonly query: GmoQuery
  readonly signal?: AbortSignal
}

/**
 * What one question answers.
 *
 * `data` is the upstream's own answer, bounded by the upstream's row, group,
 * and byte limits; it carries the figures a reader quotes, so nothing here
 * re-derives them. Its fields depend on the question kind and are described
 * to the model by the tool that asks.
 */
export interface GmoAnswer {
  /** The result asked, echoed so a transcript reads without its request. */
  readonly resultRef: GmoResultRef
  /** The category it belongs to, named for a reader. */
  readonly ref: GmoCategoryRef
  readonly kind: GmoQuery['kind']
  readonly data: { readonly [key: string]: GmoJson }
}

/**
 * The category named in a Session scope, with the display name recorded
 * beside it.
 *
 * The name travels with the reference because the scope reaches the model as
 * prompt text, and a model-visible name has to be reconstructable from the
 * Session log. A name recorded here is a snapshot of the moment of choice: a
 * category renamed afterwards does not change what an already-recorded
 * Session's prompt says.
 */
export interface GmoScopeCategory {
  readonly ref: GmoCategoryRef
  readonly displayName: string
}

/**
 * Which GMO category the current Session analyzes.
 *
 * `off` is the state a Session starts in and the only one a log without a
 * scope event folds to. Scope narrows authorization and never widens it: a
 * `selected` category is still authorized on every operation, and there is no
 * arm meaning "every category", because one conversation analyzes one.
 */
export type GmoScope =
  | { readonly version: 1; readonly mode: 'off' }
  | { readonly version: 1; readonly mode: 'selected'; readonly category: GmoScopeCategory }

/** Every mode a {@link GmoScope} can carry. */
export type GmoScopeMode = GmoScope['mode']

/**
 * Every way a GMO operation ends badly.
 *
 * The set is closed so a Runner, a tool result, and a UI all distinguish
 * "sign in again" from "ask an administrator" from "try later" without
 * parsing a message. `not-allowed` deliberately covers an unknown category as
 * well as an unauthorized one, so a refusal never confirms that a category
 * exists to a principal holding nothing on it.
 */
export type GmoFailureReason =
  /** No valid device token, an inactive member, or a revoked device. */
  | 'unauthenticated'
  /** No grant admits the operation, or the named category is unknown or disabled. */
  | 'not-allowed'
  /** The conversation's category is no longer in the principal's authorized directory. */
  | 'scope-unavailable'
  /** The source holds no such result, or it no longer belongs to the conversation's category. */
  | 'result-unavailable'
  /** The source holds the result but has no such view of it, such as demand structure on an allocation result. */
  | 'unsupported'
  /** The source refused the question: a column, a filter, or a value it does not accept. */
  | 'invalid-query'
  /** The upstream GMO service did not answer in time or at all, or refused the credential. */
  | 'upstream-unavailable'
  /** The upstream GMO service answered something this build cannot read. */
  | 'upstream-invalid'
  /** The answer exceeded the upstream's size bound; a narrower question fits. */
  | 'too-large'
  /** The Control Plane could not be reached from this computer. */
  | 'control-plane-unreachable'
  /** This Runner speaks a GMO protocol version the Control Plane refuses. */
  | 'update-required'
  /** The caller aborted the operation. */
  | 'cancelled'
