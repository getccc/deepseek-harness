/**
 * The wire shared by the governed knowledge, BI, and GMO endpoints between a
 * Team Runner and the Control Plane.
 *
 * Both ends live here so the facts they must agree on have one owner: the
 * bearer header, the version check that runs before any field is decoded, the
 * `{ error, reason }` refusal envelope, and the `update-required` body. A
 * capability keeps its own paths, versions, reasons, and fields.
 * @module @deepseek-ai/dsh-team-governed-wire
 */

export { governedClient } from './client.ts'
export {
  ACCESS_TOKEN_HEADER,
  COMMON_REFUSAL_REASONS,
  COMMON_REFUSAL_STATUS,
} from './protocol.ts'
export { governedHandler, readCount } from './server.ts'
export type {
  GovernedClient,
  GovernedClientOptions,
  GovernedProtocol,
  OpenedRequest,
  ParseRoute,
  ServeOptions,
  VerifiedClaims,
  WireReason,
} from './types.ts'
