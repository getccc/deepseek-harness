/**
 * The GMO supply-chain seam: one service a Runner asks for the categories its
 * signed-in member may analyze, for the results in one of them, for one
 * result's description, and for answers to questions about one result.
 *
 * The seam is deliberately small, a directory, a result listing, a
 * description, and a question, because every operation it names has to be one
 * the Control Plane can authorize against a current account, a current
 * device, and current grants. There is no operation for naming an address,
 * passing a credential, running a statement of the caller's own, or changing a
 * result, so a Runner holding this service still cannot reach the GMO source
 * except through a decision made elsewhere.
 * @module @deepseek-ai/dsh-gmo
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  GmoAnswer,
  GmoAskRequest,
  GmoCategoryEntry,
  GmoDescribeRequest,
  GmoDescription,
  GmoResultPage,
  GmoResultsRequest,
} from './types.ts'

export {
  GMO_REF_MAX_LENGTH,
  GMO_REF_SEGMENT,
  GMO_RESULT_ID_MAX_LENGTH,
  GMO_SOURCE_CODE_MAX_LENGTH,
  GmoCategoryRef,
  GmoResultRef,
  InvalidGmoRefError,
  categoryRefOf,
  formatGmoCategoryRef,
  formatGmoResultRef,
  isGmoCategoryRef,
  isGmoResultRef,
  parseGmoCategoryRef,
  parseGmoResultRef,
  upstreamResultIdOf,
  type GmoCategoryRefParts,
  type GmoResultRefParts,
} from './brand.ts'
export {
  DEFAULT_GMO_SCOPE,
  categoryOf,
  foldGmoScope,
  parseGmoScope,
} from './scope.ts'
export { GmoError } from './error.ts'
export { readGmoCount, readGmoFilters, readGmoQuery } from './query.ts'
export {
  type GmoAggregateQuery,
  type GmoAnswer,
  type GmoAskRequest,
  type GmoCategoryEntry,
  type GmoDashboard,
  type GmoDescribeRequest,
  type GmoDescription,
  type GmoField,
  type GmoFailureReason,
  type GmoFilters,
  type GmoJson,
  type GmoOverviewQuery,
  type GmoQuery,
  type GmoResultPage,
  type GmoResultSummary,
  type GmoResultsRequest,
  type GmoRowsQuery,
  type GmoScope,
  type GmoScopeCategory,
  type GmoScopeMode,
  type GmoStage,
  type GmoWidget,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    gmo: Gmo
  }
}

/**
 * GMO supply-chain analysis, as a Runner sees it. A provider mounts this
 * service; consumers inject `gmo`.
 *
 * Every method fails with {@link GmoError} carrying a closed reason. None
 * returns a partial answer: a directory that could not be authorized, a
 * listing on a refused category, and a question about a result outside its
 * category all raise, because a quietly narrowed result is indistinguishable
 * from a correct one to the model that reads it.
 */
export abstract class Gmo extends Service {
  constructor(ctx: Context) {
    super(ctx, 'gmo')
  }

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
}
