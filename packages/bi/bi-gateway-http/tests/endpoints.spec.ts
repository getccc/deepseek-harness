/**
 * The Runner-facing endpoints over a real HTTP server, a real device
 * credential, and the real governed gateway, because what these routes are
 * for is refusing things, and a refusal is only worth testing against the
 * machinery that would otherwise have allowed it.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SqliteAccessControl from '@deepseek-ai/dsh-access-control-sqlite'
import type { AccessControl } from '@deepseek-ai/dsh-access-control'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import SqliteAudit from '@deepseek-ai/dsh-audit-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import { BiError } from '@deepseek-ai/dsh-bi'
import { BI_RESOURCE_TYPE, type BiGateway } from '@deepseek-ai/dsh-bi-gateway'
import SqliteBiGateway from '@deepseek-ai/dsh-bi-gateway-sqlite'
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
import * as biHttp from '@deepseek-ai/dsh-bi-gateway-http'
import { BI_CATALOG_PATH, BI_CHARTS_PATH, BI_PROTOCOL_VERSION, BI_QUERY_PATH, readQuery } from '@deepseek-ai/dsh-bi-gateway-http'

const A = '55d61de1-ed86-4ad4-b96e-205114de5245'
const CHART = 'ff108076-144e-42eb-9679-8e977a239fdc'
const REF_A = `stub:prod:${A}`
const CHART_A = `${REF_A}/${CHART}`

/** One chart as a source describes it. */
function chartOf(upstreamChartId: string, name = '销售总览'): UpstreamChart {
  return { upstreamChartId, name, spaceName: '销售分析', description: '', kind: 'vertical_bar', updatedAt: undefined }
}

/** A BI source a test scripts. */
class ScriptedSource extends BiSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'prod'
  listing: readonly UpstreamProject[] = []
  readonly listed: UpstreamChartsRequest[] = []
  charts: readonly UpstreamChart[] | Error = [chartOf(CHART), chartOf('c-2', '订单趋势')]
  readonly described: string[] = []
  placement: string | Error = A
  readonly runs: UpstreamRunRequest[] = []
  run: UpstreamRun | Error = {
    fields: [{ id: 'orders_region', label: '区域', role: 'dimension', type: 'string' }],
    filters: '',
    rows: [['华东']],
    rowCount: 1,
    truncated: false,
    cellsTruncated: false,
  }

  listProjects(): Promise<readonly UpstreamProject[]> {
    return Promise.resolve(this.listing)
  }

  listCharts(request: UpstreamChartsRequest): Promise<UpstreamChartListing> {
    this.listed.push(request)
    return this.charts instanceof Error ? Promise.reject(this.charts) : Promise.resolve({ charts: this.charts, truncated: false })
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

let home: string
let cp: Context
let origin: string
let access: AccessControl
let source: ScriptedSource
let orgId: OrgId
let alice: UserId
let accessToken: string

/** Bind a device the way the handoff does, and take its access token. */
async function mintAccessToken(): Promise<string> {
  const { generateKeyPairSync, sign } = await import('node:crypto')
  const auth = cp.get('deviceAuthorization') as import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization
  const { newSecret, pkceChallenge, redeemSigningInput } = await import('@deepseek-ai/dsh-device-authorization')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const verifier = newSecret()
  const started = await auth.start({
    publicKey: spki, platform: 'darwin', runnerVersion: '2.4.1',
    pkceChallenge: pkceChallenge(verifier),
    callbackUri: 'http://127.0.0.1:3090/team/callback', protocolVersion: 1,
  })
  const issued = await auth.confirm(started.transactionId, {
    orgId, userId: alice, authenticationId: 'session:browser-session',
  })
  const credential = await auth.redeem({
    transactionId: started.transactionId,
    code: issued.code,
    pkceVerifier: verifier,
    deviceSignature: sign(null, Buffer.from(redeemSigningInput(started.transactionId, issued.code)), privateKey)
      .toString('base64url'),
    callbackUri: 'http://127.0.0.1:3090/team/callback',
    protocolVersion: 1,
  })
  return credential.accessToken
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-bi-http-'))
  cp = new Context()
  await cp.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await cp.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await cp.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await cp.plugin(SqliteAudit, { path: join(home, 'audit.sqlite'), maxQueryRows: 500 }).await()
  await cp.plugin(SqliteDeviceAuthorization, {
    path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await cp.plugin(ScriptedSource).await()
  await cp.plugin(SqliteBiGateway, { path: join(home, 'bi.sqlite') }).await()
  await cp.plugin(biHttp, biHttp.Config({})).await()
  origin = `http://127.0.0.1:${String(cp.webServer.port)}`

  const store = cp.get('accountStore') as AccountStore
  access = cp.get('accessControl') as AccessControl
  source = cp.get('biSource') as ScriptedSource
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id

  source.listing = [{ upstreamId: A, name: 'Demo YH', description: '', projectType: 'DEFAULT', warehouseType: 'postgres' }]
  await (cp.get('biGateway') as BiGateway).sync(orgId)
  accessToken = await mintAccessToken()
})

afterEach(async () => {
  await cp.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

/** Let Alice analyze every project. */
async function grantAll(): Promise<void> {
  const role = await access.createRole({ orgId, name: 'analysts' })
  await access.bindUserRole(alice, role.id)
  await access.grantType(role.id, BI_RESOURCE_TYPE, 'bi.query')
}

/** Send no `authorization` header at all. */
const NO_TOKEN = 'none'

/**
 * POST one body to a BI route.
 *
 * The token is a separate argument rather than a defaulted one, because
 * passing `undefined` to a defaulted parameter reads as "use the default" and
 * would silently send a token to a test about sending none.
 */
async function post(path: string, body: unknown, token: string | null = null): Promise<Response> {
  const bearerToken = token ?? accessToken
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === NO_TOKEN ? {} : { authorization: `Bearer ${bearerToken}` }),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** A well-formed listing body. */
function chartsBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: BI_PROTOCOL_VERSION, ref: REF_A, ...patch }
}

/** A well-formed run body. */
function queryBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: BI_PROTOCOL_VERSION, chartRef: CHART_A, ...patch }
}

