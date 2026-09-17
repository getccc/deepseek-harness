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
import { BiChartRef, BiError, BiProjectRef } from '@deepseek-ai/dsh-bi'
import { BI_CATALOG_RESOURCE, BI_RESOURCE_TYPE, type BiGateway } from '@deepseek-ai/dsh-bi-gateway'
import {
  BiSource,
  type UpstreamChart,
  type UpstreamChartListing,
  type UpstreamChartPlacement,
  type UpstreamChartsRequest,
  type UpstreamProject,
  type UpstreamRun,
  type UpstreamRunRequest,
} from '@deepseek-ai/dsh-bi-source'
import SqliteBiGateway, { BI_GATEWAY_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from '@deepseek-ai/dsh-bi-gateway-sqlite'
import { applySchema } from '@deepseek-ai/dsh-bi-gateway-sqlite/src/schema.ts'

const A = '55d61de1-ed86-4ad4-b96e-205114de5245'
const B = '172a2270-000f-42be-9c68-c4752c23ae51'
const CHART = 'aa064703-8940-4ada-9ef0-3fff1905faa2'
const REF_A = BiProjectRef(`stub:prod:${A}`)
const REF_B = BiProjectRef(`stub:prod:${B}`)
const CHART_A = BiChartRef(`${REF_A}/${CHART}`)

/** One chart as a source describes it. */
function chartOf(upstreamChartId: string, name = '销售总览', spaceName = '销售分析', description = ''): UpstreamChart {
  return { upstreamChartId, name, spaceName, description, kind: 'vertical_bar', updatedAt: undefined }
}

/** A BI source whose listings and answers a test scripts. */
class ScriptedSource extends BiSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'prod'
  /** What the next project listing returns, or the failure it raises. */
  listing: readonly UpstreamProject[] | Error = []
  /** Every chart listing request, so a test can assert what left. */
  readonly listed: UpstreamChartsRequest[] = []
  /** What the next chart listing returns, or the failure it raises. */
  charts: readonly UpstreamChart[] | Error = []
  /** Whether the next chart listing says the source holds more. */
  chartsTruncated = false
  /** Every chart `describeChart` was asked about, in order. */
  readonly described: string[] = []
  /** The project the source says holds any chart, or the failure it raises. */
  placement: string | Error = A
  /** Every run request, so a test can assert what left. */
  readonly runs: UpstreamRunRequest[] = []
  /** What the next run answers, or the failure it raises. */
  run: UpstreamRun | Error = {
    fields: [{ id: 'orders_region', label: '区域', role: 'dimension', type: 'string' }],
    filters: '',
    rows: [['华东'], ['华北']],
    rowCount: 2,
    truncated: false,
    cellsTruncated: false,
  }

  listProjects(): Promise<readonly UpstreamProject[]> {
    return this.listing instanceof Error ? Promise.reject(this.listing) : Promise.resolve(this.listing)
  }

  listCharts(request: UpstreamChartsRequest): Promise<UpstreamChartListing> {
    this.listed.push(request)
    return this.charts instanceof Error
      ? Promise.reject(this.charts)
      : Promise.resolve({ charts: this.charts, truncated: this.chartsTruncated })
  }

  describeChart(upstreamChartId: string): Promise<UpstreamChartPlacement> {
    this.described.push(upstreamChartId)
    if (this.placement instanceof Error) return Promise.reject(this.placement)
    return Promise.resolve({ upstreamId: this.placement, chart: chartOf(upstreamChartId) })
  }

  runChart(request: UpstreamRunRequest): Promise<UpstreamRun> {
    this.runs.push(request)
    return this.run instanceof Error ? Promise.reject(this.run) : Promise.resolve(this.run)
  }
}

/** One upstream project, as a listing describes it. */
function upstream(upstreamId: string, patch: Partial<UpstreamProject> = {}): UpstreamProject {
  return {
    upstreamId,
    name: upstreamId === A ? 'Demo YH' : 'Teaching Project',
    projectType: 'DEFAULT',
    warehouseType: 'postgres',
    ...patch,
  }
}

