/**
 * The governed gateway against a real access-control provider and a real audit
 * store, because the guarantees worth proving here are relationships between
 * three stores rather than one function's return value: what a role admits,
 * what the catalog holds, and what an audit row is allowed to say.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AccessControlSqlite from '@deepseek-ai/dsh-access-control-sqlite'
import type { AccessControl, ResourceId, Role, RoleId } from '@deepseek-ai/dsh-access-control'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import AuditSqlite from '@deepseek-ai/dsh-audit-sqlite'
import type { Audit, AuditRecord } from '@deepseek-ai/dsh-audit'
import { GmoCategoryRef, GmoError, GmoResultRef, type GmoQuery } from '@deepseek-ai/dsh-gmo'
import { GMO_CATALOG_RESOURCE, GMO_RESOURCE_TYPE, type GmoGateway } from '@deepseek-ai/dsh-gmo-gateway'
import {
  GmoSource,
  type UpstreamAnswer,
  type UpstreamAskRequest,
  type UpstreamCategory,
  type UpstreamDescription,
  type UpstreamPlacement,
  type UpstreamResult,
  type UpstreamResultListing,
  type UpstreamResultsRequest,
} from '@deepseek-ai/dsh-gmo-source'
import SqliteGmoGateway, { GMO_GATEWAY_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from '@deepseek-ai/dsh-gmo-gateway-sqlite'
import { applySchema } from '@deepseek-ai/dsh-gmo-gateway-sqlite/src/schema.ts'

const A = 'gb'
const B = 'mfc'
const RESULT = '09032da5fb1e43968cb0d3ef422f90e2'
const REF_A = GmoCategoryRef(`stub:gmo:${A}`)
const REF_B = GmoCategoryRef(`stub:gmo:${B}`)
const RESULT_A = GmoResultRef(`${REF_A}/${RESULT}`)
const SUM: GmoQuery = { kind: 'aggregate', metric: 'sum', groupBy: ['gb_vendor'], filters: { multi: { supplier: ['HUNGO'] } } }

/** One result as a source describes it. */
function resultOf(upstreamResultId: string, name = 'GB / GL 一键分配 · 2026-W42 · #4'): UpstreamResult {
  return {
    upstreamResultId, name, toolName: 'GB / GL 一键分配', period: '2026-W42', rows: 169_187, createdAt: '2026-10-16T14:50',
    stages: [{ key: 'net-gap', label: '3.净缺口', upstreamResultId: `${upstreamResultId}.net-gap` }],
  }
}