describe('the version is decided before anything else', () => {
  it.each([
    ['a version this build does not speak yet', 99],
    ['a version this build no longer speaks', 0],
    ['a version that is not a number', '1'],
    ['no version at all', undefined],
  ])('refuses %s with the supported range', async (_label, protocolVersion) => {
    const response = await post(BI_CATALOG_PATH, { protocolVersion })
    expect(response.status).toBe(426)
    expect(await response.json()).toEqual({ error: 'bi', reason: 'update-required', minimum: 1, current: BI_PROTOCOL_VERSION })
  })

  it('decides the version before the token, so an unsupported Runner is told to update', async () => {
    const response = await post(BI_QUERY_PATH, { protocolVersion: 99, chartRef: CHART_A }, 'not-a-token')
    expect(response.status).toBe(426)
  })

  it('decides the version before the operation fields, so a malformed old request still says update', async () => {
    const response = await post(BI_QUERY_PATH, { protocolVersion: 99 })
    expect(response.status).toBe(426)
    expect(source.runs).toHaveLength(0)
  })
})

describe('identity comes from the token, never the body', () => {
  it('refuses a request with no token', async () => {
    const response = await post(BI_CATALOG_PATH, { protocolVersion: BI_PROTOCOL_VERSION }, NO_TOKEN)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'bi', reason: 'unauthenticated' })
  })

  it('refuses a token this Control Plane did not issue', async () => {
    const response = await post(BI_CATALOG_PATH, { protocolVersion: BI_PROTOCOL_VERSION }, 'forged')
    expect(response.status).toBe(401)
  })

  it('refuses after the device is revoked, on the next call', async () => {
    await grantAll()
    expect((await post(BI_CATALOG_PATH, { protocolVersion: BI_PROTOCOL_VERSION })).status).toBe(200)
    const auth = cp.get('deviceAuthorization') as import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization
    for (const device of await auth.listDevices(orgId)) await auth.revokeDevice(device.id)
    expect((await post(BI_CATALOG_PATH, { protocolVersion: BI_PROTOCOL_VERSION })).status).toBe(401)
  })

  it('ignores an organization or principal a body tries to name', async () => {
    await grantAll()
    const other = await (cp.get('accountStore') as AccountStore).createOrganization('Rival')
    const response = await post(BI_CHARTS_PATH, chartsBody({
      orgId: other.id, principalId: 'user-somebody-else', deviceId: 'device-elsewhere',
    }))
    // The extra fields changed nothing: the answer is Alice's own project.
    expect(response.status).toBe(200)
    expect(source.listed[0]?.upstreamId).toBe(A)
  })
})

describe('the authorized directory', () => {
  it('answers a principal holding nothing an empty directory', async () => {
    const response = await post(BI_CATALOG_PATH, { protocolVersion: BI_PROTOCOL_VERSION })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [] })
  })

  it('names each authorized project by reference and display name, and nothing else', async () => {
    await grantAll()
    const response = await post(BI_CATALOG_PATH, { protocolVersion: BI_PROTOCOL_VERSION })
    // No upstream identifier field, no warehouse, no type: the reference is
    // the only project id that leaves this Control Plane, and the directory is
    // an authorization answer rather than an inventory.
    expect(await response.json()).toEqual({ entries: [{ ref: REF_A, displayName: 'Demo YH' }] })
  })

  it('refuses a method that is not POST', async () => {
    const response = await fetch(`${origin}${BI_CATALOG_PATH}`, { headers: { authorization: `Bearer ${accessToken}` } })
    expect(response.status).toBe(405)
  })
})

