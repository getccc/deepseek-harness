/**
 * Quota vocabulary shared by every provider and consumer.
 * @module @deepseek-ai/dsh-quota/types
 */

import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { ReservationId } from './brand.ts'
import type { RESERVATION_REFUSALS, SETTLEMENT_KINDS } from './vocabulary.ts'

/** Why a reservation was refused. */
export type ReservationRefusal = typeof RESERVATION_REFUSALS[number]

/** How a reservation was settled. */
export type SettlementKind = typeof SETTLEMENT_KINDS[number]

/**
 * A budget period, named by the caller.
 *
 * The seam does not know what a month is: a deployment names its periods, and
 * the gateway asks about the one a request belongs to. That keeps calendars,
 * time zones, and billing cycles out of a ledger whose only job is arithmetic.
 */
export type PeriodKey = string

/** What a caller asks to reserve before it calls an upstream provider. */
export interface ReservationRequest {
  readonly orgId: OrgId
  readonly period: PeriodKey
  /** The account the request acts as. */
  readonly principalId: UserId
  /** The device the request arrived from, when one is bound to it. */
  readonly deviceId?: string
  /** The model this reservation is for, as the catalog names it. */
  readonly modelRef: string
  /** Tokens already counted in the prompt. */
  readonly inputTokens: number
  /** The most output tokens this request may produce. */
  readonly maxOutputTokens: number
  /** Opaque correlation for the session; never a local session id. */
  readonly correlationId?: string
}

/** A held claim on an organization's budget. */
export interface Reservation {
  readonly id: ReservationId
  readonly orgId: OrgId
  readonly period: PeriodKey
  readonly principalId: UserId
  readonly modelRef: string
  /** Input plus maximum output: the most this request can ever be charged. */
  readonly reservedTokens: number
  readonly createdAt: number
  /**
   * When an unsettled reservation becomes the reconciler's to settle.
   *
   * A reservation is not released at this moment — it is settled, because a
   * request that ran long is far more likely to have spent the budget than to
   * have spent nothing.
   */
  readonly expiresAt: number
}

/**
 * What actually happened, as the caller reports it.
 *
 * `released` is the only outcome that returns the whole reservation, and it
 * requires evidence that the upstream refused the request. Everything else
 * charges something, because everything else may have generated tokens.
 */
export type Settlement =
  /** The provider reported usage; charge exactly that. */
  | { readonly kind: 'reported'; readonly inputTokens: number; readonly outputTokens: number }
  /** No usage is available; charge this estimate and mark the record. */
  | { readonly kind: 'estimated'; readonly inputTokens: number; readonly outputTokens: number }
  /** The upstream said it did not accept the request; charge nothing. */
  | { readonly kind: 'released' }

/** What a settled reservation cost, once. */
export interface SettlementRecord {
  readonly reservationId: ReservationId
  readonly kind: SettlementKind
  readonly inputTokens: number
  readonly outputTokens: number
  /** Input plus output, and never more than the reservation held. */
  readonly chargedTokens: number
  readonly settledAt: number
  /** True when the reconciler settled it rather than the caller. */
  readonly reconciled: boolean
}

/** An organization's standing in one period. */
export interface QuotaUsage {
  readonly orgId: OrgId
  readonly period: PeriodKey
  /** The ceiling an administrator set, or undefined when none is set. */
  readonly limitTokens?: number
  /** Charged by settlements. */
  readonly settledTokens: number
  /** Held by reservations that have not settled. */
  readonly reservedTokens: number
  /** What a new reservation may still claim; undefined when no limit is set. */
  readonly availableTokens?: number
}

/**
 * The settlement kinds that record tokens a model actually produced.
 *
 * `released` is left out: it names a request the upstream refused, which spent
 * nothing, so a usage report neither counts it as a call nor lists it.
 */
export type UsageSettlementKind = Exclude<SettlementKind, 'released'>

/**
 * The calls a usage report covers.
 *
 * A call belongs to the window by when the member sent it (`createdAt`), not by
 * when it settled, so a long completion or a reconciled crash stays on the day
 * the member asked.
 */
export interface UsageWindow {
  readonly orgId: OrgId
  /** First moment included, in epoch milliseconds. */
  readonly from: number
  /** First moment excluded, in epoch milliseconds. */
  readonly to: number
}

/** A window narrowed to one account. */
export interface UsageFilter extends UsageWindow {
  /** Only this account's calls, or every account's when undefined. */
  readonly principalId?: UserId
}

/** What one account spent in a window. */
export interface PrincipalUsage {
  readonly principalId: UserId
  /** Settled calls that produced tokens. */
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** What the calls charged against the budget. */
  readonly chargedTokens: number
  /** When the account last sent one of these calls, in epoch milliseconds. */
  readonly lastCallAt: number
}

/** The calls sent inside one time bucket. */
export interface UsageBucket {
  /** First moment of the bucket, in epoch milliseconds. */
  readonly start: number
  readonly calls: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly chargedTokens: number
}

/** How a usage series cuts time into buckets. */
export interface UsageSeriesQuery extends UsageFilter {
  /** Length of one bucket in milliseconds. */
  readonly bucketMs: number
  /**
   * Offset of the reader's local time from UTC in milliseconds, so a day bucket
   * starts at the reader's midnight rather than at UTC midnight.
   */
  readonly utcOffsetMs: number
}

/** Which slice of a window's calls to list, newest first. */
export interface UsageRecordsQuery extends UsageFilter {
  /** Most records to return. */
  readonly limit: number
  /** Records to skip from the newest. */
  readonly offset: number
}

/** One settled call, as a usage report lists it. */
export interface UsageRecord {
  readonly reservationId: ReservationId
  readonly principalId: UserId
  /** The device the call arrived from, when one was bound to it. */
  readonly deviceId?: string
  readonly modelRef: string
  /** When the member sent the call, in epoch milliseconds. */
  readonly createdAt: number
  /** When the ledger settled it, in epoch milliseconds. */
  readonly settledAt: number
  readonly kind: UsageSettlementKind
  /** True when the reconciler settled it, which charges the whole reservation. */
  readonly reconciled: boolean
  readonly inputTokens: number
  readonly outputTokens: number
  readonly chargedTokens: number
}

/** One page of a window's calls. */
export interface UsageRecordPage {
  readonly records: readonly UsageRecord[]
  /** Every call the filter matches, not only this page. */
  readonly total: number
}