/** A GMO source whose listings and answers a test scripts. */
class ScriptedSource extends GmoSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'gmo'
  /** What the next category listing returns, or the failure it raises. */
  listing: readonly UpstreamCategory[] | Error = []
  /** Every result listing request, so a test can assert what left. */
  readonly listed: UpstreamResultsRequest[] = []
  /** What the next result listing returns, or the failure it raises. */
  results: readonly UpstreamResult[] | Error = []
  /** Every result `placeResult` was asked about, in order. */
  readonly placed: string[] = []
  /** The category the source says holds any result, or the failure it raises. */
  placement: string | Error = A
  /** Every description request, in order. */
  readonly described: string[] = []
  /** What the next description names as its category, or the failure it raises. */
  descriptionCategory: string | Error = A
  /** Every question, so a test can assert what left. */
  readonly asked: UpstreamAskRequest[] = []
  /** What the next question answers, or the failure it raises. */
  answer: UpstreamAnswer | Error = { upstreamId: A, data: { total: 117, returned: 4, data: [{ value: 101 }] } }

  listCategories(): Promise<readonly UpstreamCategory[]> {
    return this.listing instanceof Error ? Promise.reject(this.listing) : Promise.resolve(this.listing)
  }

  listResults(request: UpstreamResultsRequest): Promise<UpstreamResultListing> {
    this.listed.push(request)
    return this.results instanceof Error
      ? Promise.reject(this.results)
      : Promise.resolve({ results: this.results, pageSize: request.pageSize, total: this.results.length })
  }

  placeResult(upstreamResultId: string): Promise<UpstreamPlacement> {
    this.placed.push(upstreamResultId)
    return this.placement instanceof Error ? Promise.reject(this.placement) : Promise.resolve({ upstreamId: this.placement })
  }

  describeResult(upstreamResultId: string): Promise<UpstreamDescription> {
    this.described.push(upstreamResultId)
    if (this.descriptionCategory instanceof Error) return Promise.reject(this.descriptionCategory)
    return Promise.resolve({
      upstreamId: this.descriptionCategory, upstreamResultId, categoryLabel: 'GB / GL 分配', name: '一键分配',
      toolName: 'GB / GL 一键分配', period: '2026-W42', rows: 169_187, createdAt: '2026-10-16T14:50', today: '2026-10-16',
      weekStart: '2026-10-12', stages: [{ key: 'net-gap', label: '3.净缺口', upstreamResultId: `${upstreamResultId}.net-gap` }],
      fields: [{ key: 'remaining_gap', label: '剩余缺口', type: 'number', filter: '', description: '分配之后仍未满足的需求' }],
      sources: [], glossary: '# 口径',
    })
  }

  ask(request: UpstreamAskRequest): Promise<UpstreamAnswer> {
    this.asked.push(request)
    return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer)
  }
}

/** One upstream category, as a listing describes it. */
function upstream(upstreamId: string, patch: Partial<UpstreamCategory> = {}): UpstreamCategory {
  return { upstreamId, name: upstreamId === A ? 'GB / GL 分配' : 'MFC 分配', resultCount: upstreamId === A ? 39 : 0, ...patch }
}

let home: string
let ctx: Context
let source: ScriptedSource
let access: AccessControl
let audit: Audit
let gateway: GmoGateway
let ORG: OrgId
let ALICE: UserId
let BOB: UserId

/** Everything the gateway injects, mounted over one home directory. */
async function dependencies(root: string): Promise<Context> {
  const assembled = new Context()
  await assembled.plugin(SqliteAccountStore, { path: join(root, 'accounts.sqlite') }).await()
  await assembled.plugin(AccessControlSqlite, { path: join(root, 'access.sqlite') }).await()
  await assembled.plugin(AuditSqlite, { path: join(root, 'audit.sqlite'), maxQueryRows: 500 }).await()
  await assembled.plugin(ScriptedSource).await()
  return assembled
}

