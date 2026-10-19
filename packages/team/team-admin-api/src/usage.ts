/**
 * Reading a usage query and shaping the ledger's answer for the console.
 * @module @deepseek-ai/dsh-team-admin-api/usage
 */

import type { AccountUser } from '@deepseek-ai/dsh-account-store'
import type { PrincipalUsage, UsageBucket, UsageRecord } from '@deepseek-ai/dsh-quota'
import type { WireMemberUsage, WireUsageBucket, WireUsageRecord } from './types.ts'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** The longest range one usage report covers. */
export const MAX_USAGE_WINDOW_MS = 366 * DAY_MS

/** Ranges up to this long are cut into hours; longer ones into days. */
const HOURLY_WINDOW_MS = 2 * DAY_MS

/** The largest page of call records one request may ask for. */
export const MAX_USAGE_PAGE = 200

/** The page size of a records request that names none. */
const DEFAULT_USAGE_PAGE = 20

/** The widest UTC offsets in use, in minutes, so a reader's clock offset is plausible. */
const MIN_OFFSET_MINUTES = -720
const MAX_OFFSET_MINUTES = 840

/** What a usage request asks for, once its address has been read. */
export interface UsageQuery {
  readonly from: number
  readonly to: number
  /** One bucket's length, derived from the range so a request cannot ask for thousands. */
  readonly bucketMs: number
  readonly utcOffsetMs: number
  /** Only this account's calls, when the request names one. */
  readonly memberId?: string
  readonly limit: number
  readonly offset: number
}

/** Read one query-string field as a non-negative whole number. */
function whole(params: URLSearchParams, name: string): number | undefined | 'invalid' {
  const raw = params.get(name)
  if (raw === null) return undefined
  return /^\d{1,15}$/u.test(raw) ? Number(raw) : 'invalid'
}

/**
 * Read a usage request's query string.
 *
 * Strict rather than clamped: a range the console never sends means a script
 * or a stale page, and quietly answering a different range would put the wrong
 * numbers in front of an administrator.
 * @param params - the request's query string.
 * @returns the query, or undefined when any field is missing where required, malformed, or out of range.
 */
export function readUsageQuery(params: URLSearchParams): UsageQuery | undefined {
  const from = whole(params, 'from')
  const to = whole(params, 'to')
  const limit = whole(params, 'limit') ?? DEFAULT_USAGE_PAGE
  const offset = whole(params, 'offset') ?? 0
  if (from === undefined || to === undefined || from === 'invalid' || to === 'invalid') return undefined
  if (limit === 'invalid' || offset === 'invalid' || limit < 1 || limit > MAX_USAGE_PAGE) return undefined
  if (to <= from || to - from > MAX_USAGE_WINDOW_MS) return undefined
  const rawOffset = params.get('utcOffsetMinutes')
  const utcOffsetMinutes = rawOffset === null ? 0 : Number(rawOffset)
  if (
    !Number.isInteger(utcOffsetMinutes)
    || utcOffsetMinutes < MIN_OFFSET_MINUTES || utcOffsetMinutes > MAX_OFFSET_MINUTES
  ) return undefined
  const memberId = params.get('member')
  return {
    from,
    to,
    bucketMs: to - from <= HOURLY_WINDOW_MS ? HOUR_MS : DAY_MS,
    utcOffsetMs: utcOffsetMinutes * 60_000,
    ...(memberId === null || memberId === '' ? {} : { memberId }),
    limit,
    offset,
  }
}

/**
 * One account's spending as a table row.
 * @param member - the account, or undefined when it has since been deleted.
 * @param departmentName - the name of the department the account sits in.
 * @param usage - what the ledger recorded for it, or undefined when it spent nothing.
 * @param principalId - the account id, which survives the account's deletion.
 * @returns the row.
 */
export function wireMemberUsage(
  principalId: string,
  member: AccountUser | undefined,
  departmentName: string | undefined,
  usage: PrincipalUsage | undefined,
): WireMemberUsage {
  return {
    memberId: principalId,
    ...(member === undefined ? {} : { loginName: member.loginName, displayName: member.displayName }),
    ...(departmentName === undefined ? {} : { departmentName }),
    calls: usage?.calls ?? 0,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    chargedTokens: usage?.chargedTokens ?? 0,
    ...(usage === undefined ? {} : { lastCallAt: usage.lastCallAt }),
  }
}

/** One time bucket as the console reads it. */
export function wireUsageBucket(bucket: UsageBucket): WireUsageBucket {
  return {
    start: bucket.start,
    calls: bucket.calls,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    chargedTokens: bucket.chargedTokens,
  }
}

/**
 * One settled call as the console reads it.
 * @param record - the ledger's record.
 * @param displayName - the name of the account that sent it, when the account still exists.
 * @returns the row.
 */
export function wireUsageRecord(record: UsageRecord, displayName: string | undefined): WireUsageRecord {
  return {
    id: record.reservationId,
    memberId: record.principalId,
    ...(displayName === undefined ? {} : { displayName }),
    modelRef: record.modelRef,
    ...(record.deviceId === undefined ? {} : { deviceId: record.deviceId }),
    kind: record.kind,
    reconciled: record.reconciled,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    chargedTokens: record.chargedTokens,
    startedAt: record.createdAt,
    settledAt: record.settledAt,
  }
}
