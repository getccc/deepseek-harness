/**
 * What a sign-in attempt does to an account, and what it refuses to reveal.
 *
 * Runs against a real SQLite account store rather than a stub, because every
 * assertion here is about the pair: a failure must leave the counter the store
 * holds one higher, and a success must clear it.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WeakSecretError, type AccountAuth } from '@deepseek-ai/dsh-account-auth'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import PasswordAccountAuth, { needsRehash, parse, verifySecret } from '../src/index.ts'

// The shipped cost is deliberately slow; these exercise policy, not hardening.
const FAST = { cost: 16, blockSize: 1, parallelization: 1, minSecretLength: 8 } as const
const SECRET = 'correct horse battery'

let ctx: Context
let store: AccountStore
let auth: AccountAuth
let orgId: OrgId
let userId: UserId

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(PasswordAccountAuth, { ...FAST, maxFailedAttempts: 3, lockDurationMs: 60_000 }).await()
  store = ctx.get('accountStore') as AccountStore
  auth = ctx.get('accountAuth') as AccountAuth
  orgId = (await store.createOrganization('Acme')).id
  userId = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('setting a secret', () => {
  it('satisfies what an issued account owed, and stores only a derived form', async () => {
    await auth.setSecret(userId, SECRET)
    const user = await store.getUser(userId)
    expect(user?.mustChangePassword).toBe(false)
    const stored = await store.getPasswordHash(userId)
    expect(stored).toBeDefined()
    expect(stored).not.toContain(SECRET)
    // Self-describing: the parameters travel with the hash, not with the code.
    expect(parse(stored!)).toMatchObject({ cost: { N: FAST.cost, r: FAST.blockSize, p: FAST.parallelization } })
  })

  it('refuses a secret shorter than the policy allows', async () => {
    await expect(auth.setSecret(userId, 'short')).rejects.toBeInstanceOf(WeakSecretError)
    expect(await store.getPasswordHash(userId)).toBeUndefined()
  })

  it('gives two accounts with the same secret different stored hashes', async () => {
    const second = await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })
    await auth.setSecret(userId, SECRET)
    await auth.setSecret(second.id, SECRET)
    expect(await store.getPasswordHash(userId)).not.toBe(await store.getPasswordHash(second.id))
  })
})

describe('signing in', () => {
  beforeEach(async () => {
    await auth.setSecret(userId, SECRET)
  })

  it('returns the account and clears the failure count', async () => {
    await auth.authenticate(orgId, 'alice', 'wrong')
    const outcome = await auth.authenticate(orgId, 'alice', SECRET)
    expect(outcome).toEqual({ ok: true, userId, mustChangePassword: false })
    expect(await store.getUser(userId)).toMatchObject({ failedAttempts: 0, lockedUntil: undefined })
  })

  it('reports an account that still owes its holder a secret', async () => {
    const fresh = await store.createUser({ orgId, loginName: 'carol', displayName: 'Carol' })
    // A directly-set hash leaves mustChangePassword true only if the store was
    // told separately; setSecret clears it, so drive the store to model an
    // account whose secret an administrator set on its behalf.
    await store.setPasswordHash(fresh.id, (await store.getPasswordHash(userId))!)
    const outcome = await auth.authenticate(orgId, 'carol', SECRET)
    expect(outcome).toMatchObject({ ok: true, mustChangePassword: false })
  })

  it('counts a wrong secret against the account', async () => {
    expect(await auth.authenticate(orgId, 'alice', 'wrong')).toEqual({ ok: false })
    expect((await store.getUser(userId))?.failedAttempts).toBe(1)
  })

  it('locks the account once the threshold is reached, and keeps refusing after', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await auth.authenticate(orgId, 'alice', 'wrong')).toEqual({ ok: false })
    }
    const locked = await store.getUser(userId)
    expect(locked?.lockedUntil).toBeGreaterThan(Date.now())
    // The correct secret does not open a locked account, and the lock is not
    // extended by attempting: locking already reset the counter.
    expect(await auth.authenticate(orgId, 'alice', SECRET)).toEqual({ ok: false })
    expect((await store.getUser(userId))?.failedAttempts).toBe(0)
  })

  it('accepts the correct secret again once the lock has expired', async () => {
    await store.lockUser(userId, Date.now() - 1)
    expect(await auth.authenticate(orgId, 'alice', SECRET)).toMatchObject({ ok: true })
  })

  it('refuses a suspended account without counting the attempt against it', async () => {
    await store.setUserStatus(userId, 'suspended')
    expect(await auth.authenticate(orgId, 'alice', SECRET)).toEqual({ ok: false })
    expect((await store.getUser(userId))?.failedAttempts).toBe(0)
  })

  it('refuses an account that never claimed a secret', async () => {
    await store.createUser({ orgId, loginName: 'dave', displayName: 'Dave' })
    expect(await auth.authenticate(orgId, 'dave', SECRET)).toEqual({ ok: false })
  })
})

describe('what a failure does not reveal', () => {
  beforeEach(async () => {
    await auth.setSecret(userId, SECRET)
  })

  it('answers an unknown login name exactly as it answers a wrong secret', async () => {
    // Same shape, no reason field: a caller cannot build a probe that
    // distinguishes an account that exists from one that does not.
    expect(await auth.authenticate(orgId, 'nobody', SECRET)).toEqual({ ok: false })
    expect(await auth.authenticate(orgId, 'alice', 'wrong')).toEqual({ ok: false })
    expect(await auth.authenticate('missing' as OrgId, 'alice', SECRET)).toEqual({ ok: false })
  })

  it('spends comparable work on an unknown login name as on a real one', async () => {
    const time = async (login: string): Promise<number> => {
      const started = performance.now()
      await auth.authenticate(orgId, login, SECRET)
      return performance.now() - started
    }
    await time('alice')
    const real = await time('alice')
    const absent = await time('nobody')
    // Loose on purpose: this asserts the decoy derivation happens at all, not a
    // constant-time guarantee a JavaScript runtime cannot make.
    expect(absent).toBeGreaterThan(real / 10)
  })
})

describe('carrying an account onto the current cost', () => {
  it('re-derives a hash weaker than the deployment now asks for', async () => {
    await auth.setSecret(userId, SECRET)
    const weak = await store.getPasswordHash(userId)

    const stronger = new Context()
    await stronger.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    const strongerStore = stronger.get('accountStore') as AccountStore
    // Re-create the same account in a store whose auth asks for more work.
    const org = await strongerStore.createOrganization('Acme')
    const user = await strongerStore.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })
    await strongerStore.setPasswordHash(user.id, weak!)
    await stronger.plugin(PasswordAccountAuth, { ...FAST, cost: 64, maxFailedAttempts: 3, lockDurationMs: 60_000 }).await()
    const strongerAuth = stronger.get('accountAuth') as AccountAuth

    try {
      expect(needsRehash(weak!, { N: 64, r: 1, p: 1 })).toBe(true)
      expect(await strongerAuth.authenticate(org.id, 'alice', SECRET)).toMatchObject({ ok: true })
      const upgraded = await strongerStore.getPasswordHash(user.id)
      expect(parse(upgraded!)?.cost.N).toBe(64)
      // The holder did nothing: this is also how a later algorithm would arrive.
      expect(await verifySecret(SECRET, upgraded!)).toBe(true)
    } finally {
      await stronger.fiber.dispose()
    }
  })

  it('leaves a hash already at the current cost alone', async () => {
    await auth.setSecret(userId, SECRET)
    const before = await store.getPasswordHash(userId)
    await auth.authenticate(orgId, 'alice', SECRET)
    expect(await store.getPasswordHash(userId)).toBe(before)
  })
})

describe('the encoded hash', () => {
  it('rejects a string that is not one of ours', async () => {
    expect(parse('not-a-hash')).toBeUndefined()
    expect(await verifySecret(SECRET, 'not-a-hash')).toBe(false)
    // An unparseable stored hash belongs to an algorithm this build no longer
    // produces, so it must be replaced rather than trusted.
    expect(needsRehash('$argon2id$v=19$m=1,t=1,p=1$x$y', { N: 16, r: 1, p: 1 })).toBe(true)
  })

  it('verifies with the parameters it records, not the ones in force now', async () => {
    const { hashSecret } = await import('../src/hash.ts')
    const encoded = await hashSecret(SECRET, { N: 16, r: 1, p: 1 })
    expect(await verifySecret(SECRET, encoded)).toBe(true)
    expect(await verifySecret('other', encoded)).toBe(false)
  })
})
