/**
 * SQLite-backed quota: reservations, settlements, and the reconciler that
 * closes the ones nobody settled.
 * @module @deepseek-ai/dsh-quota-sqlite
 */

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { OrgId, UserId, type OrgId as OrgIdType } from '@deepseek-ai/dsh-account-store'
import {
  Quota,
  ReservationId,
  ReservationRefusedError,
  UnknownReservationError,
  type PeriodKey,
  type QuotaUsage,
  type Reservation,
  type ReservationId as ReservationIdType,
  type ReservationRequest,
  type Settlement,
  type SettlementKind,
  type SettlementRecord,
} from '@deepseek-ai/dsh-quota'
import {
  applySchema,
  type BudgetRow,
  type ReservationRow,
  type SettlementRow,
} from './schema.ts'

export { QUOTA_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from './schema.ts'

/** Plugin config: where the ledger lives and how long a claim may be held. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
  /**
   * How long a reservation may stay open before the reconciler settles it, in
   * milliseconds. It bounds how long a crashed request can hold budget, so it
   * belongs above the slowest completion a deployment expects and nowhere near
   * it.
   */
  reservationTtlMs: number
}

function toReservation(row: ReservationRow): Reservation {
  return {
    id: ReservationId(row.id),
    orgId: OrgId(row.org_id),
    period: row.period,
    principalId: UserId(row.principal_id),
    modelRef: row.model_ref,
    reservedTokens: row.reserved_tokens,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }
}

function toSettlement(row: SettlementRow): SettlementRecord {
  return {
    reservationId: ReservationId(row.reservation_id),
    kind: row.kind as SettlementKind,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    chargedTokens: row.charged_tokens,
    settledAt: row.settled_at,
    reconciled: row.reconciled !== 0,
  }
}

/** Whether a value is a token count this ledger can hold. */
function isTokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

/**
 * The quota ledger over one SQLite database.
 *
 * Every balance is derived rather than stored: settled tokens sum the
 * settlements, reserved tokens sum the reservations nothing has answered. A
 * stored running total would be a second place for the truth to live, and the
 * two would eventually disagree.
 */
