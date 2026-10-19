/**
 * The reservation and settlement rules.
 *
 * Almost every test here is about the same question asked from a different
 * side: can one request be charged twice, or charged more than it was allowed
 * to spend? A ledger that answers "no" only when its callers behave is not a
 * ledger.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import {
  ReservationRefusedError,
  UnknownReservationError,
  type Quota,
  type ReservationId,
  type ReservationRequest,
} from '@deepseek-ai/dsh-quota'
import SqliteQuota, { QUOTA_SQLITE_APPLICATION_ID, SCHEMA_VERSION, type Config } from '../src/index.ts'
import { applySchema } from '../src/schema.ts'

const orgId = OrgId('org-1')
const alice = UserId('user-alice')
const PERIOD = '2026-08'

let ctx: Context
let quota: Quota

/** Mount a ledger with its own database. */
async function mount(config: Partial<Config> = {}): Promise<Quota> {
  const fiber = new Context()
  await fiber.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 300_000, ...config }).await()
  return fiber.get('quota') as Quota
}

/** A well-formed reservation request, which each test then varies. */
function request(patch: Partial<ReservationRequest> = {}): ReservationRequest {
  return {
    orgId,
    period: PERIOD,
    principalId: alice,
    modelRef: 'deepseek-v4',
    inputTokens: 100,
    maxOutputTokens: 900,
    ...patch,
  }
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 300_000 }).await()
  quota = ctx.get('quota') as Quota
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('holding a claim', () => {
  it('reserves the input plus the most output the request may produce', async () => {
    await quota.setLimit(orgId, PERIOD, 10_000)
    const held = await quota.reserve(request())
    expect(held.reservedTokens).toBe(1_000)
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({
      limitTokens: 10_000,
      settledTokens: 0,
      reservedTokens: 1_000,
      availableTokens: 9_000,
    })
  })

  it('refuses a request the remaining budget cannot cover', async () => {
    await quota.setLimit(orgId, PERIOD, 1_500)
    await quota.reserve(request())
    // 1000 held, 500 left, and this asks for 1000.
    await expect(quota.reserve(request())).rejects.toMatchObject({ reason: 'exceeded' })
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(1_000)
  })

  it('lets an unlimited organization reserve, rather than limiting it to zero', async () => {
    const held = await quota.reserve(request())
    expect(held.reservedTokens).toBe(1_000)
    const standing = await quota.usage(orgId, PERIOD)
    expect(standing.limitTokens).toBeUndefined()
    expect(standing.availableTokens).toBeUndefined()
    expect(standing.reservedTokens).toBe(1_000)
  })

  it('refuses a request for a nonsensical number of tokens', async () => {
    for (const patch of [
      { inputTokens: -1 },
      { maxOutputTokens: -1 },
      { inputTokens: 1.5 },
      { inputTokens: 0, maxOutputTokens: 0 },
      { inputTokens: Number.MAX_SAFE_INTEGER + 2 },
    ]) {
      await expect(quota.reserve(request(patch)), JSON.stringify(patch))
        .rejects.toBeInstanceOf(ReservationRefusedError)
    }
  })

  it('keeps periods apart', async () => {
    await quota.setLimit(orgId, PERIOD, 1_000)
    await quota.setLimit(orgId, '2026-09', 1_000)
    await quota.reserve(request())
    await expect(quota.reserve(request())).rejects.toMatchObject({ reason: 'exceeded' })
    // Next month's budget is untouched by this month's spending.
    await expect(quota.reserve(request({ period: '2026-09' }))).resolves.toMatchObject({ period: '2026-09' })
  })
})

