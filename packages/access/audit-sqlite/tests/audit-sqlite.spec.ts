/**
 * The stored trail: what the service accepts, what the schema refuses on its
 * own, and what a reader gets back.
 *
 * Several tests open a second connection to the same file and write raw SQL.
 * That is the point of them: the claim is not that the service declines to
 * store a prompt, but that the database does.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import {
  InvalidAuditValueError,
  MetadataKeyNotAllowedError,
  UnknownAuditActionError,
  UnknownMetadataKeyError,
  type Audit,
  type AuditRecord,
} from '@deepseek-ai/dsh-audit'
import SqliteAudit, { AUDIT_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from '../src/index.ts'
import { applySchema } from '../src/schema.ts'

let dir: string
let path: string
let ctx: Context
let audit: Audit

const orgId = OrgId('org-1')
const other = OrgId('org-2')
const alice = UserId('user-alice')
const bob = UserId('user-bob')

/** A minimal well-formed record, which each test then varies. */
function record(patch: Partial<AuditRecord> = {}): AuditRecord {
  return { orgId, action: 'member.login', outcome: 'allowed', ...patch }
}

/** A second connection to the same file, standing in for a caller that skipped the service. */
function raw(): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-audit-'))
  path = join(dir, 'audit.sqlite')
  ctx = new Context()
  await ctx.plugin(SqliteAudit, { path, maxQueryRows: 100 }).await()
  audit = ctx.get('audit') as Audit
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(dir, { recursive: true, force: true })
})

describe('recording', () => {
  it('assigns the sequence and the time, which no caller supplies', async () => {
    const before = Date.now()
    const first = await audit.record(record())
    const second = await audit.record(record({ action: 'member.logout' }))
    expect(second.seq).toBeGreaterThan(first.seq)
    expect(first.at).toBeGreaterThanOrEqual(before)
    expect(first.at).toBeLessThanOrEqual(Date.now())
  })

  it('takes the resource type from the action catalog, not from the caller', async () => {
    const event = await audit.record(record({ action: 'device.bind', deviceId: 'device-7' }))
    expect(event.resourceType).toBe('device')
    const [read] = await audit.query({ orgId })
    expect(read?.resourceType).toBe('device')
  })

  it('stores every declared metadata kind and reads it back unchanged', async () => {
    await audit.record(record({ action: 'device.bind', metadata: { platform: 'darwin', runnerVersion: '2.4.1' } }))
    await audit.record(record({ action: 'audit.export', principalId: alice, metadata: { itemCount: 42 } }))
    const events = await audit.query({ orgId })
    expect(events.map(event => event.metadata)).toEqual([
      { itemCount: 42 },
      { platform: 'darwin', runnerVersion: '2.4.1' },
    ])
  })

  it('carries every optional field through storage and back', async () => {
    await audit.record(record({
      action: 'device.revoke',
      outcome: 'denied',
      principalId: alice,
      resourceId: 'device-7',
      deviceId: 'device-7',
      correlationId: 'c-9f2a',
      reason: 'revoked',
      policyRevision: 17n,
    }))
    expect((await audit.query({ orgId }))[0]).toMatchObject({
      principalId: alice,
      resourceId: 'device-7',
      deviceId: 'device-7',
      correlationId: 'c-9f2a',
      reason: 'revoked',
      policyRevision: 17n,
      outcome: 'denied',
    })
  })

  it('omits the fields a caller left out rather than storing empties', async () => {
    await audit.record(record())
    const [event] = await audit.query({ orgId })
    expect(event).toBeDefined()
    for (const field of ['principalId', 'resourceId', 'deviceId', 'correlationId', 'reason', 'policyRevision']) {
      expect(Object.hasOwn(event as object, field), field).toBe(false)
    }
  })

  it('refuses a record the catalogs reject, storing nothing', async () => {
    await expect(audit.record(record({ action: 'member.vanish' as never }))).rejects.toThrow(UnknownAuditActionError)
    await expect(audit.record(record({ metadata: { prompt: 'x' } as never }))).rejects.toThrow(UnknownMetadataKeyError)
    await expect(audit.record(record({ metadata: { itemCount: 1 } }))).rejects.toThrow(MetadataKeyNotAllowedError)
    await expect(audit.record(record({ resourceId: 'a whole sentence' }))).rejects.toThrow(InvalidAuditValueError)
    expect(await audit.query({ orgId })).toEqual([])
  })
})

describe('the database refuses what the service refuses', () => {
  it('rejects prose in a token column', () => {
    const db = raw()
    expect(() => db.prepare(
      'INSERT INTO audit_event (at, org_id, action, outcome, resource_id) VALUES (?, ?, ?, ?, ?)',
    ).run(Date.now(), orgId, 'member.login', 'allowed', 'the user asked me to delete prod')).toThrow(/CHECK/u)
    db.close()
  })

  it('rejects an action this build does not audit', () => {
    const db = raw()
    expect(() => db.prepare(
      'INSERT INTO audit_event (at, org_id, action, outcome) VALUES (?, ?, ?, ?)',
    ).run(Date.now(), orgId, 'member.vanish', 'allowed')).toThrow(/FOREIGN KEY/u)
    db.close()
  })

  it('rejects an outcome and a reason outside their word lists', () => {
    const db = raw()
    const insert = db.prepare('INSERT INTO audit_event (at, org_id, action, outcome, reason) VALUES (?, ?, ?, ?, ?)')
    expect(() => insert.run(Date.now(), orgId, 'member.login', 'maybe', null)).toThrow(/CHECK/u)
    expect(() => insert.run(Date.now(), orgId, 'member.login', 'denied', 'the password was wrong')).toThrow(/CHECK/u)
    db.close()
  })

  it('rejects prose and an unregistered key in metadata', async () => {
    const event = await audit.record(record())
    const db = raw()
    const insert = db.prepare('INSERT INTO audit_event_metadata (seq, key, value_int, value_text) VALUES (?, ?, ?, ?)')
    expect(() => insert.run(Number(event.seq), 'authMethod', null, 'a paragraph of code')).toThrow(/CHECK/u)
    expect(() => insert.run(Number(event.seq), 'promptText', null, 'x')).toThrow(/FOREIGN KEY/u)
    expect(() => insert.run(Number(event.seq), 'itemCount', 1, 'one')).toThrow(/CHECK/u)
    db.close()
  })
})