/** Mount the whole Control Plane half over one home directory. */
async function assemble(root: string): Promise<Context> {
  const assembled = await dependencies(root)
  await assembled.plugin(SqliteGmoGateway, { path: join(root, 'gmo.sqlite'), defaultResultPageSize: 2 }).await()
  return assembled
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-gmo-'))
  ctx = await assemble(home)
  source = ctx.get('gmoSource') as ScriptedSource
  access = ctx.get('accessControl') as AccessControl
  audit = ctx.get('audit') as Audit
  gateway = ctx.get('gmoGateway') as GmoGateway
  const store = ctx.get('accountStore') as AccountStore
  ORG = (await store.createOrganization('Acme')).id
  ALICE = (await store.createUser({ orgId: ORG, loginName: 'alice', displayName: 'Alice' })).id
  BOB = (await store.createUser({ orgId: ORG, loginName: 'bob', displayName: 'Bob' })).id
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

/** Create a role bound to one member. */
async function roleFor(userId: UserId, name: string): Promise<Role> {
  const role = await access.createRole({ orgId: ORG, name })
  await access.bindUserRole(userId, role.id)
  return role
}

/** The managed resource one category reference is governed as. */
async function resourceOf(ref: string): Promise<ResourceId> {
  const resources = await access.listResources(ORG, GMO_RESOURCE_TYPE)
  const match = resources.find(resource => resource.externalRef === ref)
  if (match === undefined) throw new Error(`no managed resource for ${ref}`)
  return match.id
}

/** Sync a catalog holding both categories, and switch both on, as an administrator would. */
async function syncBoth(enable = true): Promise<void> {
  source.listing = [upstream(A), upstream(B)]
  await gateway.sync(ORG)
  if (enable) {
    await gateway.setEnabled(ORG, REF_A, true)
    await gateway.setEnabled(ORG, REF_B, true)
  }
}

/** Grant one member a role holding category A. */
async function grantA(userId: UserId = ALICE): Promise<RoleId> {
  const role = await roleFor(userId, `reader-${userId}`)
  await access.grantResource(role.id, await resourceOf(REF_A), 'gmo.query')
  return role.id
}

/** One audit row's whole text, for asserting what is not in it. */
function rendered(row: AuditRecord | undefined): string {
  return JSON.stringify(row, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)
}

describe('synchronizing the catalog', () => {
  it('mints a stable reference, governs each category, and starts every new one switched off', async () => {
    await syncBoth(false)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.ref)).toEqual([REF_B, REF_A].sort())
    expect(view.entries.find(entry => entry.ref === REF_A)).toMatchObject({
      displayName: 'GB / GL 分配', resultCount: 39, adminEnabled: false, effectiveEnabled: false,
    })
    expect(view.source).toMatchObject({ sourceCode: 'gmo', providerKind: 'stub', health: 'healthy', lastFailure: undefined })
    const resources = await access.listResources(ORG, GMO_RESOURCE_TYPE)
    expect(resources.map(resource => resource.externalRef).sort()).toEqual([REF_B, REF_A].sort())
    expect(resources.every(resource => !resource.enabled)).toBe(true)
  })

  it('does not let a role granted every category reach one the source has just started serving', async () => {
    const role = await roleFor(ALICE, 'all-gmo')
    await access.grantType(role.id, GMO_RESOURCE_TYPE, 'gmo.query')
    await syncBoth(false)
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
    await expect(gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'not-allowed' })
    await gateway.setEnabled(ORG, REF_A, true)
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_A])
  })

  it('keeps identity and grants across an upstream rename', async () => {
    await syncBoth()
    await grantA()
    source.listing = [upstream(A, { name: 'GB / GL 分配（2026）' }), upstream(B)]
    await gateway.sync(ORG)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.find(entry => entry.ref === REF_A)?.displayName).toBe('GB / GL 分配（2026）')
    // The grant still admits: the reference, not the name, is the identity.
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory).toEqual([{ ref: REF_A, displayName: 'GB / GL 分配（2026）' }])
  })

  it('refreshes the result count a listing reports', async () => {
    await syncBoth()
    source.listing = [upstream(A, { resultCount: 41 }), upstream(B, { resultCount: undefined })]
    await gateway.sync(ORG)
    const entries = (await gateway.catalogView(ORG)).entries
    expect(entries.find(entry => entry.ref === REF_A)?.resultCount).toBe(41)
    expect(entries.find(entry => entry.ref === REF_B)?.resultCount).toBeUndefined()
  })

  it('retires a vanished entry, with the grants that named it', async () => {
    await syncBoth()
    const roleId = await grantA()
    source.listing = [upstream(B)]
    await gateway.sync(ORG)
    expect((await gateway.catalogView(ORG)).entries.map(entry => entry.ref)).toEqual([REF_B])
    expect(await access.listRoleGrants(roleId)).toEqual([])
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
  })

  it('gives a returning entry a fresh identity, no grant, and the switched-off start of any new category', async () => {
    await syncBoth()
    await grantA()
    source.listing = [upstream(B)]
    await gateway.sync(ORG)
    await syncBoth(false)
    const entry = (await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)
    expect(entry).toMatchObject({ adminEnabled: false })
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
  })

  it('never overrides an administrator’s choice, either way', async () => {
    await syncBoth()
    await gateway.setEnabled(ORG, REF_A, false)
    await syncBoth(false)
    const entry = (await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)
    expect(entry).toMatchObject({ adminEnabled: false, effectiveEnabled: false })
    await gateway.setEnabled(ORG, REF_A, true)
    await syncBoth(false)
    expect((await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)?.effectiveEnabled).toBe(true)
  })

  it('keeps the last successful snapshot when the source stops answering', async () => {
    await syncBoth()
    source.listing = new GmoError('upstream-unavailable', 'connect ECONNREFUSED 10.1.120.90:8700')
    const view = await gateway.sync(ORG)
    expect(view.entries).toHaveLength(2)
    expect(view.source).toMatchObject({ health: 'failing', lastFailure: 'upstream-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.catalog.sync', outcome: 'error' })
    expect(row).toMatchObject({ resourceId: GMO_CATALOG_RESOURCE, metadata: { gmoFailure: 'upstream-unavailable' } })
    expect(rendered(row)).not.toMatch(/ECONNREFUSED/u)
  })

  it('labels a listing failure that is not a GMO failure at all', async () => {
    source.listing = new Error('boom')
    const view = await gateway.sync(ORG)
    expect(view.source.lastFailure).toBe('upstream-invalid')
  })

  it('reports a source nobody has synced yet', async () => {
    const view = await gateway.catalogView(ORG)
    expect(view.source).toMatchObject({ health: 'never-synced', lastAttemptAt: undefined, lastSuccessAt: undefined })
    expect(view.entries).toEqual([])
  })

  it('joins concurrent callers to one reconciliation', async () => {
    source.listing = [upstream(A)]
    const [first, second] = await Promise.all([gateway.sync(ORG), gateway.sync(ORG)])
    expect(first).toEqual(second)
    expect(await audit.query({ orgId: ORG, action: 'gmo.catalog.sync' })).toHaveLength(1)
  })

  it('records a successful synchronization with what it listed', async () => {
    await syncBoth()
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.catalog.sync' })
    expect(row).toMatchObject({ outcome: 'allowed', resourceId: GMO_CATALOG_RESOURCE, metadata: { itemCount: 2 } })
  })

  it('refuses to switch an entry the catalog does not hold', async () => {
    await expect(gateway.setEnabled(ORG, REF_A, false)).rejects.toMatchObject({ reason: 'not-allowed' })
  })

  it('folds two listing entries claiming the same upstream category into one row', async () => {
    await syncBoth()
    source.listing = [upstream(A), upstream(A, { name: 'Twin' }), upstream(B)]
    await gateway.sync(ORG)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.displayName).sort()).toEqual(['MFC 分配', 'Twin'])
  })

  it('rolls the whole listing back when the catalog refuses one row', async () => {
    await syncBoth()
    // The table refuses a category with no name at all, and nothing else in
    // the listing lands either: an administrator reads the last good snapshot.
    const nameless = upstream(B, { name: 'placeholder' })
    Reflect.set(nameless, 'name', null)
    source.listing = [upstream(A, { name: 'Renamed' }), nameless]
    await expect(gateway.sync(ORG)).rejects.toThrow()
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.displayName).sort()).toEqual(['GB / GL 分配', 'MFC 分配'])
  })

  it('rolls the whole listing back when one entry cannot be given a reference', async () => {
    await syncBoth()
    source.listing = [upstream(A), upstream('a:b')]
    await expect(gateway.sync(ORG)).rejects.toThrow(/not a usable GMO reference/u)
    expect((await gateway.catalogView(ORG)).entries).toHaveLength(2)
  })
})

