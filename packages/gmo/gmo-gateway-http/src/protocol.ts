/**
 * The Runner-facing GMO protocol: its paths, its version, and the facts a
 * Runner sends.
 *
 * A Runner and the Control Plane ship as separate installations, so the wire
 * facts live in one module that both import rather than in two hand-matched
 * copies.
 * @module @deepseek-ai/dsh-gmo-gateway-http/protocol
 */

import type { GmoQuery } from '@deepseek-ai/dsh-gmo'

/** Path the Control Plane serves the current principal's authorized category directory under. */
export const GMO_CATALOG_PATH = '/team/gmo/catalog'

/** Path the Control Plane serves one category's result listing under. */
export const GMO_RESULTS_PATH = '/team/gmo/results'

/** Path the Control Plane serves one result's description under. */
export const GMO_DESCRIBE_PATH = '/team/gmo/describe'

/** Path the Control Plane answers one question about one result under. */
export const GMO_ASK_PATH = '/team/gmo/ask'

export { ACCESS_TOKEN_HEADER } from '@deepseek-ai/dsh-team-governed-wire'

/**
 * The newest GMO protocol version this Control Plane answers.
 *
 * GMO owns its own version rather than sharing the device-binding, knowledge,
 * or BI one. The protocols evolve independently: a GMO-only change must not
 * force the binding version up, and raising the GMO minimum must not lock an
 * old Runner out of binding, which is the one operation it would need in
 * order to recover.
 */
export const GMO_PROTOCOL_VERSION = 1

/**
 * The oldest GMO protocol version this Control Plane still answers.
 *
 * Raising it is how a deployment stops serving Runners too old to be trusted
 * with a change: a refusal a Runner can act on, rather than a request that
 * fails for a reason it cannot distinguish from its own mistake.
 */
export const MINIMUM_GMO_PROTOCOL_VERSION = 1

/**
 * What a Runner sends to read its authorized category directory.
 *
 * The version is the only field, and it is deliberately not optional: a
 * request that omitted it would be a Runner this build cannot identify, and
 * guessing which protocol it meant is how a version check stops being one.
 */
export interface CatalogBody {
  readonly protocolVersion: number
}

/**
 * What a Runner sends to list one category's results.
 *
 * The reference is the only thing a Runner names, and it is a governed
 * reference rather than an upstream id: the Control Plane resolves which
 * source holds it, and authorizes the category before it asks.
 */
export interface ResultsBody {
  readonly protocolVersion: number
  /** The governed category reference to list. */
  readonly ref: string
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many results one page holds; the deployment's own size applies when absent. */
  readonly pageSize?: number
}

/** What a Runner sends to describe one result. */
export interface DescribeBody {
  readonly protocolVersion: number
  /** The governed result reference to describe. */
  readonly resultRef: string
}

/**
 * What a Runner sends to ask one result a question.
 *
 * The result reference is the only address here. The question is a closed
 * vocabulary of aggregation, ready-made dashboard, and detail rows, and every
 * column and value in it is validated by the source against the result's own
 * columns; there is no statement, URL, or header field.
 */
export interface AskBody {
  readonly protocolVersion: number
  /** The governed result reference to ask. */
  readonly resultRef: string
  readonly query: GmoQuery
}

/**
 * What the Control Plane answers a Runner it refuses.
 *
 * The reason is a closed GMO failure word, so a Runner distinguishes "sign in
 * again" from "ask an administrator" from "try later" without parsing a
 * message. No upstream text ever reaches it.
 */
export interface GmoRefusal {
  readonly error: string
  readonly reason: string
}

/**
 * What the Control Plane answers a Runner whose protocol version it cannot
 * speak, alongside HTTP 426.
 *
 * The range travels with the refusal because the Runner is the party that has
 * to act on it, and it cannot ask for the range through a protocol the other
 * side has just said it does not speak.
 */
export interface GmoProtocolRefusal extends GmoRefusal {
  readonly reason: 'update-required'
  /** The oldest version this Control Plane answers. */
  readonly minimum: number
  /** The newest version this Control Plane speaks. */
  readonly current: number
}
