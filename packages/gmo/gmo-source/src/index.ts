/**
 * The upstream GMO-source seam: what a Control Plane provider offers the
 * governed gateway in front of it.
 *
 * This is the only place the upstream GMO supply-chain service is spoken to,
 * and it is mounted in the Control Plane alone. Every operation is one the
 * gateway can authorize: enumerate the categories a source holds, list one
 * category's results, place one result in its category, describe one result,
 * and ask one result a question from a fixed vocabulary. There is no
 * operation that takes a URL, a caller-chosen header, or a statement of the
 * caller's own, so the gateway cannot be talked into an operation the
 * permission catalog does not govern.
 *
 * Everything here is in upstream terms, upstream ids rather than
 * `GmoCategoryRef`s, because mapping between the two is the catalog's job, and
 * a provider that knew about governed resources would be authorizing.
 * @module @deepseek-ai/dsh-gmo-source
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { GmoDescription, GmoJson, GmoQuery } from '@deepseek-ai/dsh-gmo'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gmoSource: GmoSource
  }
}

/** One category as its upstream source describes it. */
export interface UpstreamCategory {
  /** The source's own category key, meaningful only to this provider. */
  readonly upstreamId: string
  /** The category's name for a reader, such as `GB / GL 分配`. */
  readonly name: string
  /** How many results the category holds, or undefined when the source does not say. */
  readonly resultCount: number | undefined
}

/** One step of a multi-step result as the source describes it. */
export interface UpstreamStage {
  readonly key: string
  readonly label: string
  /** The id that selects exactly this step's rows. */
  readonly upstreamResultId: string
}

/** One processing result as its upstream source describes it. */
export interface UpstreamResult {
  /**
   * The source's own result identifier, meaningful only to this provider.
   *
   * A provider returns only ids the governed reference grammar accepts,
   * within `GMO_RESULT_ID_MAX_LENGTH` and over the reference alphabet, and
   * refuses a row with anything else as `upstream-invalid`. That is what lets
   * the gateway mint a reference from one without a second guard: a result it
   * could not address is one no later operation could name.
   */
  readonly upstreamResultId: string
  readonly name: string
  readonly toolName: string
  readonly period: string
  readonly rows: number
  readonly createdAt: string
  readonly stages: readonly UpstreamStage[]
}

/** What the gateway asks a source for one page of a category's results. */
export interface UpstreamResultsRequest {
  /** The category to list, already authorized. */
  readonly upstreamId: string
  /** Which page, counting from one. */
  readonly page: number
  /** How many results one page holds; the provider's own maximum still applies. */
  readonly pageSize: number
  readonly signal?: AbortSignal
}

/** One page of a category's results, newest first. */
export interface UpstreamResultListing {
  readonly results: readonly UpstreamResult[]
  /** The page size the provider actually applied. */
  readonly pageSize: number
  /** How many results the category holds in total. */
  readonly total: number
}

/** Where one result sits, so the gateway can authorize the category that holds it before anything is read. */
export interface UpstreamPlacement {
  /** The category the source says holds it. */
  readonly upstreamId: string
}

/** A result's description in upstream terms: the domain description without the governed references. */
export interface UpstreamDescription extends Omit<GmoDescription, 'resultRef' | 'ref' | 'stages'> {
  /** The category the source says holds the result. */
  readonly upstreamId: string
  readonly upstreamResultId: string
  readonly stages: readonly UpstreamStage[]
}

/** What the gateway asks a source to answer. */
export interface UpstreamAskRequest {
  /** The category the result sits in, already authorized and already agreed by the source. */
  readonly upstreamId: string
  /** The result to ask. */
  readonly upstreamResultId: string
  /** The question, from the fixed vocabulary; the source validates every column and value in it. */
  readonly query: GmoQuery
  readonly signal?: AbortSignal
}

/** What one question answers, in the terms the gateway forwards unchanged. */
export interface UpstreamAnswer {
  /** The category the source says answered, which the gateway checks against the one it authorized. */
  readonly upstreamId: string
  /** The source's own answer with its own bookkeeping removed. */
  readonly data: { readonly [key: string]: GmoJson }
}

/**
 * One upstream GMO service. A provider mounts this service; the governed
 * gateway injects `gmoSource`.
 *
 * Failures are raised as `GmoError` with `upstream-unavailable`,
 * `upstream-invalid`, `result-unavailable`, `unsupported`, `invalid-query`, or
 * `too-large`. A provider never raises an authorization reason: it does not
 * know who is asking, which is the point.
 */
export abstract class GmoSource extends Service {
  constructor(ctx: Context) {
    super(ctx, 'gmoSource')
  }

  /**
   * Which upstream product this is, as the first segment of a `GmoCategoryRef`.
   *
   * A constant of the provider rather than configuration: it names the code
   * that speaks the protocol, and a deployment renaming it would change the
   * identity of every category already governed.
   */
  abstract readonly providerKind: string

  /**
   * The deployment's code for this source, as the second `GmoCategoryRef`
   * segment. Configuration, because one company's `prod` is another's `gmo`.
   */
  abstract readonly sourceCode: string

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
}