describe('who may see what', () => {
  it('shows a principal holding nothing an empty directory', async () => {
    await syncBoth()
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
  })

  it('shows every enabled category under a type grant', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-gmo')
    await access.grantType(role.id, GMO_RESOURCE_TYPE, 'gmo.query')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref).sort()).toEqual([REF_A, REF_B].sort())
  })

  it('never offers the administration catalog resource as a category', async () => {
    await syncBoth()
    await access.registerResource({ orgId: ORG, type: GMO_RESOURCE_TYPE, externalRef: GMO_CATALOG_RESOURCE, displayName: 'GMO catalog' })
    const role = await roleFor(ALICE, 'all-gmo')
    await access.grantType(role.id, GMO_RESOURCE_TYPE, 'gmo.query')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref as string)).not.toContain(GMO_CATALOG_RESOURCE)
    expect(directory).toHaveLength(2)
  })

  it('gives two principals with disjoint grants disjoint directories', async () => {
    await syncBoth()
    await grantA(ALICE)
    const bob = await roleFor(BOB, 'mfc')
    await access.grantResource(bob.id, await resourceOf(REF_B), 'gmo.query')
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_A])
    expect((await gateway.directory({ orgId: ORG, principalId: BOB })).map(entry => entry.ref)).toEqual([REF_B])
  })

  it('unions the grants of several roles', async () => {
    await syncBoth()
    await grantA(ALICE)
    const second = await roleFor(ALICE, 'mfc')
    await access.grantResource(second.id, await resourceOf(REF_B), 'gmo.query')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref).sort()).toEqual([REF_A, REF_B].sort())
  })

  it('drops a category an administrator disabled', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-gmo')
    await access.grantType(role.id, GMO_RESOURCE_TYPE, 'gmo.query')
    await gateway.setEnabled(ORG, REF_A, false)
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_B])
  })
})