let home: string
let ctx: Context
let source: ScriptedSource
let access: AccessControl
let audit: Audit
let gateway: BiGateway
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
  await assembled.plugin(SqliteBiGateway, { path: join(root, 'bi.sqlite'), defaultChartPageSize: 2 }).await()
  return assembled
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-bi-'))
  ctx = await assemble(home)
  source = ctx.get('biSource') as ScriptedSource
  access = ctx.get('accessControl') as AccessControl
  audit = ctx.get('audit') as Audit
  gateway = ctx.get('biGateway') as BiGateway
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

/** The managed resource one project reference is governed as. */
async function resourceOf(ref: string): Promise<ResourceId> {
  const resources = await access.listResources(ORG, BI_RESOURCE_TYPE)
  const match = resources.find(resource => resource.externalRef === ref)
  if (match === undefined) throw new Error(`no managed resource for ${ref}`)
  return match.id
}

/** Sync a catalog holding both projects. */
async function syncBoth(): Promise<void> {
  source.listing = [upstream(A), upstream(B)]
  await gateway.sync(ORG)
}

/** Grant one member a role holding project A. */
async function grantA(userId: UserId = ALICE): Promise<RoleId> {
  const role = await roleFor(userId, `reader-${userId}`)
  await access.grantResource(role.id, await resourceOf(REF_A), 'bi.query')
  return role.id
}

/** One audit row's whole text, for asserting what is not in it. */
function rendered(row: AuditRecord | undefined): string {
  return JSON.stringify(row, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value)
}

