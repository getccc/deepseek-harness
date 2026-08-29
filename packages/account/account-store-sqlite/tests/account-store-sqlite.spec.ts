/**
 * The SQLite account store's durable behavior: what it stores, what it refuses,
 * and which failures it reports as the seam's own errors rather than SQLite's.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DuplicateLoginNameError,
  UnknownAccountUserError,
  UserId,
  type AccountStore,
  type OrgId,
} from '@deepseek-ai/dsh-account-store'
import SqliteAccountStore, {
  ACCOUNT_STORE_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
} from '../src/index.ts'
import { applySchema } from '../src/schema.ts'

let ctx: Context
let store: AccountStore
let orgId: OrgId
let dir: string

async function mount(path: string): Promise<{ ctx: Context; store: AccountStore }> {
  const mountCtx = new Context()
  const fiber = mountCtx.plugin(SqliteAccountStore, { path })
  await fiber.await()
  return { ctx: mountCtx, store: mountCtx.get('accountStore') as AccountStore }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'account-store-sqlite-'))
  const mounted = await mount(':memory:')
  ctx = mounted.ctx
  store = mounted.store
  orgId = (await store.createOrganization('Acme')).id
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(dir, { force: true, recursive: true })
})

describe('organizations', () => {
  it('stores an organization at revision zero and reads it back', async () => {
    const org = await store.createOrganization('Second')
    expect(org).toMatchObject({ name: 'Second', policyRevision: 0n })
    expect(await store.getOrganization(org.id)).toEqual(org)
  })

  it('returns undefined for an organization it does not hold', async () => {
    expect(await store.getOrganization('missing' as OrgId)).toBeUndefined()
  })

  it('advances the policy revision monotonically', async () => {
    expect(await store.bumpPolicyRevision(orgId)).toBe(1n)
    expect(await store.bumpPolicyRevision(orgId)).toBe(2n)
    expect((await store.getOrganization(orgId))?.policyRevision).toBe(2n)
  })

  it('refuses to advance a revision for an organization it does not hold', async () => {
    await expect(store.bumpPolicyRevision('missing' as OrgId)).rejects.toThrow(/unknown organization/u)
  })
})

describe('accounts', () => {
  it('issues an account that cannot yet authenticate', async () => {
    const user = await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    // An administrator supplies identity, never a secret.
    expect(user).toMatchObject({
      loginName: 'alice',
      displayName: 'Alice',
      email: undefined,
      status: 'active',
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: undefined,
      lastLoginAt: undefined,
    })
    expect(await store.getPasswordHash(user.id)).toBeUndefined()
    expect(await store.getUser(user.id)).toEqual(user)
  })

  it('keeps an optional email when one is supplied', async () => {
    const user = await store.createUser({
      orgId, loginName: 'bob', displayName: 'Bob', email: 'bob@example.com',
    })
    expect(user.email).toBe('bob@example.com')
  })

  it('reports a taken login name as the seam error, not SQLite\'s', async () => {
    await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    await expect(store.createUser({ orgId, loginName: 'alice', displayName: 'Other' }))
      .rejects.toBeInstanceOf(DuplicateLoginNameError)
  })

  it('scopes login-name uniqueness to one organization', async () => {
    const other = await store.createOrganization('Other')
    await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    // Two organizations may each have an "alice"; what must be unique is what a
    // sign-in attempt resolves against.
    const twin = await store.createUser({ orgId: other.id, loginName: 'alice', displayName: 'Alice' })
    expect(twin.orgId).toBe(other.id)
  })

  it('lets any other insert failure surface unchanged', async () => {
    // A foreign key to an organization that does not exist is not a duplicate
    // login name, so it must not be reported as one.
    await expect(store.createUser({ orgId: 'missing' as OrgId, loginName: 'x', displayName: 'X' }))
      .rejects.not.toBeInstanceOf(DuplicateLoginNameError)
  })

  it('resolves a sign-in name and reports an unknown one as absent', async () => {
    const user = await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    expect(await store.findUserByLogin(orgId, 'alice')).toEqual(user)
    expect(await store.findUserByLogin(orgId, 'nobody')).toBeUndefined()
    expect(await store.getUser('missing' as unknown as ReturnType<typeof UserId>)).toBeUndefined()
  })

  it('lists an organization in creation order', async () => {
    await store.createUser({ orgId, loginName: 'first', displayName: 'First' })
    await store.createUser({ orgId, loginName: 'second', displayName: 'Second' })
    expect((await store.listUsers(orgId)).map(user => user.loginName)).toEqual(['first', 'second'])
    expect(await store.listUsers('missing' as OrgId)).toEqual([])
  })

  it('suspends and restores an account without touching anything else', async () => {
    const user = await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    await store.setUserStatus(user.id, 'suspended')
    expect((await store.getUser(user.id))?.status).toBe('suspended')
    await store.setUserStatus(user.id, 'active')
    const restored = await store.getUser(user.id)
    expect(restored?.status).toBe('active')
    expect(restored?.loginName).toBe(user.loginName)
  })
})

describe('authentication material', () => {
  it('stores the provider\'s encoded hash verbatim and satisfies the password requirement', async () => {
    const user = await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    const encoded = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$hash'
    await store.setPasswordHash(user.id, encoded)
    // Stored opaquely: the store never parses or normalizes what it was given.
    expect(await store.getPasswordHash(user.id)).toBe(encoded)
    expect((await store.getUser(user.id))?.mustChangePassword).toBe(false)
  })

  it('reports no material for an account it does not hold', async () => {
    expect(await store.getPasswordHash(UserId('missing'))).toBeUndefined()
  })
})

describe('sign-in state', () => {
  it('counts consecutive failures and clears them on success', async () => {
    const user = await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    expect(await store.recordFailedLogin(user.id)).toBe(1)
    expect(await store.recordFailedLogin(user.id)).toBe(2)
    await store.recordSuccessfulLogin(user.id, 1_700_000_000_000)
    const after = await store.getUser(user.id)
    expect(after).toMatchObject({ failedAttempts: 0, lockedUntil: undefined, lastLoginAt: 1_700_000_000_000 })
  })

  it('resets the failure count when locking, so the next lockout needs fresh failures', async () => {
    const user = await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    await store.recordFailedLogin(user.id)
    await store.lockUser(user.id, 1_700_000_600_000)
    expect(await store.getUser(user.id)).toMatchObject({ lockedUntil: 1_700_000_600_000, failedAttempts: 0 })
  })

  it('clears an active lock on a successful sign-in', async () => {
    const user = await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })
    await store.lockUser(user.id, 1_700_000_600_000)
    await store.recordSuccessfulLogin(user.id, 1_700_000_700_000)
    expect((await store.getUser(user.id))?.lockedUntil).toBeUndefined()
  })

  it.each([
    ['setUserStatus', (s: AccountStore) => s.setUserStatus(UserId('missing'), 'suspended')],
    ['setPasswordHash', (s: AccountStore) => s.setPasswordHash(UserId('missing'), 'x')],
    ['recordFailedLogin', (s: AccountStore) => s.recordFailedLogin(UserId('missing'))],
    ['lockUser', (s: AccountStore) => s.lockUser(UserId('missing'), 1)],
    ['recordSuccessfulLogin', (s: AccountStore) => s.recordSuccessfulLogin(UserId('missing'), 1)],
  ])('reports %s against an unknown account as the seam error', async (_name, call) => {
    await expect(call(store)).rejects.toBeInstanceOf(UnknownAccountUserError)
  })
})

describe('durability and schema ownership', () => {
  it('keeps accounts across a remount of the same file', async () => {
    const path = join(dir, 'accounts.db')
    const first = await mount(path)
    const org = await first.store.createOrganization('Acme')
    await first.store.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })
    await first.ctx.fiber.dispose()

    const second = await mount(path)
    try {
      expect((await second.store.listUsers(org.id)).map(user => user.loginName)).toEqual(['alice'])
    } finally {
      await second.ctx.fiber.dispose()
    }
  })

  it('stamps its application id and schema version', async () => {
    const path = join(dir, 'stamped.db')
    const mounted = await mount(path)
    await mounted.ctx.fiber.dispose()
    const db = new DatabaseSync(path)
    try {
      expect(db.prepare('PRAGMA application_id').get())
        .toMatchObject({ application_id: ACCOUNT_STORE_SQLITE_APPLICATION_ID })
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: SCHEMA_VERSION })
    } finally {
      db.close()
    }
  })

  it('refuses a database another application stamped', () => {
    const db = new DatabaseSync(join(dir, 'foreign.db'))
    try {
      db.exec('PRAGMA application_id = 305419896')
      expect(() => { applySchema(db) }).toThrow(/belongs to another application/u)
    } finally {
      db.close()
    }
  })

  it('refuses a database a newer build wrote', () => {
    const db = new DatabaseSync(join(dir, 'newer.db'))
    try {
      db.exec(`PRAGMA application_id = ${ACCOUNT_STORE_SQLITE_APPLICATION_ID}`)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
      // A downgrade cannot know what a column it has never seen means, so it
      // refuses rather than migrating down.
      expect(() => { applySchema(db) }).toThrow(/newer than this build/u)
    } finally {
      db.close()
    }
  })
})