describe('settling once', () => {
  it('charges what the provider reported', async () => {
    await quota.setLimit(orgId, PERIOD, 10_000)
    const held = await quota.reserve(request())
    const settled = await quota.settle(held.id, { kind: 'reported', inputTokens: 100, outputTokens: 250 })
    expect(settled).toMatchObject({ kind: 'reported', chargedTokens: 350, reconciled: false })
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({
      settledTokens: 350,
      reservedTokens: 0,
      availableTokens: 9_650,
    })
  })

  it('changes no balance when the same reservation is settled again', async () => {
    await quota.setLimit(orgId, PERIOD, 10_000)
    const held = await quota.reserve(request())
    const first = await quota.settle(held.id, { kind: 'reported', inputTokens: 100, outputTokens: 250 })
    // A caller that crashed after settling retries; the record stands.
    const again = await quota.settle(held.id, { kind: 'reported', inputTokens: 100, outputTokens: 900 })
    expect(again).toEqual(first)
    expect((await quota.usage(orgId, PERIOD)).settledTokens).toBe(350)
  })

  it('returns the whole claim when the upstream did not accept the request', async () => {
    await quota.setLimit(orgId, PERIOD, 10_000)
    const held = await quota.reserve(request())
    const settled = await quota.settle(held.id, { kind: 'released' })
    expect(settled).toMatchObject({ kind: 'released', chargedTokens: 0, inputTokens: 0, outputTokens: 0 })
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({ settledTokens: 0, availableTokens: 10_000 })
  })

  it('marks an estimate as one, so an invoice can be reconciled against the rest', async () => {
    await quota.setLimit(orgId, PERIOD, 10_000)
    const held = await quota.reserve(request())
    const settled = await quota.settle(held.id, { kind: 'estimated', inputTokens: 100, outputTokens: 400 })
    expect(settled).toMatchObject({ kind: 'estimated', chargedTokens: 500 })
  })

  it('never charges more than the reservation held', async () => {
    await quota.setLimit(orgId, PERIOD, 10_000)
    const held = await quota.reserve(request())
    // A provider reporting more than the request was allowed to produce, or an
    // estimate that overshoots, cannot spend budget no reservation claimed.
    const settled = await quota.settle(held.id, { kind: 'reported', inputTokens: 100, outputTokens: 99_999 })
    expect(settled.chargedTokens).toBe(held.reservedTokens)
    expect((await quota.usage(orgId, PERIOD)).settledTokens).toBe(1_000)
  })

  it('refuses to settle a reservation the ledger does not hold', async () => {
    await expect(quota.settle('no-such-reservation' as ReservationId, { kind: 'released' }))
      .rejects.toBeInstanceOf(UnknownReservationError)
  })
})

describe('reconciling what nobody settled', () => {
  it('charges an expired reservation rather than releasing it', async () => {
    const brief = await mount({ reservationTtlMs: 1 })
    await brief.setLimit(orgId, PERIOD, 10_000)
    const held = await brief.reserve(request())
    const written = await brief.reconcile(held.expiresAt)
    // Releasing would let a crash loop spend the upstream's tokens without
    // ever recording that it did.
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      reservationId: held.id,
      kind: 'estimated',
      chargedTokens: held.reservedTokens,
      reconciled: true,
    })
    expect(await brief.usage(orgId, PERIOD)).toMatchObject({ settledTokens: 1_000, reservedTokens: 0 })
  })

  it('leaves a reservation that is still within its window', async () => {
    const held = await quota.reserve(request())
    expect(await quota.reconcile(held.expiresAt - 1)).toEqual([])
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(1_000)
  })

  it('leaves a reservation the caller already settled', async () => {
    const brief = await mount({ reservationTtlMs: 1 })
    const held = await brief.reserve(request())
    await brief.settle(held.id, { kind: 'reported', inputTokens: 10, outputTokens: 20 })
    expect(await brief.reconcile(held.expiresAt + 1_000)).toEqual([])
    expect((await brief.usage(orgId, PERIOD)).settledTokens).toBe(30)
  })

  it('does not charge twice when a caller settles after the reconciler did', async () => {
    const brief = await mount({ reservationTtlMs: 1 })
    await brief.setLimit(orgId, PERIOD, 10_000)
    const held = await brief.reserve(request())
    const [reconciled] = await brief.reconcile(held.expiresAt)
    // The slow caller finally reports real usage. The reconciler already
    // answered, and a second answer would spend the budget twice.
    const late = await brief.settle(held.id, { kind: 'reported', inputTokens: 100, outputTokens: 3 })
    expect(late).toEqual(reconciled)
    expect((await brief.usage(orgId, PERIOD)).settledTokens).toBe(1_000)
  })

  it('reconciles twice without charging twice', async () => {
    const brief = await mount({ reservationTtlMs: 1 })
    const held = await brief.reserve(request())
    expect(await brief.reconcile(held.expiresAt)).toHaveLength(1)
    expect(await brief.reconcile(held.expiresAt)).toEqual([])
    expect((await brief.usage(orgId, PERIOD)).settledTokens).toBe(1_000)
  })
})