describe('synchronizing the catalog', () => {
  it('mints a stable reference and governs each project', async () => {
    await syncBoth()
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.ref)).toEqual([REF_B, REF_A].sort())
    expect(view.entries.find(entry => entry.ref === REF_A)).toMatchObject({
      displayName: 'Demo YH', projectType: 'DEFAULT', warehouseType: 'postgres', adminEnabled: true, effectiveEnabled: true,
    })
    expect(view.source).toMatchObject({ sourceCode: 'prod', providerKind: 'stub', health: 'healthy', lastFailure: undefined })
    const resources = await access.listResources(ORG, BI_RESOURCE_TYPE)
    expect(resources.map(resource => resource.externalRef).sort()).toEqual([REF_B, REF_A].sort())
  })

  it('keeps identity and grants across an upstream rename', async () => {
    await syncBoth()
    await grantA()
    source.listing = [upstream(A, { name: 'Demo YH（2026）' }), upstream(B)]
    await gateway.sync(ORG)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.find(entry => entry.ref === REF_A)?.displayName).toBe('Demo YH（2026）')
    // The grant still admits: the reference, not the name, is the identity.
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory).toEqual([{ ref: REF_A, displayName: 'Demo YH（2026）' }])
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

  it('gives a returning entry a fresh identity, and no grant comes back with it', async () => {
    await syncBoth()
    await grantA()
    source.listing = [upstream(B)]
    await gateway.sync(ORG)
    await syncBoth()
    expect((await gateway.catalogView(ORG)).entries.map(entry => entry.ref)).toContain(REF_A)
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
  })

  it('never overrides an administrator’s disable', async () => {
    await syncBoth()
    await gateway.setEnabled(ORG, REF_A, false)
    await syncBoth()
    const entry = (await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)
    expect(entry).toMatchObject({ adminEnabled: false, effectiveEnabled: false })
    await gateway.setEnabled(ORG, REF_A, true)
    expect((await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)?.effectiveEnabled).toBe(true)
  })

  it('keeps the last successful snapshot when the source stops answering', async () => {
    await syncBoth()
    source.listing = new BiError('upstream-unavailable', 'connect ECONNREFUSED 10.0.0.4:8100')
    const view = await gateway.sync(ORG)
    expect(view.entries).toHaveLength(2)
    expect(view.source).toMatchObject({ health: 'failing', lastFailure: 'upstream-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'bi.catalog.sync', outcome: 'error' })
    expect(row).toMatchObject({ resourceId: BI_CATALOG_RESOURCE, metadata: { biFailure: 'upstream-unavailable' } })
    expect(rendered(row)).not.toMatch(/ECONNREFUSED/u)
  })

  it('labels a listing failure that is not a BI failure at all', async () => {
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
    expect(await audit.query({ orgId: ORG, action: 'bi.catalog.sync' })).toHaveLength(1)
  })

  it('records a successful synchronization with what it listed', async () => {
    await syncBoth()
    const [row] = await audit.query({ orgId: ORG, action: 'bi.catalog.sync' })
    expect(row).toMatchObject({ outcome: 'allowed', resourceId: BI_CATALOG_RESOURCE, metadata: { itemCount: 2 } })
  })

  it('refuses to switch an entry the catalog does not hold', async () => {
    await expect(gateway.setEnabled(ORG, REF_A, false)).rejects.toMatchObject({ reason: 'not-allowed' })
  })

  it('folds two listing entries claiming the same upstream project into one row', async () => {
    await syncBoth()
    source.listing = [upstream(A), upstream(A, { name: 'Twin' }), upstream(B)]
    await gateway.sync(ORG)
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.displayName).sort()).toEqual(['Teaching Project', 'Twin'])
  })

  it('rolls the whole listing back when the catalog refuses one row', async () => {
    await syncBoth()
    // The table refuses a project with no name at all, and nothing else in
    // the listing lands either: an administrator reads the last good snapshot.
    source.listing = [upstream(A, { name: 'Renamed' }), upstream(B, { name: null as unknown as string })]
    await expect(gateway.sync(ORG)).rejects.toThrow()
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => entry.displayName).sort()).toEqual(['Demo YH', 'Teaching Project'])
  })

  it('rolls the whole listing back when one entry cannot be given a reference', async () => {
    await syncBoth()
    source.listing = [upstream(A), upstream('a:b')]
    await expect(gateway.sync(ORG)).rejects.toThrow(/not a usable BI reference/u)
    expect((await gateway.catalogView(ORG)).entries).toHaveLength(2)
  })
})

describe('who may see what', () => {
  it('shows a principal holding nothing an empty directory', async () => {
    await syncBoth()
    expect(await gateway.directory({ orgId: ORG, principalId: ALICE })).toEqual([])
  })

  it('shows every enabled project under a type grant', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-bi')
    await access.grantType(role.id, BI_RESOURCE_TYPE, 'bi.query')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref).sort()).toEqual([REF_A, REF_B].sort())
  })

  it('never offers the administration catalog resource as a project', async () => {
    await syncBoth()
    await access.registerResource({ orgId: ORG, type: BI_RESOURCE_TYPE, externalRef: BI_CATALOG_RESOURCE, displayName: 'BI catalog' })
    const role = await roleFor(ALICE, 'all-bi')
    await access.grantType(role.id, BI_RESOURCE_TYPE, 'bi.query')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref as string)).not.toContain(BI_CATALOG_RESOURCE)
    expect(directory).toHaveLength(2)
  })

  it('gives two principals with disjoint grants disjoint directories', async () => {
    await syncBoth()
    await grantA(ALICE)
    const bob = await roleFor(BOB, 'teaching')
    await access.grantResource(bob.id, await resourceOf(REF_B), 'bi.query')
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_A])
    expect((await gateway.directory({ orgId: ORG, principalId: BOB })).map(entry => entry.ref)).toEqual([REF_B])
  })

  it('unions the grants of several roles', async () => {
    await syncBoth()
    await grantA(ALICE)
    const second = await roleFor(ALICE, 'teaching')
    await access.grantResource(second.id, await resourceOf(REF_B), 'bi.query')
    const directory = await gateway.directory({ orgId: ORG, principalId: ALICE })
    expect(directory.map(entry => entry.ref).sort()).toEqual([REF_A, REF_B].sort())
  })

  it('drops a project an administrator disabled', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-bi')
    await access.grantType(role.id, BI_RESOURCE_TYPE, 'bi.query')
    await gateway.setEnabled(ORG, REF_A, false)
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_B])
  })
})

