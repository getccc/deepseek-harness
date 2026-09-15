/**
 * The wire the Team Runner's search provider and the Control Plane's search
 * route share: the path, the header, the version, the request fields, and the
 * closed refusal set. Both sides import from here so neither can drift.
 * @module @deepseek-ai/dsh-web-search-gateway-http/protocol
 */

import type { WebSearchSource } from '@deepseek-ai/dsh-web'

/** The Runner-facing search route. */
export const WEB_SEARCH_PATH = '/team/web/search'

/** The header carrying the device access token as `Bearer <token>`. */
export const ACCESS_TOKEN_HEADER = 'authorization'

/** The protocol version this build speaks. */
export const WEB_SEARCH_PROTOCOL_VERSION = 1

/** The oldest protocol version this build still accepts. */
export const MINIMUM_WEB_SEARCH_PROTOCOL_VERSION = 1

/**
 * What a Runner sends. There is no field for an organization, a principal, a
 * device, a provider, an address, or a credential: the Control Plane resolves
 * every one of those from the token and its own composition.
 */
export interface SearchBody {
  readonly protocolVersion: number
  /** The query the model asked for, non-empty. */
  readonly query: string
  /** Upper bound on returned sources; the Control Plane's web service truncates to it. */
  readonly maxResults?: number
}

/** What the Control Plane answers with on success: the web service's result, verbatim. */
export interface SearchAnswer {
  readonly content?: string
  readonly sources: readonly WebSearchSource[]
  readonly truncated: boolean
}

/** Every reason a search route can refuse with; a Runner treats any other word as unreachable. */
export const WEB_SEARCH_REFUSAL_REASONS = [
  'unauthenticated',
  'not-allowed',
  'upstream-unavailable',
  'upstream-invalid',
  'update-required',
  'cancelled',
] as const

/** One member of {@link WEB_SEARCH_REFUSAL_REASONS}. */
export type WebSearchRefusalReason = typeof WEB_SEARCH_REFUSAL_REASONS[number]

/** A refusal body. */
export interface WebSearchRefusal {
  readonly error: 'web'
  readonly reason: WebSearchRefusalReason
}

/** The `update-required` refusal, which also names the accepted version range. */
export interface WebSearchProtocolRefusal extends WebSearchRefusal {
  readonly reason: 'update-required'
  readonly minimum: number
  readonly current: number
}
