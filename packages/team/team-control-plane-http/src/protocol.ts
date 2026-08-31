/**
 * The Runner-facing binding endpoints: their paths, and the request and
 * response bodies both sides must agree on.
 *
 * A Runner and the Control Plane ship as separate installations, so the wire
 * facts live in one module that both import rather than in two hand-matched
 * copies.
 * @module @deepseek-ai/dsh-team-control-plane-http/protocol
 */

/** The binding protocol version this build speaks. */
export const PROTOCOL_VERSION = 1

/**
 * The oldest binding protocol version this Control Plane still answers.
 *
 * Raising it is how a deployment stops serving Runners too old to be trusted
 * with a change — a refusal a Runner can act on, rather than a request that
 * fails for a reason it cannot distinguish from its own mistake.
 */
export const MINIMUM_PROTOCOL_VERSION = 1

/** Whether a Runner's protocol version is one this build can answer. */
export type ProtocolSupport = 'supported' | 'too-old' | 'too-new'

/**
 * Decide whether this build speaks a Runner's version.
 *
 * `too-new` is not an error on the Runner's part: it means this Control Plane
 * is the one that needs updating, and saying so keeps an administrator from
 * chasing a member's installation.
 * @param version - the version the Runner reported.
 * @returns which side of the supported range the version falls on.
 */
export function protocolSupport(version: number): ProtocolSupport {
  if (version < MINIMUM_PROTOCOL_VERSION) return 'too-old'
  if (version > PROTOCOL_VERSION) return 'too-new'
  return 'supported'
}

/** Default path prefix the Control Plane serves the Runner-facing endpoints under. */
export const DEVICE_PATH_PREFIX = '/team/device'

/** Path segment that opens a transaction. */
export const START_PATH = '/start'
/** Path segment that authenticates a member and approves one transaction. */
export const LOGIN_PATH = '/login'
/** Path segment that turns an authorization code into a credential. */
export const REDEEM_PATH = '/redeem'
/** Path segment that exchanges a refresh token for the next one. */
export const REFRESH_PATH = '/refresh'

/** Member identity returned after a successful Runner-local sign-in. */
export interface TeamMemberIdentity {
  /** Organization-local account name. */
  readonly loginName: string
  /** Human-readable member name. */
  readonly displayName: string
}

/** Successful authentication response before the Runner redeems its code. */
export interface LoginSuccess {
  /** One-time authorization code bound to the pending transaction. */
  readonly code: string
  /** Identity the Runner persists beside the issued device credential. */
  readonly member: TeamMemberIdentity
}

/**
 * What the Control Plane answers when it refuses.
 *
 * The reason is the word the seam produced, so a Runner distinguishes "try
 * again" from "bind this computer again" without parsing a message.
 */
export interface WireRefusal {
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
export interface ProtocolRefusal extends WireRefusal {
  readonly reason: 'protocol-unsupported'
  /** The oldest version this Control Plane answers. */
  readonly minimum: number
  /** The newest version this Control Plane speaks. */
  readonly current: number
}