describe('listing one project’s charts', () => {
  it('addresses every chart by a governed reference over its project, and records the listing', async () => {
    await syncBoth()
    await grantA()
    source.charts = [chartOf(CHART), chartOf('c-2', '订单趋势', 'ECommerce', '按月')]
    const controller = new AbortController()
    const page = await gateway.charts({
      orgId: ORG, principalId: ALICE, deviceId: 'device-1', correlationId: 'c-9f2a',
      ref: REF_A, signal: controller.signal,
    })
    expect(source.listed[0]).toMatchObject({ upstreamId: A, signal: controller.signal })
    expect(page).toEqual({
      ref: REF_A,
      charts: [
        { chartRef: CHART_A, ref: REF_A, name: '销售总览', spaceName: '销售分析', description: '', kind: 'vertical_bar', updatedAt: undefined },
        { chartRef: `${REF_A}/c-2`, ref: REF_A, name: '订单趋势', spaceName: 'ECommerce', description: '按月', kind: 'vertical_bar', updatedAt: undefined },
      ],
      page: 1,
      pageSize: 2,
      total: 2,
    })
    const [row] = await audit.query({ orgId: ORG, action: 'bi.charts' })
    expect(row).toMatchObject({
      outcome: 'allowed', principalId: ALICE, resourceId: REF_A, deviceId: 'device-1', correlationId: 'c-9f2a', metadata: { itemCount: 2 },
    })
    expect(rendered(row)).not.toMatch(/销售总览|订单趋势/u)
  })

  it('narrows by a keyword over name, space, and description, and pages what matched', async () => {
    await syncBoth()
    await grantA()
    source.charts = [chartOf('c-1', '销售总览'), chartOf('c-2', '订单趋势', 'ECommerce'), chartOf('c-3', '退货', '销售分析', '按渠道 Sales')]
    const first = await gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A, query: ' sales ', pageSize: 1 })
    expect(first.charts.map(chart => chart.name)).toEqual(['退货'])
    expect(first).toMatchObject({ page: 1, pageSize: 1, total: 1 })
    const second = await gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A, query: '销售', page: 2, pageSize: 1 })
    expect(second.charts.map(chart => chart.name)).toEqual(['退货'])
    expect(second.total).toBe(2)
  })

  it('refuses an unknown project exactly as it refuses an unauthorized one', async () => {
    await syncBoth()
    await roleFor(ALICE, 'none')
    const unauthorized = await gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A }).catch((error: unknown) => error)
    const unknown = await gateway.charts({ orgId: ORG, principalId: ALICE, ref: BiProjectRef('stub:prod:nope') }).catch((error: unknown) => error)
    expect(unauthorized).toMatchObject({ reason: 'not-allowed', message: (unknown as Error).message })
    const rows = await audit.query({ orgId: ORG, action: 'bi.charts' })
    expect(rows.map(row => ({ outcome: row.outcome, reason: row.reason }))).toEqual([
      { outcome: 'denied', reason: 'no-grant' }, { outcome: 'denied', reason: 'no-grant' },
    ])
    expect(source.listed).toEqual([])
  })

  it('refuses a disabled project, and takes effect on the next call after a grant is revoked', async () => {
    await syncBoth()
    const roleId = await grantA()
    await gateway.setEnabled(ORG, REF_A, false)
    await expect(gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'not-allowed' })
    await gateway.setEnabled(ORG, REF_A, true)
    await gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A })
    await access.unbindUserRole(ALICE, roleId)
    await expect(gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'not-allowed' })
  })

  it('records an upstream failure under its closed class and raises it unchanged', async () => {
    await syncBoth()
    await grantA()
    source.charts = new BiError('upstream-unavailable', 'connect ECONNREFUSED 10.0.0.4:8100')
    await expect(gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'upstream-unavailable' })
    const [row] = await audit.query({ orgId: ORG, action: 'bi.charts' })
    expect(row).toMatchObject({ outcome: 'error', metadata: { biFailure: 'upstream-unavailable' } })
    expect(rendered(row)).not.toMatch(/ECONNREFUSED/u)
  })

  it('records a failure that is not a BI failure at all as unreadable, and a cancellation without a label', async () => {
    await syncBoth()
    await grantA()
    source.charts = new Error('boom')
    await expect(gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toThrow('boom')
    source.charts = new BiError('cancelled')
    await expect(gateway.charts({ orgId: ORG, principalId: ALICE, ref: REF_A })).rejects.toMatchObject({ reason: 'cancelled' })
    // Newest first: the cancellation is the later row.
    const rows = await audit.query({ orgId: ORG, action: 'bi.charts' })
    expect(rows.map(row => row.metadata)).toEqual([{}, { biFailure: 'upstream-invalid' }])
  })
})