describe('listing one category’s results', () => {
  it('addresses every result and step by a governed reference over its category, and records the listing', async () => {
    await syncBoth()
    await grantA()
    source.results = [resultOf(RESULT), resultOf('11111111111111111111111111111111', '较早的一份')]
    const controller = new AbortController()
    const page = await gateway.results({
      orgId: ORG, principalId: ALICE, deviceId: 'device-1', correlationId: 'c-9f2a', ref: REF_A, signal: controller.signal,
    })
    expect(source.listed[0]).toMatchObject({ upstreamId: A, page: 1, pageSize: 2, signal: controller.signal })
    expect(page).toMatchObject({ ref: REF_A, page: 1, pageSize: 2, total: 2 })
    expect(page.results[0]).toEqual({
      resultRef: RESULT_A, ref: REF_A, name: 'GB / GL 一键分配 · 2026-W42 · #4', toolName: 'GB / GL 一键分配', period: '2026-W42',
      rows: 169_187, createdAt: '2026-10-16T14:50',
      stages: [{ key: 'net-gap', label: '3.净缺口', resultRef: `${RESULT_A}.net-gap` }],
    })
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.results' })
    expect(row).toMatchObject({
      outcome: 'allowed', principalId: ALICE, resourceId: REF_A, deviceId: 'device-1', correlationId: 'c-9f2a', metadata: { itemCount: 2 },
    })
    expect(rendered(row)).not.toMatch(/一键分配|较早/u)
  })

  it('passes the caller’s page and size through to the source', async () => {
    await syncBoth()
    await grantA()
    await gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A, page: 3, pageSize: 7 })
    expect(source.listed[0]).toMatchObject({ page: 3, pageSize: 7 })
  })

  it('refuses an unknown category exactly as it refuses an unauthorized one', async () => {
    await syncBoth()
    await roleFor(ALICE, 'none')
    const unauthorized = await gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A }).catch((error: unknown) => error)
    const unknown = await gateway.results({ orgId: ORG, principalId: ALICE, ref: GmoCategoryRef('stub:gmo:nope') }).catch((error: unknown) => error)
    expect(unauthorized).toMatchObject({ reason: 'not-allowed', message: (unknown as Error).message })
    const rows = await audit.query({ orgId: ORG, action: 'gmo.results' })
    expect(rows.map(row => ({ outcome: row.outcome, reason: row.reason }))).toEqual([
      { outcome: 'denied', reason: 'no-grant' }, { outcome: 'denied', reason: 'no-grant' },
    ])
    expect(source.listed).toEqual([])
  })

  it('refuses a disabled category, and takes effect on the next call after a grant is revoked', async () => {
    await syncBoth()
    const roleId = await grantA()
    await gateway.setEnabled(ORG, REF_A, false)
    await expect(gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'not-allowed' })
    await gateway.setEnabled(ORG, REF_A, true)
    await gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A })
    await access.unbindUserRole(ALICE, roleId)
    await expect(gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'not-allowed' })
  })

  it('records an upstream failure under its closed class and raises it unchanged', async () => {
    await syncBoth()
    await grantA()
    source.results = new GmoError('upstream-unavailable', 'connect ECONNREFUSED 10.1.120.90:8700')
    await expect(gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'upstream-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.results' })
    expect(row).toMatchObject({ outcome: 'error', metadata: { gmoFailure: 'upstream-unavailable' } })
    expect(rendered(row)).not.toMatch(/ECONNREFUSED/u)
  })

  it('records a failure that is not a GMO failure at all as unreadable, and a cancellation without a label', async () => {
    await syncBoth()
    await grantA()
    source.results = new Error('boom')
    await expect(gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toThrow('boom')
    source.results = new GmoError('cancelled')
    await expect(gateway.results({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'cancelled' })
    // Newest first: the cancellation is the later row.
    const rows = await audit.query({ orgId: ORG, action: 'gmo.results' })
    expect(rows.map(row => row.metadata)).toEqual([{}, { gmoFailure: 'upstream-invalid' }])
  })
})

