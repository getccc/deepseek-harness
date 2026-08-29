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

/** Default path prefix the Control Plane serves the Runner-facing endpoints under. */
export const DEVICE_PATH_PREFIX = '/team/device'

/** Path segment that opens a transaction. */
export const START_PATH = '/start'
/** Path segment that turns an authorization code into a credential. */
export const REDEEM_PATH = '/redeem'
/** Path segment that exchanges a refresh token for the next one. */
export const REFRESH_PATH = '/refresh'

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
