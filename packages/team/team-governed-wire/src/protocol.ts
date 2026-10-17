/**
 * The facts every governed endpoint shares on the wire.
 * @module @deepseek-ai/dsh-team-governed-wire/protocol
 */

/** Header carrying the Runner's device access token. */
export const ACCESS_TOKEN_HEADER = 'authorization'

/** The prefix of the header value that precedes the token. */
export const BEARER_PREFIX = 'Bearer '

/**
 * The refusal words every governed capability answers with, and the HTTP
 * status each maps to.
 *
 * A source that cannot answer is upstream of the Control Plane exactly as the
 * member's model provider is, and a member can act on neither beyond trying
 * again or asking an administrator. A capability adds the words that are its
 * own, such as an unavailable result, to a copy of this table.
 */
export const COMMON_REFUSAL_STATUS = {
  'unauthenticated': 401,
  'not-allowed': 403,
  'scope-unavailable': 409,
  'upstream-unavailable': 502,
  'upstream-invalid': 502,
  'control-plane-unreachable': 503,
  'update-required': 426,
  'cancelled': 499,
} as const

/** A refusal word every governed capability shares. */
export type CommonRefusalReason = keyof typeof COMMON_REFUSAL_STATUS

/** Every refusal word the capabilities share, for a Runner decoding one back. */
export const COMMON_REFUSAL_REASONS = Object.keys(COMMON_REFUSAL_STATUS) as readonly CommonRefusalReason[]
