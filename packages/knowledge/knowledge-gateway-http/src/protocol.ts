/**
 * The Runner-facing knowledge protocol: its paths, its version, and the facts
 * a Runner sends.
 *
 * A Runner and the Control Plane ship as separate installations, so the wire
 * facts live in one module that both import rather than in two hand-matched
 * copies.
 * @module @deepseek-ai/dsh-knowledge-gateway-http/protocol
 */

/** Path the Control Plane serves the current principal's authorized directory under. */
export const KNOWLEDGE_CATALOG_PATH = '/team/knowledge/catalog'

/** Path the Control Plane serves governed knowledge search under. */
export const KNOWLEDGE_SEARCH_PATH = '/team/knowledge/search'

/** Header carrying the Runner's device access token. */
export const ACCESS_TOKEN_HEADER = 'authorization'

/**
 * The knowledge protocol version this build speaks.
 *
 * Knowledge owns its own version rather than sharing the device-binding one.
 * The two protocols evolve independently: a knowledge-only change must not
 * force the binding version up, and raising the knowledge minimum must not
 * lock an old Runner out of binding, which is the one operation it would need
 * in order to recover.
 */
export const KNOWLEDGE_PROTOCOL_VERSION = 1

/**
 * The oldest knowledge protocol version this Control Plane still answers.
 *
 * Raising it is how a deployment stops serving Runners too old to be trusted
 * with a change — a refusal a Runner can act on, rather than a request that
 * fails for a reason it cannot distinguish from its own mistake.
 */
export const MINIMUM_KNOWLEDGE_PROTOCOL_VERSION = 1

/**
 * What a Runner sends to read its authorized directory.
 *
 * The version is the only field, and it is deliberately not optional: a
 * request that omitted it would be a Runner this build cannot identify, and
 * guessing which protocol it meant is how a version check stops being one.
 */
export interface CatalogBody {
  readonly protocolVersion: number
}

/**
 * What a Runner sends to search.
 *
 * There is no source, address, tenant, credential, upstream id, or knowledge
 * base outside the scope here. A Runner names a query and the references its
 * Session scope resolved to; the Control Plane authorizes each one and
 * resolves the rest from the catalog.
 */
export interface SearchBody {
  readonly protocolVersion: number
  readonly query: string
  /** `all` for every authorized base, or the exact references to search. */
  readonly scope: { readonly mode: 'all' } | { readonly mode: 'selected'; readonly refs: readonly string[] }
  /** At most this many passages; the deployment's own maximum still applies. */
  readonly maxResults?: number
}

/**
 * What the Control Plane answers a Runner it refuses.
 *
 * The reason is a closed knowledge failure word, so a Runner distinguishes
 * "sign in again" from "ask an administrator" from "try later" without parsing
 * a message. No upstream text ever reaches it.
 */
export interface KnowledgeRefusal {
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
export interface KnowledgeProtocolRefusal extends KnowledgeRefusal {
  readonly reason: 'update-required'
  /** The oldest version this Control Plane answers. */
  readonly minimum: number
  /** The newest version this Control Plane speaks. */
  readonly current: number
}
