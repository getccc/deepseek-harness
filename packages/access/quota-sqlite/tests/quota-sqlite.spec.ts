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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