describe('describing one result', () => {
  it('authorizes the category in the reference, proves the source agrees, and answers with references', async () => {
    await syncBoth()
    await grantA()
    const description = await gateway.describe({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A })
    expect(source.placed).toEqual([RESULT])
    expect(source.described).toEqual([RESULT])
    expect(description).toMatchObject({
      resultRef: RESULT_A, ref: REF_A, categoryLabel: 'GB / GL 分配', today: '2026-10-16', weekStart: '2026-10-12', glossary: '# 口径',
    })
    expect(description.stages).toEqual([{ key: 'net-gap', label: '3.净缺口', resultRef: `${RESULT_A}.net-gap` }])
    expect(description.fields[0]?.description).toBe('分配之后仍未满足的需求')
    expect(description).not.toHaveProperty('upstreamId')
    expect(description).not.toHaveProperty('upstreamResultId')
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.describe' })
    expect(row).toMatchObject({ outcome: 'allowed', resourceId: REF_A, metadata: {} })
  })

  it('refuses a reference whose category the source does not agree with, describing nothing', async () => {
    await syncBoth()
    await grantA()
    source.placement = B
    await expect(gateway.describe({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A })).rejects.toMatchObject({ reason: 'result-unavailable' })
    expect(source.described).toEqual([])
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.describe' })
    expect(row).toMatchObject({ outcome: 'error', resourceId: REF_A, metadata: { gmoFailure: 'result-unavailable' } })
  })

  it('drops a description the source attributes to another category than it placed the result in', async () => {
    await syncBoth()
    await grantA()
    source.descriptionCategory = B
    await expect(gateway.describe({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A })).rejects.toMatchObject({ reason: 'result-unavailable' })
  })

  it('refuses a reference that is not one exactly as it refuses an unauthorized category', async () => {
    await syncBoth()
    await roleFor(ALICE, 'none')
    const malformed = await gateway.describe({ orgId: ORG, principalId: ALICE, resultRef: GmoResultRef('bad/ref/with/slashes') }).catch((error: unknown) => error)
    const unauthorized = await gateway.describe({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A }).catch((error: unknown) => error)
    expect(malformed).toMatchObject({ reason: 'not-allowed', message: (unauthorized as Error).message })
    expect(source.placed).toEqual([])
    // Newest first: the malformed reference names no category to record against.
    const rows = await audit.query({ orgId: ORG, action: 'gmo.describe' })
    expect(rows.map(row => [row.reason, row.resourceId])).toEqual([['no-grant', REF_A], ['no-grant', undefined]])
  })

  it('carries a placement failure and a description failure back under their closed classes', async () => {
    await syncBoth()
    await grantA()
    source.placement = new GmoError('result-unavailable')
    await expect(gateway.describe({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A })).rejects.toMatchObject({ reason: 'result-unavailable' })
    source.placement = A
    source.descriptionCategory = new GmoError('too-large')
    await expect(gateway.describe({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A })).rejects.toMatchObject({ reason: 'too-large' })
    const rows = await audit.query({ orgId: ORG, action: 'gmo.describe' })
    expect(rows.map(row => row.metadata)).toEqual([{ gmoFailure: 'too-large' }, { gmoFailure: 'result-unavailable' }])
  })
})