describe('the trail is append-only', () => {
  it('refuses to amend or remove an event', async () => {
    const event = await audit.record(record({ outcome: 'denied', reason: 'invalid-credentials' }))
    const db = raw()
    expect(() => db.prepare('UPDATE audit_event SET outcome = ? WHERE seq = ?')
      .run('allowed', Number(event.seq))).toThrow(/append-only/u)
    expect(() => db.prepare('DELETE FROM audit_event WHERE seq = ?')
      .run(Number(event.seq))).toThrow(/append-only/u)
    db.close()
    expect((await audit.query({ orgId }))[0]).toMatchObject({ outcome: 'denied', reason: 'invalid-credentials' })
  })

  it('refuses to amend or remove metadata', async () => {
    const event = await audit.record(record({ action: 'audit.export', metadata: { itemCount: 42 } }))
    const db = raw()
    expect(() => db.prepare('UPDATE audit_event_metadata SET value_int = ? WHERE seq = ?')
      .run(0, Number(event.seq))).toThrow(/append-only/u)
    expect(() => db.prepare('DELETE FROM audit_event_metadata WHERE seq = ?')
      .run(Number(event.seq))).toThrow(/append-only/u)
    db.close()
  })
})

describe('reading back', () => {
  beforeEach(async () => {
    await audit.record(record({ principalId: alice, action: 'member.login', metadata: { authMethod: 'password' } }))
    await audit.record(record({ principalId: bob, action: 'member.login', outcome: 'denied', reason: 'invalid-credentials' }))
    await audit.record(record({ principalId: alice, action: 'device.bind', deviceId: 'device-7' }))
    await audit.record({ orgId: other, action: 'member.login', outcome: 'allowed', principalId: alice })
  })

  it('answers newest first, and only for the organization asked about', async () => {
    expect((await audit.query({ orgId })).map(event => event.action))
      .toEqual(['device.bind', 'member.login', 'member.login'])
    expect((await audit.query({ orgId: other })).map(event => event.principalId)).toEqual([alice])
  })

  it('narrows by principal, action, outcome, and resource type', async () => {
    expect((await audit.query({ orgId, principalId: alice })).map(event => event.action))
      .toEqual(['device.bind', 'member.login'])
    expect(await audit.query({ orgId, action: 'device.bind' })).toHaveLength(1)
    expect((await audit.query({ orgId, outcome: 'denied' })).map(event => event.principalId)).toEqual([bob])
    expect((await audit.query({ orgId, resourceType: 'device' })).map(event => event.deviceId)).toEqual(['device-7'])
  })

  it('bounds a time window at the lower end inclusively and the upper end exclusively', async () => {
    const all = await audit.query({ orgId })
    const oldest = all[all.length - 1]
    expect(oldest).toBeDefined()
    expect(await audit.query({ orgId, since: (oldest as { at: number }).at })).toHaveLength(3)
    expect(await audit.query({ orgId, until: (oldest as { at: number }).at })).toHaveLength(0)
  })

  it('pages backwards from a sequence number', async () => {
    const [newest] = await audit.query({ orgId, limit: 1 })
    expect(newest).toBeDefined()
    const rest = await audit.query({ orgId, before: (newest as { seq: bigint }).seq })
    expect(rest.map(event => event.action)).toEqual(['member.login', 'member.login'])
  })

  it('serves a smaller requested limit and caps a larger one', async () => {
    expect(await audit.query({ orgId, limit: 2 })).toHaveLength(2)
    await ctx.fiber.dispose()
    ctx = new Context()
    await ctx.plugin(SqliteAudit, { path, maxQueryRows: 1 }).await()
    expect(await (ctx.get('audit') as Audit).query({ orgId, limit: 50 })).toHaveLength(1)
  })

  it('does not read back a metadata key this build has retired', async () => {
    const event = await audit.record(record({ action: 'audit.export', metadata: { itemCount: 42 } }))
    const db = raw()
    db.prepare('INSERT INTO audit_metadata_catalog (key) VALUES (?)').run('retiredKey')
    db.prepare('INSERT INTO audit_event_metadata (seq, key, value_int, value_text) VALUES (?, ?, ?, ?)')
      .run(Number(event.seq), 'retiredKey', 7, null)
    db.close()
    expect((await audit.query({ orgId, action: 'audit.export' }))[0]?.metadata).toEqual({ itemCount: 42 })
  })
})

describe('opening a database', () => {
  it('stamps the application id and schema version', () => {
    const db = raw()
    expect((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id)
      .toBe(AUDIT_SQLITE_APPLICATION_ID)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('refuses a file another application owns', () => {
    const db = new DatabaseSync(join(dir, 'other.sqlite'))
    db.exec('PRAGMA application_id = 12345')
    expect(() => { applySchema(db) }).toThrow(/another application/u)
    db.close()
  })

  it('refuses a database a newer build wrote', () => {
    const db = raw()
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => { applySchema(db) }).toThrow(/newer than this build/u)
    db.close()
  })
})