describe('running one chart', () => {
  it('authorizes the project in the reference, proves the source agrees, runs the chart, and records the rows', async () => {
    await syncBoth()
    await grantA()
    const controller = new AbortController()
    const result = await gateway.query({ orgId: ORG, principalId: ALICE, chartRef: CHART_A, limit: 5, signal: controller.signal })
    expect(source.described).toEqual([CHART])
    expect(source.runs[0]).toMatchObject({ upstreamId: A, upstreamChartId: CHART, limit: 5, signal: controller.signal })
    expect(result).toEqual({
      chartRef: CHART_A, ref: REF_A, name: '销售总览', kind: 'vertical_bar', description: '',
      fields: [{ id: 'orders_region', label: '区域', role: 'dimension', type: 'string' }],
      filters: '', rows: [['华东'], ['华北']], rowCount: 2, truncated: false, cellsTruncated: false,
    })
    const [row] = await audit.query({ orgId: ORG, action: 'bi.query' })
    expect(row).toMatchObject({ outcome: 'allowed', principalId: ALICE, resourceId: REF_A, metadata: { itemCount: 2 } })
    expect(rendered(row)).not.toMatch(/华东|销售总览/u)
  })

  it('applies the deployment row bound when a caller names none', async () => {
    await syncBoth()
    await grantA()
    await gateway.query({ orgId: ORG, principalId: ALICE, chartRef: CHART_A })
    expect(source.runs[0]?.limit).toBe(200)
  })

  it('refuses a reference whose project the source does not agree with, running nothing', async () => {
    await syncBoth()
    await grantA()
    source.placement = B
    await expect(gateway.query({ orgId: ORG, principalId: ALICE, chartRef: CHART_A })).rejects.toMatchObject({ reason: 'chart-unavailable' })
    expect(source.runs).toEqual([])
    const [row] = await audit.query({ orgId: ORG, action: 'bi.query' })
    expect(row).toMatchObject({ outcome: 'error', resourceId: REF_A, metadata: { biFailure: 'chart-unavailable' } })
  })

  it('refuses a reference that is not one exactly as it refuses an unauthorized project', async () => {
    await syncBoth()
    await roleFor(ALICE, 'none')
    const malformed = await gateway.query({ orgId: ORG, principalId: ALICE, chartRef: BiChartRef('bad/ref/with/slashes') }).catch((error: unknown) => error)
    const unauthorized = await gateway.query({ orgId: ORG, principalId: ALICE, chartRef: CHART_A }).catch((error: unknown) => error)
    expect(malformed).toMatchObject({ reason: 'not-allowed', message: (unauthorized as Error).message })
    expect(source.described).toEqual([])
    // Newest first: the malformed reference names no project to record against.
    const rows = await audit.query({ orgId: ORG, action: 'bi.query' })
    expect(rows.map(row => [row.reason, row.resourceId])).toEqual([['no-grant', REF_A], ['no-grant', undefined]])
  })

  it('carries a placement failure and a run failure back under their closed classes', async () => {
    await syncBoth()
    await grantA()
    source.placement = new BiError('chart-unavailable')
    await expect(gateway.query({ orgId: ORG, principalId: ALICE, chartRef: CHART_A })).rejects.toMatchObject({ reason: 'chart-unavailable' })
    source.placement = A
    source.run = new BiError('query-failed', 'relation "orders" does not exist')
    await expect(gateway.query({ orgId: ORG, principalId: ALICE, chartRef: CHART_A })).rejects.toMatchObject({ reason: 'query-failed' })
    // Newest first: the run failure is the later row.
    const rows = await audit.query({ orgId: ORG, action: 'bi.query' })
    expect(rows.map(row => row.metadata)).toEqual([{ biFailure: 'query-failed' }, { biFailure: 'chart-unavailable' }])
    expect(rendered(rows[0])).not.toMatch(/orders/u)
  })
})