describe('listing one project’s charts', () => {
  it('names each chart by a governed reference, narrowed and paged as asked', async () => {
    await grantAll()
    const response = await post(BI_CHARTS_PATH, chartsBody({ query: ' 订单 ', page: 1, pageSize: 5 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ref: REF_A,
      charts: [{ chartRef: `${REF_A}/c-2`, name: '订单趋势', kind: 'vertical_bar' }],
      page: 1,
      pageSize: 5,
      total: 1,
    })
  })

  it('refuses a project this principal holds nothing on, and asks the source nothing', async () => {
    const response = await post(BI_CHARTS_PATH, chartsBody())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'bi', reason: 'not-allowed' })
    expect(source.listed).toHaveLength(0)
  })

  it.each([
    ['a reference that is not one', { ref: 'not-a-reference' }],
    ['no reference', { ref: undefined }],
    ['a keyword that is not text', { query: 7 }],
    ['a keyword with a line break', { query: 'a\nb' }],
    ['a keyword past the bound', { query: 'x'.repeat(201) }],
    ['a page below one', { page: 0 }],
    ['a page size that is not whole', { pageSize: 2.5 }],
  ])('refuses %s as malformed', async (_label, patch) => {
    await grantAll()
    const response = await post(BI_CHARTS_PATH, chartsBody(patch))
    expect(response.status).toBe(400)
    expect(source.listed).toHaveLength(0)
  })

  it('reads an empty keyword as none', () => {
    expect(readQuery('   ')).toEqual({})
    expect(readQuery(undefined)).toEqual({})
    expect(readQuery('销售')).toEqual({ query: '销售' })
  })

  it('refuses a body that is not JSON, one that is an array, and one that is too large', async () => {
    await grantAll()
    expect((await post(BI_CHARTS_PATH, '{not json')).status).toBe(400)
    expect((await post(BI_CHARTS_PATH, [1, 2])).status).toBe(400)
    expect((await post(BI_CHARTS_PATH, chartsBody({ padding: 'x'.repeat(20_000) }))).status).toBe(400)
  })
})

describe('running one chart', () => {
  it('answers the rows, naming the chart and its project by reference', async () => {
    await grantAll()
    const response = await post(BI_QUERY_PATH, queryBody({ limit: 3 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      chartRef: CHART_A, ref: REF_A, name: '销售总览', kind: 'vertical_bar',
      fields: [{ id: 'orders_region', label: '区域', role: 'dimension', type: 'string' }],
      rows: [['华东']], rowCount: 1, truncated: false,
    })
    expect(source.runs[0]).toMatchObject({ upstreamId: A, upstreamChartId: CHART, limit: 3 })
  })

  it('refuses a chart reference that is not one, and a row bound that is not whole', async () => {
    await grantAll()
    expect((await post(BI_QUERY_PATH, queryBody({ chartRef: 'nope' }))).status).toBe(400)
    expect((await post(BI_QUERY_PATH, queryBody({ limit: -1 }))).status).toBe(400)
    expect(source.runs).toHaveLength(0)
  })

  it('answers a chart the source places elsewhere with a reason a member can act on', async () => {
    await grantAll()
    source.placement = 'another-project'
    const response = await post(BI_QUERY_PATH, queryBody())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'bi', reason: 'chart-unavailable' })
  })
})

describe('failures map onto closed reasons', () => {
  it.each([
    ['a run the warehouse failed', new BiError('query-failed'), 502],
    ['a source that did not answer', new BiError('upstream-unavailable'), 502],
    ['a source that answered nonsense', new BiError('upstream-invalid'), 502],
    ['a run the caller abandoned', new BiError('cancelled'), 499],
  ])('answers %s', async (_label, failure, status) => {
    await grantAll()
    source.run = failure
    const response = await post(BI_QUERY_PATH, queryBody())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'bi', reason: failure.reason })
  })

  it('answers a defect of this deployment as internal, with no reason to act on', async () => {
    await grantAll()
    source.charts = new Error('boom')
    const response = await post(BI_CHARTS_PATH, chartsBody())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal' })
  })

  it('answers a directory failure with the gateway’s own reason', async () => {
    await grantAll()
    // A directory that cannot be read is an internal failure here: the
    // gateway reads its own catalog, and access control is in-process.
    await cp.fiber.dispose()
    cp = new Context()
    await cp.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await cp.plugin(SqliteDeviceAuthorization, {
      path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
    }).await()
    await cp.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    cp.provide('biGateway', { directory: () => Promise.reject(new BiError('control-plane-unreachable')) })
    await cp.plugin(biHttp, biHttp.Config({})).await()
    origin = `http://127.0.0.1:${String(cp.webServer.port)}`
    const store = cp.get('accountStore') as AccountStore
    orgId = (await store.createOrganization('Acme')).id
    alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
    accessToken = await mintAccessToken()
    const response = await post(BI_CATALOG_PATH, { protocolVersion: BI_PROTOCOL_VERSION })
    expect(response.status).toBe(503)
  })
})