describe('asking one result', () => {
  it('authorizes, proves placement, asks, and records the kind and count but never the question', async () => {
    await syncBoth()
    await grantA()
    const controller = new AbortController()
    const answer = await gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: SUM, signal: controller.signal })
    expect(source.placed).toEqual([RESULT])
    expect(source.asked[0]).toMatchObject({ upstreamId: A, upstreamResultId: RESULT, query: SUM, signal: controller.signal })
    expect(answer).toEqual({ resultRef: RESULT_A, ref: REF_A, kind: 'aggregate', data: { total: 117, returned: 4, data: [{ value: 101 }] } })
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.ask' })
    expect(row).toMatchObject({ outcome: 'allowed', principalId: ALICE, resourceId: REF_A, metadata: { queryKind: 'aggregate', itemCount: 4 } })
    expect(rendered(row)).not.toMatch(/gb_vendor|HUNGO|supplier|117|101/u)
  })

  it('counts detail rows, and records nothing countable for an overview', async () => {
    await syncBoth()
    await grantA()
    source.answer = { upstreamId: A, data: { total: 6, rows: [{}, {}, {}] } }
    await gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: { kind: 'rows' } })
    source.answer = { upstreamId: A, data: { total: 117 } }
    await gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: { kind: 'overview', widget: 'kpi' } })
    const rows = await audit.query({ orgId: ORG, action: 'gmo.ask' })
    expect(rows.map(row => row.metadata)).toEqual([{ queryKind: 'overview' }, { queryKind: 'rows', itemCount: 3 }])
  })

  it('refuses a reference whose category the source does not agree with, asking nothing', async () => {
    await syncBoth()
    await grantA()
    source.placement = B
    await expect(gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: SUM })).rejects.toMatchObject({ reason: 'result-unavailable' })
    expect(source.asked).toEqual([])
  })

  it('drops an answer the source attributes to another category than the one authorized', async () => {
    await syncBoth()
    await grantA()
    source.answer = { upstreamId: B, data: { total: 5 } }
    await expect(gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: SUM })).rejects.toMatchObject({ reason: 'result-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.ask' })
    expect(row).toMatchObject({ outcome: 'error', metadata: { queryKind: 'aggregate', gmoFailure: 'result-unavailable' } })
  })

  it('refuses a member holding nothing on the category before the source is asked anything', async () => {
    await syncBoth()
    await roleFor(ALICE, 'none')
    await expect(gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: SUM })).rejects.toMatchObject({ reason: 'not-allowed' })
    expect(source.placed).toEqual([])
    expect(source.asked).toEqual([])
  })

  it.each([
    ['unsupported'],
    ['invalid-query'],
    ['too-large'],
    ['upstream-unavailable'],
    ['upstream-invalid'],
    ['result-unavailable'],
  ] as const)('carries a %s failure back under its closed class', async (reason) => {
    await syncBoth()
    await grantA()
    source.answer = new GmoError(reason, 'relation "t" does not exist at 10.0.0.4')
    await expect(gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: SUM })).rejects.toMatchObject({ reason })
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.ask' })
    expect(row).toMatchObject({ outcome: 'error', metadata: { queryKind: 'aggregate', gmoFailure: reason } })
    expect(rendered(row)).not.toMatch(/relation|10\.0\.0\.4/u)
  })

  it('records a placement failure with the kind of question that was about to be asked', async () => {
    await syncBoth()
    await grantA()
    source.placement = new GmoError('upstream-unavailable')
    await expect(gateway.ask({ orgId: ORG, principalId: ALICE, resultRef: RESULT_A, query: SUM })).rejects.toMatchObject({ reason: 'upstream-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'gmo.ask' })
    expect(row).toMatchObject({ outcome: 'error', metadata: { gmoFailure: 'upstream-unavailable' } })
  })
})

