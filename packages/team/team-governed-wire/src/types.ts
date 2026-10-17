/**
 * Types of the governed wire: what a capability tells the Control Plane end
 * and the Runner end about its protocol.
 * @module @deepseek-ai/dsh-team-governed-wire/types
 */

import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { ControlPlaneFetch } from '@deepseek-ai/dsh-team-account-client'

/** The two refusals the wire itself raises, which every capability's reason set contains. */
export type WireReason = 'unauthenticated' | 'control-plane-unreachable'

/**
 * One capability's protocol as the Control Plane serves it.
 *
 * `Reason` is the capability's closed set of refusal words.
 */
export interface GovernedProtocol<Reason extends string> {
  /** The word identifying the capability in every refusal body, as in `{ error: 'gmo', reason }`. */
  readonly scope: string
  /** The oldest protocol version still answered. */
  readonly minimum: number
  /** The newest protocol version answered. */
  readonly current: number
  /** The HTTP status each refusal word answers with. */
  readonly statusByReason: Readonly<Record<Reason | 'unauthenticated', number>>
}

/** The member a verified device token stands for. */
export interface VerifiedClaims {
  readonly orgId: OrgId
  readonly principalId: UserId
  readonly deviceId: string
}

/** A request that passed method, body, version, and identity checks. */
export interface OpenedRequest {
  /** The decoded JSON object body. */
  readonly body: Record<string, unknown>
  /** Who is asking, recovered from the token and never from the body. */
  readonly principal: VerifiedClaims
}

/** What the Control Plane end needs to open one request. */
export interface OpenOptions<Reason extends string> {
  readonly protocol: GovernedProtocol<Reason>
  /** The most bytes a request body may carry. */
  readonly limit: number
  /**
   * Verify a bearer token.
   * @param token - the token the request presented.
   * @returns the claims it carries, or undefined for an unknown, lapsed, or revoked token.
   */
  verify(token: string): Promise<VerifiedClaims | undefined>
}

/** What the Control Plane end needs to serve one route: opening, plus how a failure is told apart. */
export interface ServeOptions<Reason extends string> extends OpenOptions<Reason> {
  /** The refusal word of a failure the capability owns, or undefined for one that is this deployment's own defect. */
  readonly reasonOf: (error: unknown) => Reason | undefined
}

/**
 * Decode one opened request into the operation it asks for.
 *
 * Runs outside the failure handling: a field this build cannot read is a
 * protocol error, answered 400, never an authorization outcome.
 * @param opened - the request after method, body, version, and identity checks.
 * @returns the operation to run and answer with, or undefined when the body is malformed.
 */
export type ParseRoute = (opened: OpenedRequest) => (() => Promise<unknown>) | undefined

/** What a Runner needs to call one capability's Control Plane endpoints. */
export interface GovernedClientOptions<Reason extends string> {
  /** The fetch carrying this deployment's trust. */
  readonly fetch: ControlPlaneFetch
  /** The origin of the company Control Plane; each call resolves its path against it. */
  readonly baseUrl: string
  /** The Runner's account, whose access token is read per call because the account client refreshes it. */
  readonly account: { accessToken(): Promise<string> }
  /** The refusal words the capability's Control Plane may answer with. */
  readonly reasons: readonly Reason[]
  /**
   * Build the capability's own error for a closed reason.
   * @param reason - the refusal word.
   * @param message - a diagnostic that carries no secret.
   * @returns the error to throw.
   */
  fail(reason: Reason | WireReason, message: string): Error
}

/**
 * One Runner call to a capability endpoint.
 * @param path - the endpoint path, resolved against the Control Plane origin.
 * @param protocolVersion - the protocol version this operation speaks.
 * @param fields - the operation's own fields; `protocolVersion` is added by the call.
 * @param signal - the caller's cancellation.
 * @returns the decoded answer when the Control Plane answered with success.
 */
export type GovernedClient = (
  path: string,
  protocolVersion: number,
  fields: Record<string, unknown>,
  signal: AbortSignal | undefined,
) => Promise<Record<string, unknown>>
