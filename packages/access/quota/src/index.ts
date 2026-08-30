/**
 * The quota seam: hold a claim on an organization's budget before calling an
 * upstream provider, and settle it once for what actually happened.
 *
 * The whole design turns on one fact — a request can fail in a way that leaves
 * nobody knowing whether the provider generated tokens. A ledger that only
 * knew "charge" and "do not charge" would have to guess, so this one separates
 * what a provider reported from what was estimated, and never lets an estimate
 * exceed what was reserved.
 * @module @deepseek-ai/dsh-quota
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import type { ReservationId } from './brand.ts'
import type {
  PeriodKey,
  QuotaUsage,
  Reservation,
  ReservationRefusal,
  ReservationRequest,
  Settlement,
  SettlementRecord,
} from './types.ts'

export { ReservationId } from './brand.ts'
export type {
  PeriodKey,
  QuotaUsage,
  Reservation,
  ReservationRefusal,
  ReservationRequest,
  Settlement,
  SettlementKind,
  SettlementRecord,
} from './types.ts'
export { RESERVATION_REFUSALS, SETTLEMENT_KINDS } from './vocabulary.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    quota: Quota
  }
}

/** Raised when a reservation cannot be held. */
export class ReservationRefusedError extends Error {
  constructor(readonly reason: ReservationRefusal) {
    super(`reservation refused: ${reason}`)
    this.name = 'ReservationRefusedError'
  }
}

/** Raised when a settlement names a reservation the ledger does not hold. */
export class UnknownReservationError extends Error {
  constructor(readonly reservationId: ReservationId) {
    super(`unknown reservation ${reservationId}`)
    this.name = 'UnknownReservationError'
  }
}

/**
 * The budget ledger. A provider mounts this service; consumers inject `quota`.
 *
 * Nothing here decides who may use a model — access control does. This decides
 * only whether there is budget left, and records what a request spent.
 */
export abstract class Quota extends Service {
  constructor(ctx: Context) {
    super(ctx, 'quota')
  }

  /**
   * Set what an organization may spend in one period. Setting it again
   * replaces the limit and changes nothing already settled or reserved.
   * @param orgId - the organization to limit.
   * @param period - the period the limit applies to.
   * @param limitTokens - the ceiling, or undefined to remove the limit.
   */
  abstract setLimit(orgId: OrgId, period: PeriodKey, limitTokens: number | undefined): Promise<void>

  /**
   * Hold a claim on the budget before calling an upstream provider.
   *
   * The claim is the input tokens plus the most output the request may
   * produce, so a reservation is the ceiling on what this request can ever
   * cost. That is what lets a later estimate be bounded rather than invented.
   * @param request - who is asking, for which model, and for how much.
   * @returns the held reservation.
   * @throws {ReservationRefusedError} when the budget cannot cover it, or the request is malformed.
   */
  abstract reserve(request: ReservationRequest): Promise<Reservation>

  /**
   * Settle a reservation once, for what actually happened.
   *
   * Settling the same reservation again returns the settlement already
   * recorded and changes no balance. That is what makes a caller safe to retry
   * after a crash, and what makes the reconciler safe to run beside it.
   * @param id - the reservation being settled.
   * @param settlement - what the provider reported, what is estimated, or a release.
   * @returns the settlement of record, which may predate this call.
   * @throws {UnknownReservationError} when the ledger holds no such reservation.
   */
  abstract settle(id: ReservationId, settlement: Settlement): Promise<SettlementRecord>

  /**
   * Settle every reservation whose lifetime has run out.
   *
   * They are settled, not released: a request that ran past its window is far
   * more likely to have spent the budget than to have spent nothing, and a
   * ledger that released them would let a crash loop spend without recording.
   * @param now - the moment to reconcile against, in epoch milliseconds.
   * @returns the settlements written, in reservation order.
   */
  abstract reconcile(now: number): Promise<SettlementRecord[]>

  /**
   * What an organization has spent and holds in one period.
   * @param orgId - the organization to report on.
   * @param period - the period to report on.
   * @returns the limit, what is settled, what is reserved, and what remains.
   */
  abstract usage(orgId: OrgId, period: PeriodKey): Promise<QuotaUsage>
}