describe('the limit', () => {
  it('can be raised, lowered, and removed without touching what is recorded', async () => {
    await quota.setLimit(orgId, PERIOD, 1_000)
    const held = await quota.reserve(request())
    await quota.settle(held.id, { kind: 'reported', inputTokens: 100, outputTokens: 100 })
    await quota.setLimit(orgId, PERIOD, 500)
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({
      limitTokens: 500, settledTokens: 200, availableTokens: 300,
    })
    await quota.setLimit(orgId, PERIOD, undefined)
    const unlimited = await quota.usage(orgId, PERIOD)
    expect(unlimited.limitTokens).toBeUndefined()
    expect(unlimited.settledTokens).toBe(200)
  })

  it('reports nothing available rather than a negative balance', async () => {
    await quota.setLimit(orgId, PERIOD, 10_000)
    const held = await quota.reserve(request({ maxOutputTokens: 9_900 }))
    await quota.settle(held.id, { kind: 'reported', inputTokens: 100, outputTokens: 9_900 })
    await quota.setLimit(orgId, PERIOD, 100)
    expect((await quota.usage(orgId, PERIOD)).availableTokens).toBe(0)
  })

  it('refuses a nonsensical limit', async () => {
    await expect(quota.setLimit(orgId, PERIOD, -1)).rejects.toBeInstanceOf(ReservationRefusedError)
    await expect(quota.setLimit(orgId, PERIOD, 1.5)).rejects.toBeInstanceOf(ReservationRefusedError)
  })
})

describe('the database refuses what the ledger refuses', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-quota-'))
    path = join(dir, 'quota.sqlite')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a second settlement for one reservation, even written directly', async () => {
    const fiber = new Context()
    await fiber.plugin(SqliteQuota, { path, reservationTtlMs: 300_000 }).await()
    const ledger = fiber.get('quota') as Quota
    const held = await ledger.reserve(request())
    await ledger.settle(held.id, { kind: 'reported', inputTokens: 10, outputTokens: 20 })

    const db = new DatabaseSync(path)
    db.exec('PRAGMA foreign_keys = ON')
    // The primary key is what makes settlement idempotent: nothing, service or
    // not, can charge one request twice.
    expect(() => db.prepare(
      `INSERT INTO settlement (reservation_id, kind, input_tokens, output_tokens, charged_tokens, settled_at, reconciled)
       VALUES (?, 'reported', 1, 1, 2, 0, 0)`,
    ).run(held.id)).toThrow(/UNIQUE|PRIMARY/u)
    expect(() => db.prepare(
      `INSERT INTO settlement (reservation_id, kind, input_tokens, output_tokens, charged_tokens, settled_at, reconciled)
       VALUES ('no-such-reservation', 'reported', 1, 1, 2, 0, 0)`,
    ).run()).toThrow(/FOREIGN KEY/u)
    db.close()
    await fiber.fiber.dispose()
  })

  it('rejects a settlement kind and a token count outside what the ledger records', async () => {
    const db = new DatabaseSync(path)
    applySchema(db)
    db.prepare(
      `INSERT INTO reservation (id, org_id, period, principal_id, model_ref, reserved_tokens, created_at, expires_at)
       VALUES ('r', 'o', 'p', 'u', 'm', 10, 0, 0)`,
    ).run()
    const insert = db.prepare(
      `INSERT INTO settlement (reservation_id, kind, input_tokens, output_tokens, charged_tokens, settled_at, reconciled)
       VALUES ('r', ?, ?, ?, ?, 0, 0)`,
    )
    expect(() => insert.run('invented', 1, 1, 2)).toThrow(/CHECK/u)
    expect(() => insert.run('reported', -1, 1, 0)).toThrow(/CHECK/u)
    expect(() => db.prepare(
      `INSERT INTO reservation (id, org_id, period, principal_id, model_ref, reserved_tokens, created_at, expires_at)
       VALUES ('r2', 'o', 'p', 'u', 'm', 0, 0, 0)`,
    ).run()).toThrow(/CHECK/u)
    db.close()
  })

  it('stamps the application id and schema version, and refuses foreign or newer files', () => {
    const db = new DatabaseSync(path)
    applySchema(db)
    expect((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id)
      .toBe(QUOTA_SQLITE_APPLICATION_ID)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => { applySchema(db) }).toThrow(/newer than this build/u)
    db.close()

    const foreign = new DatabaseSync(join(dir, 'other.sqlite'))
    foreign.exec('PRAGMA application_id = 12345')
    expect(() => { applySchema(foreign) }).toThrow(/another application/u)
    foreign.close()
  })
})