export class SqliteQuota extends Quota {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    reservationTtlMs: z.natural().min(1).required(),
  })

  private db!: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  /** Open and bring the database to the current schema. */
  protected async [Service.init](): Promise<void> {
    const db = new DatabaseSync(this.config.path)
    applySchema(db)
    this.db = db
    this.ctx.effect(() => () => { db.close() }, 'quota-sqlite.close')
    await Promise.resolve()
  }

  setLimit(orgId: OrgIdType, period: PeriodKey, limitTokens: number | undefined): Promise<void> {
    if (limitTokens === undefined) {
      this.db.prepare('DELETE FROM budget WHERE org_id = ? AND period = ?').run(orgId, period)
      return Promise.resolve()
    }
    if (!isTokenCount(limitTokens)) return Promise.reject(new ReservationRefusedError('malformed'))
    this.db.prepare(
      `INSERT INTO budget (org_id, period, limit_tokens) VALUES (?, ?, ?)
       ON CONFLICT (org_id, period) DO UPDATE SET limit_tokens = excluded.limit_tokens`,
    ).run(orgId, period, limitTokens)
    return Promise.resolve()
  }

  reserve(request: ReservationRequest): Promise<Reservation> {
    const wanted = request.inputTokens + request.maxOutputTokens
    if (!isTokenCount(request.inputTokens) || !isTokenCount(request.maxOutputTokens) || wanted <= 0) {
      return Promise.reject(new ReservationRefusedError('malformed'))
    }
    const standing = this.standing(request.orgId, request.period)
    // No limit means no ceiling to run into: an organization an administrator
    // has not limited is not silently limited to zero.
    if (standing.availableTokens !== undefined && wanted > standing.availableTokens) {
      return Promise.reject(new ReservationRefusedError('exceeded'))
    }
    const now = Date.now()
    const row: ReservationRow = {
      id: randomUUID(),
      org_id: request.orgId,
      period: request.period,
      principal_id: request.principalId,
      device_id: request.deviceId ?? null,
      model_ref: request.modelRef,
      reserved_tokens: wanted,
      correlation_id: request.correlationId ?? null,
      created_at: now,
      expires_at: now + this.config.reservationTtlMs,
    }
    this.db.prepare(
      `INSERT INTO reservation
         (id, org_id, period, principal_id, device_id, model_ref, reserved_tokens,
          correlation_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id, row.org_id, row.period, row.principal_id, row.device_id, row.model_ref,
      row.reserved_tokens, row.correlation_id, row.created_at, row.expires_at,
    )
    return Promise.resolve(toReservation(row))
  }

  settle(id: ReservationIdType, settlement: Settlement): Promise<SettlementRecord> {
    const reservation = this.db.prepare('SELECT * FROM reservation WHERE id = ?')
      .get(id) as ReservationRow | undefined
    if (reservation === undefined) return Promise.reject(new UnknownReservationError(id))
    const existing = this.settlementOf(id)
    // Already answered: the record stands, and this call changes no balance.
    // That is what makes a caller safe to retry and the reconciler safe to run
    // beside it.
    if (existing !== undefined) return Promise.resolve(existing)
    return Promise.resolve(this.write(reservation, settlement, false, Date.now()))
  }

  reconcile(now: number): Promise<SettlementRecord[]> {
    const rows = this.db.prepare(
      `SELECT r.* FROM reservation r
         LEFT JOIN settlement s ON s.reservation_id = r.id
        WHERE s.reservation_id IS NULL AND r.expires_at <= ?
        ORDER BY r.rowid`,
    ).all(now) as unknown as ReservationRow[]
    // Charged at the reservation, not released: a request that ran past its
    // window is far more likely to have spent the budget than to have spent
    // nothing, and releasing would let a crash loop spend without recording.
    return Promise.resolve(rows.map(row => this.write(row, {
      kind: 'estimated',
      inputTokens: row.reserved_tokens,
      outputTokens: 0,
    }, true, now)))
  }

  usage(orgId: OrgIdType, period: PeriodKey): Promise<QuotaUsage> {
    return Promise.resolve(this.standing(orgId, period))
  }

  /** Write one settlement, bounded by what the reservation held. */
  private write(
    reservation: ReservationRow,
    settlement: Settlement,
    reconciled: boolean,
    at: number,
  ): SettlementRecord {
    const [inputTokens, outputTokens] = settlement.kind === 'released'
      ? [0, 0]
      : [settlement.inputTokens, settlement.outputTokens]
    // The reservation is the ceiling. A provider that reports more than the
    // request was allowed to produce, or an estimate that overshoots, is
    // charged what was actually held: anything else would let a settlement
    // spend budget no reservation ever claimed.
    const chargedTokens = Math.min(
      Math.max(inputTokens, 0) + Math.max(outputTokens, 0),
      reservation.reserved_tokens,
    )
    const row: SettlementRow = {
      reservation_id: reservation.id,
      kind: settlement.kind,
      input_tokens: Math.max(inputTokens, 0),
      output_tokens: Math.max(outputTokens, 0),
      charged_tokens: chargedTokens,
      settled_at: at,
      reconciled: reconciled ? 1 : 0,
    }
    this.db.prepare(
      `INSERT INTO settlement
         (reservation_id, kind, input_tokens, output_tokens, charged_tokens, settled_at, reconciled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.reservation_id, row.kind, row.input_tokens, row.output_tokens,
      row.charged_tokens, row.settled_at, row.reconciled,
    )
    return toSettlement(row)
  }

  /** The settlement already recorded for a reservation, when there is one. */
  private settlementOf(id: ReservationIdType): SettlementRecord | undefined {
    const row = this.db.prepare('SELECT * FROM settlement WHERE reservation_id = ?')
      .get(id) as SettlementRow | undefined
    return row === undefined ? undefined : toSettlement(row)
  }

  /** Derive an organization's standing from the rows, never from a running total. */
  private standing(orgId: OrgIdType, period: PeriodKey): QuotaUsage {
    const budget = this.db.prepare('SELECT * FROM budget WHERE org_id = ? AND period = ?')
      .get(orgId, period) as BudgetRow | undefined
    const totals = this.db.prepare(
      `SELECT
         COALESCE(SUM(s.charged_tokens), 0) AS settled,
         COALESCE(SUM(CASE WHEN s.reservation_id IS NULL THEN r.reserved_tokens ELSE 0 END), 0) AS reserved
       FROM reservation r
       LEFT JOIN settlement s ON s.reservation_id = r.id
       WHERE r.org_id = ? AND r.period = ?`,
    ).get(orgId, period) as { settled: number; reserved: number }
    const limitTokens = budget?.limit_tokens
    return {
      orgId: OrgId(orgId),
      period,
      ...(limitTokens === undefined ? {} : { limitTokens }),
      settledTokens: totals.settled,
      reservedTokens: totals.reserved,
      ...(limitTokens === undefined
        ? {}
        : { availableTokens: Math.max(limitTokens - totals.settled - totals.reserved, 0) }),
    }
  }
}

export default SqliteQuota
