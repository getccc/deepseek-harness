/**
 * The Runner-facing BI protocol: its paths, its version, and the facts a
 * Runner sends.
 *
 * A Runner and the Control Plane ship as separate installations, so the wire
 * facts live in one module that both import rather than in two hand-matched
 * copies.
 * @module @deepseek-ai/dsh-bi-gateway-http/protocol
 */

/** Path the Control Plane serves the current principal's authorized project directory under. */
export const BI_CATALOG_PATH = '/team/bi/catalog'

/** Path the Control Plane serves one project's saved-chart listing under. */
export const BI_CHARTS_PATH = '/team/bi/charts'

/** Path the Control Plane serves one saved chart's run under. */
export const BI_QUERY_PATH = '/team/bi/query'

/** Header carrying the Runner's device access token. */
export const ACCESS_TOKEN_HEADER = 'authorization'

/**
 * The newest BI protocol version this Control Plane answers.
 *
 * BI owns its own version rather than sharing the device-binding one or the
 * knowledge one. The protocols evolve independently: a BI-only change must not
 * force the binding version up, and raising the BI minimum must not lock an
 * old Runner out of binding, which is the one operation it would need in
 * order to recover.
 */
export const BI_PROTOCOL_VERSION = 1

/**
 * The oldest BI protocol version this Control Plane still answers.
 *
 * Raising it is how a deployment stops serving Runners too old to be trusted
 * with a change: a refusal a Runner can act on, rather than a request that
 * fails for a reason it cannot distinguish from its own mistake.
 */
export const MINIMUM_BI_PROTOCOL_VERSION = 1

/**
 * What a Runner sends to read its authorized project directory.
 *
 * The version is the only field, and it is deliberately not optional: a
 * request that omitted it would be a Runner this build cannot identify, and
 * guessing which protocol it meant is how a version check stops being one.
 */
export interface CatalogBody {
  readonly protocolVersion: number
}

/**
 * What a Runner sends to list one project's saved charts.
 *
 * The reference is the only thing a Runner names, and it is a governed
 * reference rather than an upstream id: the Control Plane resolves which
 * source holds it, and authorizes the project before it asks.
 */
export interface ChartsBody {
  readonly protocolVersion: number
  /** The governed project reference to list. */
  readonly ref: string
  /** Keep only charts whose name, space, or description holds this text. */
  readonly query?: string
  /** Which page, counting from one; the first page when absent. */
  readonly page?: number
  /** How many charts one page holds; the deployment's own size applies when absent. */
  readonly pageSize?: number
}

/**
 * What a Runner sends to run one saved chart.
 *
 * The chart reference is the only address here, and `limit` is the most rows
 * this Runner wants rather than what the deployment allows: the Control Plane
 * applies its own bound too. There is no filter, parameter, sort, or query
 * field, because a saved chart runs as it was saved.
 */
export interface QueryBody {
  readonly protocolVersion: number
  /** The governed chart reference to run. */
  readonly chartRef: string
  /** At most this many rows; the deployment's own bound still applies. */
  readonly limit?: number
}

/**
 * What the Control Plane answers a Runner it refuses.
 *
 * The reason is a closed BI failure word, so a Runner distinguishes "sign in
 * again" from "ask an administrator" from "try later" without parsing a
 * message. No upstream text ever reaches it.
 */
export interface BiRefusal {
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
export interface BiProtocolRefusal extends BiRefusal {
  readonly reason: 'update-required'
  /** The oldest version this Control Plane answers. */
  readonly minimum: number
  /** The newest version this Control Plane speaks. */
  readonly current: number
}