describe('reporting usage', () => {
  const bob = UserId('user-bob')
  const HOUR = 3_600_000
  const DAY = 24 * HOUR
  /** A Monday midnight UTC, so every offset below is easy to read. */
  const T0 = Date.UTC(2026, 7, 3)

  /** Send and settle one call at a chosen moment. */
  async function call(
    at: number,
    who: ReturnType<typeof UserId>,
    tokens: { inputTokens: number; outputTokens: number } | 'released' | 'estimated',
    patch: Partial<ReservationRequest> = {},
  ): Promise<ReservationId> {
    vi.setSystemTime(at)
    const held = await quota.reserve(request({ principalId: who, ...patch }))
    if (tokens === 'released') await quota.settle(held.id, { kind: 'released' })
    else if (tokens === 'estimated') await quota.settle(held.id, { kind: 'estimated', inputTokens: 10, outputTokens: 20 })
    else await quota.settle(held.id, { kind: 'reported', ...tokens })
    return held.id
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('totals each account in the window, largest spender first', async () => {
    await call(T0 + HOUR, alice, { inputTokens: 100, outputTokens: 50 })
    await call(T0 + 2 * HOUR, alice, { inputTokens: 10, outputTokens: 5 })
    await call(T0 + 3 * HOUR, bob, { inputTokens: 400, outputTokens: 100 })
    expect(await quota.usageByPrincipal({ orgId, from: T0, to: T0 + DAY })).toEqual([
      { principalId: bob, calls: 1, inputTokens: 400, outputTokens: 100, chargedTokens: 500, lastCallAt: T0 + 3 * HOUR },
      { principalId: alice, calls: 2, inputTokens: 110, outputTokens: 55, chargedTokens: 165, lastCallAt: T0 + 2 * HOUR },
    ])
  })

  it('places a call in the window by when it was sent, and ends the window before its last moment', async () => {
    await call(T0, alice, { inputTokens: 1, outputTokens: 1 })
    await call(T0 + DAY, alice, { inputTokens: 1, outputTokens: 1 })
    vi.setSystemTime(T0 + DAY - 1)
    const lateStarted = await quota.reserve(request())
    // Settled after the window ended: it still belongs to the day it was sent.
    vi.setSystemTime(T0 + DAY + HOUR)
    await quota.settle(lateStarted.id, { kind: 'reported', inputTokens: 5, outputTokens: 5 })
    const [alicesDay] = await quota.usageByPrincipal({ orgId, from: T0, to: T0 + DAY })
    expect(alicesDay).toMatchObject({ calls: 2, chargedTokens: 12 })
  })

  it('leaves out released calls, unsettled reservations, and other organizations', async () => {
    await call(T0 + HOUR, alice, 'released')
    vi.setSystemTime(T0 + 2 * HOUR)
    await quota.reserve(request())
    await call(T0 + 3 * HOUR, alice, { inputTokens: 1, outputTokens: 1 }, { orgId: OrgId('org-2') })
    const window = { orgId, from: T0, to: T0 + DAY }
    expect(await quota.usageByPrincipal(window)).toEqual([])
    expect(await quota.usageRecords({ ...window, limit: 10, offset: 0 })).toEqual({ records: [], total: 0 })
    expect(await quota.usageSeries({ ...window, bucketMs: HOUR, utcOffsetMs: 0 })).toEqual([])
  })

  it('cuts the window into buckets that start at the reader\'s local midnight', async () => {
    await call(T0 + 20 * HOUR, alice, { inputTokens: 10, outputTokens: 0 })
    await call(T0 + 22 * HOUR, alice, { inputTokens: 20, outputTokens: 0 })
    await call(T0 + 30 * HOUR, alice, { inputTokens: 40, outputTokens: 0 })
    const window = { orgId, from: T0, to: T0 + 3 * DAY, bucketMs: DAY }
    expect(await quota.usageSeries({ ...window, utcOffsetMs: 0 })).toEqual([
      { start: T0, calls: 2, inputTokens: 30, outputTokens: 0, chargedTokens: 30 },
      { start: T0 + DAY, calls: 1, inputTokens: 40, outputTokens: 0, chargedTokens: 40 },
    ])
    // UTC+8: all three calls fall on one local day, which began at 16:00 UTC.
    expect(await quota.usageSeries({ ...window, utcOffsetMs: 8 * HOUR })).toEqual([
      { start: T0 + 16 * HOUR, calls: 3, inputTokens: 70, outputTokens: 0, chargedTokens: 70 },
    ])
  })

  it('narrows a series and the records to one account', async () => {
    await call(T0 + HOUR, alice, { inputTokens: 1, outputTokens: 1 })
    await call(T0 + 2 * HOUR, bob, { inputTokens: 5, outputTokens: 5 })
    const window = { orgId, from: T0, to: T0 + DAY, principalId: bob }
    expect(await quota.usageSeries({ ...window, bucketMs: DAY, utcOffsetMs: 0 }))
      .toEqual([{ start: T0, calls: 1, inputTokens: 5, outputTokens: 5, chargedTokens: 10 }])
    const page = await quota.usageRecords({ ...window, limit: 10, offset: 0 })
    expect(page.total).toBe(1)
    expect(page.records[0]).toMatchObject({ principalId: bob, chargedTokens: 10 })
  })

  it('lists calls newest first in pages, with the total across all of them', async () => {
    const ids = [
      await call(T0 + HOUR, alice, { inputTokens: 1, outputTokens: 0 }),
      await call(T0 + 2 * HOUR, alice, { inputTokens: 2, outputTokens: 0 }),
      await call(T0 + 3 * HOUR, alice, { inputTokens: 3, outputTokens: 0 }),
    ]
    const window = { orgId, from: T0, to: T0 + DAY }
    const first = await quota.usageRecords({ ...window, limit: 2, offset: 0 })
    expect(first.total).toBe(3)
    expect(first.records.map(record => record.reservationId)).toEqual([ids[2], ids[1]])
    const second = await quota.usageRecords({ ...window, limit: 2, offset: 2 })
    expect(second.records.map(record => record.reservationId)).toEqual([ids[0]])
  })

  it('shows what a record needs to be read on its own', async () => {
    await call(T0 + HOUR, alice, 'estimated', { deviceId: 'device-1', modelRef: 'deepseek-v4-pro' })
    await call(T0 + 2 * HOUR, alice, { inputTokens: 7, outputTokens: 3 })
    vi.setSystemTime(T0 + 3 * HOUR)
    await quota.reserve(request())
    vi.setSystemTime(T0 + 3 * HOUR + 301_000)
    // The reconciler charges the whole reservation of a call nobody settled.
    await quota.reconcile(Date.now())
    const { records } = await quota.usageRecords({ orgId, from: T0, to: T0 + DAY, limit: 10, offset: 0 })
    expect(records.map(record => [record.kind, record.reconciled, record.chargedTokens])).toEqual([
      ['estimated', true, 1_000],
      ['reported', false, 10],
      ['estimated', false, 30],
    ])
    expect(records[2]).toMatchObject({
      deviceId: 'device-1', modelRef: 'deepseek-v4-pro', createdAt: T0 + HOUR, settledAt: T0 + HOUR,
    })
    expect(records[1]).not.toHaveProperty('deviceId')
  })

  it('upgrades a version 1 ledger in place and keeps its rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'quota-sqlite-upgrade-'))
    try {
      const path = join(root, 'quota.sqlite')
      const old = new DatabaseSync(path)
      applySchema(old)
      old.exec('DROP INDEX reservation_created')
      old.exec('PRAGMA user_version = 1')
      old.prepare(
        `INSERT INTO reservation (id, org_id, period, principal_id, model_ref, reserved_tokens, created_at, expires_at)
         VALUES ('r1', 'org-1', ?, 'user-alice', 'm', 10, ?, ?)`,
      ).run(PERIOD, T0 + HOUR, T0 + 2 * HOUR)
      old.exec(`INSERT INTO settlement VALUES ('r1', 'reported', 4, 6, 10, ${T0 + HOUR}, 0)`)
      old.close()
      const opened = new Context()
      await opened.plugin(SqliteQuota, { path, reservationTtlMs: 300_000 }).await()
      const upgraded = opened.get('quota') as Quota
      expect(await upgraded.usageByPrincipal({ orgId, from: T0, to: T0 + DAY })).toHaveLength(1)
      await opened.fiber.dispose()
      const probe = new DatabaseSync(path)
      expect(probe.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: SCHEMA_VERSION })
      expect(probe.prepare("SELECT name FROM sqlite_master WHERE name = 'reservation_created'").get())
        .toBeDefined()
      probe.close()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the database file', () => {
  it('writes ahead of the database unless a rollback journal is configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'quota-sqlite-journal-'))
    try {
      for (const journalMode of ['wal', 'delete'] as const) {
        const path = join(root, `${journalMode}.sqlite`)
        const mode = journalMode === 'wal' ? {} : { journalMode }
        const opened = new Context()
        await opened.plugin(SqliteQuota, { path, reservationTtlMs: 300_000, ...mode }).await()
        const probe = new DatabaseSync(path)
        expect(probe.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: journalMode })
        probe.close()
        await opened.fiber.dispose()
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