describe('when the two stores disagree', () => {
  it('hides a catalog row whose managed resource is gone, until the next sync repairs it', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-gmo')
    await access.grantType(role.id, GMO_RESOURCE_TYPE, 'gmo.query')
    await access.deleteResource(await resourceOf(REF_A))
    expect((await gateway.catalogView(ORG)).entries.map(entry => entry.ref)).toEqual([REF_B])
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_B])
    await syncBoth(false)
    expect((await gateway.catalogView(ORG)).entries).toHaveLength(2)
  })

  it('switching an entry whose resource is gone changes the catalog and waits for the sync', async () => {
    await syncBoth()
    await access.deleteResource(await resourceOf(REF_A))
    await gateway.setEnabled(ORG, REF_A, false)
    await syncBoth(false)
    const entry = (await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)
    expect(entry).toMatchObject({ adminEnabled: false, effectiveEnabled: false })
  })

  it('reads a resource an administrator disabled directly as not effective', async () => {
    await syncBoth()
    await access.setResourceEnabled(await resourceOf(REF_A), false)
    const entry = (await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)
    expect(entry).toMatchObject({ adminEnabled: true, effectiveEnabled: false })
    await syncBoth(false)
    expect((await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)?.effectiveEnabled).toBe(true)
  })

  it('refuses a database a newer build wrote', () => {
    const path = join(home, 'newer.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${GMO_GATEWAY_SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => { applySchema(new DatabaseSync(path)) }).toThrow(/newer than this build/u)
  })

  it('accepts a database of the current schema', () => {
    const path = join(home, 'current.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${GMO_GATEWAY_SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.close()
    expect(() => { applySchema(new DatabaseSync(path)) }).not.toThrow()
  })

  it('refuses a database another application wrote', () => {
    const path = join(home, 'other.sqlite')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA application_id = 12345')
    db.close()
    expect(() => { applySchema(new DatabaseSync(path)) }).toThrow(/another application/u)
  })
})

describe('the catalog outlives the process', () => {
  it('reads back what an earlier gateway wrote, including the administrator’s choices', async () => {
    await syncBoth()
    await gateway.setEnabled(ORG, REF_B, false)
    await ctx.fiber.dispose()
    ctx = await assemble(home)
    gateway = ctx.get('gmoGateway') as GmoGateway
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => [entry.ref, entry.adminEnabled])).toEqual([[REF_B, false], [REF_A, true]].sort())
    expect(view.source.health).toBe('healthy')
  })
})

describe('the database file', () => {
  it('writes ahead of the database unless a rollback journal is configured', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gmo-gateway-sqlite-journal-'))
    try {
      for (const journalMode of ['wal', 'delete'] as const) {
        const path = join(root, `${journalMode}.sqlite`)
        const mode = journalMode === 'wal' ? {} : { journalMode }
        const opened = await dependencies(root)
        await opened.plugin(SqliteGmoGateway, { path, ...mode }).await()
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