describe('when the two stores disagree', () => {
  it('hides a catalog row whose managed resource is gone, until the next sync repairs it', async () => {
    await syncBoth()
    const role = await roleFor(ALICE, 'all-bi')
    await access.grantType(role.id, BI_RESOURCE_TYPE, 'bi.query')
    await access.deleteResource(await resourceOf(REF_A))
    expect((await gateway.catalogView(ORG)).entries.map(entry => entry.ref)).toEqual([REF_B])
    expect((await gateway.directory({ orgId: ORG, principalId: ALICE })).map(entry => entry.ref)).toEqual([REF_B])
    await syncBoth()
    expect((await gateway.catalogView(ORG)).entries).toHaveLength(2)
  })

  it('switching an entry whose resource is gone changes the catalog and waits for the sync', async () => {
    await syncBoth()
    await access.deleteResource(await resourceOf(REF_A))
    await gateway.setEnabled(ORG, REF_A, false)
    await syncBoth()
    const entry = (await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)
    expect(entry).toMatchObject({ adminEnabled: false, effectiveEnabled: false })
  })

  it('reads a resource an administrator disabled directly as not effective', async () => {
    await syncBoth()
    await access.setResourceEnabled(await resourceOf(REF_A), false)
    const entry = (await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)
    expect(entry).toMatchObject({ adminEnabled: true, effectiveEnabled: false })
    await syncBoth()
    expect((await gateway.catalogView(ORG)).entries.find(item => item.ref === REF_A)?.effectiveEnabled).toBe(true)
  })

  it('refuses a database a newer build wrote', () => {
    const path = join(home, 'newer.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${BI_GATEWAY_SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => { applySchema(new DatabaseSync(path)) }).toThrow(/newer than this build/u)
  })

  it('refuses a database an older build wrote', () => {
    const path = join(home, 'older.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${BI_GATEWAY_SQLITE_APPLICATION_ID}`)
    db.exec('PRAGMA user_version = 1')
    db.close()
    if (SCHEMA_VERSION > 1) {
      expect(() => { applySchema(new DatabaseSync(path)) }).toThrow(/older than this build/u)
    } else {
      expect(() => { applySchema(new DatabaseSync(path)) }).not.toThrow()
    }
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
  it('reads back what an earlier gateway wrote', async () => {
    await syncBoth()
    await gateway.setEnabled(ORG, REF_B, false)
    await ctx.fiber.dispose()
    ctx = await assemble(home)
    gateway = ctx.get('biGateway') as BiGateway
    const view = await gateway.catalogView(ORG)
    expect(view.entries.map(entry => [entry.ref, entry.adminEnabled])).toEqual([[REF_B, false], [REF_A, true]].sort())
    expect(view.source.health).toBe('healthy')
  })
})
