/**
 * Model-gateway vocabulary shared by every provider and consumer.
 * @module @deepseek-ai/dsh-model-gateway/types
 */

import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { ReservationId } from '@deepseek-ai/dsh-quota'
import type { INVOCATION_REFUSALS, MODEL_STATUSES } from './vocabulary.ts'

/** Whether a model may still be invoked at all. */
export type ModelStatus = typeof MODEL_STATUSES[number]

/** Why an invocation was refused. */
export type InvocationRefusal = typeof INVOCATION_REFUSALS[number]

/**
 * One company model, as the catalog holds it.
 *
 * The catalog holds a credential *reference*, never a credential. The secret
 * lives in the credential provider, and the gateway resolves it at the moment
 * of the call — so rotating it changes nothing here, and reading this table
 * yields nothing anyone could spend.
 */
export interface ModelEntry {
  readonly orgId: OrgId
  /** The stable name a Runner asks for, which never changes. */
  readonly modelRef: string
  readonly displayName: string
  /** Which upstream provider serves it. */
  readonly providerRef: string
  /** What that provider calls the model, which may change under a stable ref. */
  readonly upstreamModel: string
  /** The provider's base address; a Runner never supplies one. */
  readonly endpoint: string
  /**
   * Where the provider credential lives, as a credential reference — the same
   * addressing an LLM adapter uses, so an operator sets a company key the way
   * they set any other.
   */
  readonly credentialRef: string
  /** The most output tokens one invocation may reserve against. */
  readonly maxOutputTokens: number
  readonly status: ModelStatus
}

/** The fields an administrator supplies when adding a model to the catalog. */
export interface RegisterModel {
  readonly orgId: OrgId
  readonly modelRef: string
  readonly displayName: string
  readonly providerRef: string
  readonly upstreamModel: string
  readonly endpoint: string
  readonly credentialRef: string
  readonly maxOutputTokens: number
}

/** What a Runner asks the gateway before its request reaches a provider. */
export interface InvocationRequest {
  readonly orgId: OrgId
  /** The account the request acts as, recovered from an access token. */
  readonly principalId: UserId
  /** The device the request arrived from. */
  readonly deviceId?: string
  /** The stable model name, as the catalog holds it. */
  readonly modelRef: string
  /** The budget period this request belongs to. */
  readonly period: string
  /** Tokens already counted in the prompt. */
  readonly inputTokens: number
  /** The most output the Runner asks for; the catalog's ceiling still applies. */
  readonly maxOutputTokens?: number
  /** Opaque correlation for the session; never a local session id. */
  readonly correlationId?: string
}

/**
 * What the gateway approved: everything the upstream call needs, and nothing
 * the Runner supplied about where it goes.
 *
 * The endpoint, the upstream model name, and the credential all come from the
 * catalog. That is the whole point of the plan: a Runner names a model and
 * gets back a call it could not have constructed itself.
 */
export interface CallPlan {
  readonly modelRef: string
  readonly endpoint: string
  readonly upstreamModel: string
  readonly credentialRef: string
  /** The claim held on the budget, to be settled once the call ends. */
  readonly reservationId: ReservationId
  /** How much output this call may produce, after the catalog's ceiling. */
  readonly maxOutputTokens: number
  /** The policy revision the authorization was computed against. */
  readonly policyRevision: bigint
}
