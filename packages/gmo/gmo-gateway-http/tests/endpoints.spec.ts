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
import { GmoError } from '@deepseek-ai/dsh-gmo'
import { GMO_RESOURCE_TYPE, type GmoGateway } from '@deepseek-ai/dsh-gmo-gateway'
import SqliteGmoGateway from '@deepseek-ai/dsh-gmo-gateway-sqlite'
import {
  GmoSource,
  type UpstreamAnswer,
  type UpstreamAskRequest,
  type UpstreamCategory,
  type UpstreamDescription,
  type UpstreamPlacement,
  type UpstreamResultListing,
  type UpstreamResultsRequest,
} from '@deepseek-ai/dsh-gmo-source'
import * as gmoHttp from '@deepseek-ai/dsh-gmo-gateway-http'
import {
  GMO_ASK_PATH,
  GMO_CATALOG_PATH,
  GMO_DESCRIBE_PATH,
  GMO_PROTOCOL_VERSION,
  GMO_RESULTS_PATH,
  readAskQuery,
  readCount,
  readFilters,
} from '@deepseek-ai/dsh-gmo-gateway-http'

const A = 'gb'
const RESULT = '09032da5fb1e43968cb0d3ef422f90e2'
const REF_A = `stub:gmo:${A}`
const RESULT_A = `${REF_A}/${RESULT}`

/** A GMO source a test scripts. */
class ScriptedSource extends GmoSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'gmo'
  listing: readonly UpstreamCategory[] = []
  readonly listed: UpstreamResultsRequest[] = []
  results: UpstreamResultListing | Error = {
    results: [{
      upstreamResultId: RESULT, name: '一键分配', toolName: 'GB / GL 一键分配', period: '2026-W42', rows: 3,
      createdAt: '2026-10-16T14:50', stages: [],
    }],
    pageSize: 20,
    total: 1,
  }
  readonly placed: string[] = []
  placement: string | Error = A
  readonly asked: UpstreamAskRequest[] = []
  answer: UpstreamAnswer | Error = { upstreamId: A, data: { total: 117 } }

  listCategories(): Promise<readonly UpstreamCategory[]> {
    return Promise.resolve(this.listing)
  }

  listResults(request: UpstreamResultsRequest): Promise<UpstreamResultListing> {
    this.listed.push(request)
    return this.results instanceof Error ? Promise.reject(this.results) : Promise.resolve(this.results)
  }

  placeResult(upstreamResultId: string): Promise<UpstreamPlacement> {
    this.placed.push(upstreamResultId)
    return this.placement instanceof Error ? Promise.reject(this.placement) : Promise.resolve({ upstreamId: this.placement })
  }

  describeResult(upstreamResultId: string): Promise<UpstreamDescription> {
    return Promise.resolve({
      upstreamId: A, upstreamResultId, categoryLabel: 'GB / GL 分配', name: '一键分配', toolName: 'GB / GL 一键分配',
      period: '2026-W42', rows: 3, createdAt: '2026-10-16T14:50', today: '2026-10-16', weekStart: '2026-10-12',
      stages: [], fields: [], sources: [], glossary: '# 口径',
    })
  }

  ask(request: UpstreamAskRequest): Promise<UpstreamAnswer> {
    this.asked.push(request)
    return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer)
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
  home = mkdtempSync(join(tmpdir(), 'dsh-gmo-http-'))
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
  await cp.plugin(SqliteGmoGateway, { path: join(home, 'gmo.sqlite') }).await()
  await cp.plugin(gmoHttp, gmoHttp.Config({})).await()
  origin = `http://127.0.0.1:${String(cp.webServer.port)}`

  const store = cp.get('accountStore') as AccountStore
  access = cp.get('accessControl') as AccessControl
  source = cp.get('gmoSource') as ScriptedSource
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id

  source.listing = [{ upstreamId: A, name: 'GB / GL 分配', resultCount: 1 }]
  const gateway = cp.get('gmoGateway') as GmoGateway
  await gateway.sync(orgId)
  await gateway.setEnabled(orgId, REF_A as never, true)      // a newly discovered category starts off
  accessToken = await mintAccessToken()
})

afterEach(async () => {
  await cp.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

/** Let Alice analyze every category. */
async function grantAll(): Promise<void> {
  const role = await access.createRole({ orgId, name: 'analysts' })
  await access.bindUserRole(alice, role.id)
  await access.grantType(role.id, GMO_RESOURCE_TYPE, 'gmo.query')
}

/** Send no `authorization` header at all. */
const NO_TOKEN = 'none'

/**
 * POST one body to a GMO route.
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
function resultsBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: GMO_PROTOCOL_VERSION, ref: REF_A, ...patch }
}

/** A well-formed description body. */
function describeBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: GMO_PROTOCOL_VERSION, resultRef: RESULT_A, ...patch }
}

/** A well-formed question body. */
function askBody(query: Record<string, unknown> = { kind: 'aggregate', metric: 'sum' }, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: GMO_PROTOCOL_VERSION, resultRef: RESULT_A, query, ...patch }
}

describe('the version is decided before anything else', () => {
  it.each([
    ['a version this build does not speak yet', 99],
    ['a version this build no longer speaks', 0],
    ['a version that is not a number', '1'],
    ['no version at all', undefined],
  ])('refuses %s with the supported range', async (_label, protocolVersion) => {
    const response = await post(GMO_CATALOG_PATH, { protocolVersion })
    expect(response.status).toBe(426)
    expect(await response.json()).toEqual({ error: 'gmo', reason: 'update-required', minimum: 1, current: GMO_PROTOCOL_VERSION })
  })

  it('decides the version before the token, so an unsupported Runner is told to update', async () => {
    const response = await post(GMO_ASK_PATH, { protocolVersion: 99, resultRef: RESULT_A }, 'not-a-token')
    expect(response.status).toBe(426)
  })

  it('decides the version before the operation fields, so a malformed old request still says update', async () => {
    const response = await post(GMO_ASK_PATH, { protocolVersion: 99 })
    expect(response.status).toBe(426)
    expect(source.asked).toHaveLength(0)
  })
})

describe('identity comes from the token, never the body', () => {
  it('refuses a request with no token', async () => {
    const response = await post(GMO_CATALOG_PATH, { protocolVersion: GMO_PROTOCOL_VERSION }, NO_TOKEN)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'gmo', reason: 'unauthenticated' })
  })

  it('refuses a token this Control Plane did not issue', async () => {
    const response = await post(GMO_CATALOG_PATH, { protocolVersion: GMO_PROTOCOL_VERSION }, 'forged')
    expect(response.status).toBe(401)
  })

  it.each([
    ['listing results', GMO_RESULTS_PATH],
    ['describing a result', GMO_DESCRIBE_PATH],
    ['asking a result', GMO_ASK_PATH],
  ])('refuses %s with no token before reading any field', async (_label, path) => {
    const response = await post(path, { protocolVersion: GMO_PROTOCOL_VERSION }, NO_TOKEN)
    expect(response.status).toBe(401)
    expect(source.asked).toHaveLength(0)
  })

  it('refuses after the device is revoked, on the next call', async () => {
    await grantAll()
    expect((await post(GMO_CATALOG_PATH, { protocolVersion: GMO_PROTOCOL_VERSION })).status).toBe(200)
    const auth = cp.get('deviceAuthorization') as import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization
    for (const device of await auth.listDevices(orgId)) await auth.revokeDevice(device.id)
    expect((await post(GMO_CATALOG_PATH, { protocolVersion: GMO_PROTOCOL_VERSION })).status).toBe(401)
  })

  it('ignores an organization or principal a body tries to name', async () => {
    await grantAll()
    const other = await (cp.get('accountStore') as AccountStore).createOrganization('Rival')
    const response = await post(GMO_RESULTS_PATH, resultsBody({
      orgId: other.id, principalId: 'user-somebody-else', deviceId: 'device-elsewhere',
    }))
    // The extra fields changed nothing: the answer is Alice's own category.
    expect(response.status).toBe(200)
    expect(source.listed[0]?.upstreamId).toBe(A)
  })
})

describe('the authorized directory', () => {
  it('answers a principal holding nothing an empty directory', async () => {
    const response = await post(GMO_CATALOG_PATH, { protocolVersion: GMO_PROTOCOL_VERSION })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [] })
  })

  it('names each authorized category by reference and display name, and nothing else', async () => {
    await grantAll()
    const response = await post(GMO_CATALOG_PATH, { protocolVersion: GMO_PROTOCOL_VERSION })
    // No upstream identifier field, no result count: the reference is the only
    // category id that leaves this Control Plane, and the directory is an
    // authorization answer rather than an inventory.
    expect(await response.json()).toEqual({ entries: [{ ref: REF_A, displayName: 'GB / GL 分配' }] })
  })

  it('refuses a method that is not POST', async () => {
    const response = await fetch(`${origin}${GMO_CATALOG_PATH}`, { headers: { authorization: `Bearer ${accessToken}` } })
    expect(response.status).toBe(405)
  })
})

describe('listing one category’s results', () => {
  it('names each result by a governed reference, paged as asked', async () => {
    await grantAll()
    const response = await post(GMO_RESULTS_PATH, resultsBody({ page: 2, pageSize: 5 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ref: REF_A, results: [{ resultRef: RESULT_A, name: '一键分配', period: '2026-W42', rows: 3 }], total: 1,
    })
    expect(source.listed[0]).toMatchObject({ upstreamId: A, page: 2, pageSize: 5 })
  })

  it('refuses a category this principal holds nothing on, and asks the source nothing', async () => {
    const response = await post(GMO_RESULTS_PATH, resultsBody())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'gmo', reason: 'not-allowed' })
    expect(source.listed).toHaveLength(0)
  })

  it.each([
    ['a reference that is not one', { ref: 'not-a-reference' }],
    ['no reference', { ref: undefined }],
    ['a page below one', { page: 0 }],
    ['a page size that is not whole', { pageSize: 2.5 }],
    ['a page size past the bound', { pageSize: 10_001 }],
  ])('refuses %s as malformed', async (_label, patch) => {
    await grantAll()
    const response = await post(GMO_RESULTS_PATH, resultsBody(patch))
    expect(response.status).toBe(400)
    expect(source.listed).toHaveLength(0)
  })

  it('refuses a body that is not JSON, one that is an array, and one that is too large', async () => {
    await grantAll()
    expect((await post(GMO_RESULTS_PATH, '{not json')).status).toBe(400)
    expect((await post(GMO_RESULTS_PATH, [1, 2])).status).toBe(400)
    expect((await post(GMO_RESULTS_PATH, resultsBody({ padding: 'x'.repeat(70_000) }))).status).toBe(400)
  })
})

describe('describing one result', () => {
  it('answers the description, naming the result and its category by reference', async () => {
    await grantAll()
    const response = await post(GMO_DESCRIBE_PATH, describeBody())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ resultRef: RESULT_A, ref: REF_A, categoryLabel: 'GB / GL 分配', today: '2026-10-16', glossary: '# 口径' })
  })

  it('refuses a result reference that is not one', async () => {
    await grantAll()
    expect((await post(GMO_DESCRIBE_PATH, describeBody({ resultRef: 'nope' }))).status).toBe(400)
    expect((await post(GMO_DESCRIBE_PATH, describeBody({ resultRef: undefined }))).status).toBe(400)
  })

  it('answers a result in a category the member does not hold as not allowed', async () => {
    const response = await post(GMO_DESCRIBE_PATH, describeBody())
    expect(response.status).toBe(403)
  })
})

describe('asking one result', () => {
  it('answers the figures, naming the result and its category by reference', async () => {
    await grantAll()
    const response = await post(GMO_ASK_PATH, askBody({ kind: 'aggregate', metric: 'sum', groupBy: ['gb_vendor'], limit: 5 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ resultRef: RESULT_A, ref: REF_A, kind: 'aggregate', data: { total: 117 } })
    expect(source.asked[0]).toMatchObject({ upstreamId: A, upstreamResultId: RESULT, query: { kind: 'aggregate', metric: 'sum', groupBy: ['gb_vendor'], limit: 5, filters: {} } })
  })

  it('answers a result the source places elsewhere with a reason a member can act on', async () => {
    await grantAll()
    source.placement = 'another-category'
    const response = await post(GMO_ASK_PATH, askBody())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'gmo', reason: 'result-unavailable' })
    expect(source.asked).toHaveLength(0)
  })

  it.each([
    ['a question the source refused', new GmoError('invalid-query'), 422],
    ['a view the result does not have', new GmoError('unsupported'), 409],
    ['an answer too large to return', new GmoError('too-large'), 413],
    ['a source that did not answer', new GmoError('upstream-unavailable'), 502],
    ['a source that answered nonsense', new GmoError('upstream-invalid'), 502],
    ['a question the caller abandoned', new GmoError('cancelled'), 499],
  ])('answers %s', async (_label, failure, status) => {
    await grantAll()
    source.answer = failure
    const response = await post(GMO_ASK_PATH, askBody())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'gmo', reason: failure.reason })
  })

  it.each([
    ['no question', { query: undefined }],
    ['a question that is not an object', { query: 'sum everything' }],
    ['an unknown kind', { query: { kind: 'sql', statement: 'select 1' } }],
    ['a key the kind does not define', { query: { kind: 'aggregate', metric: 'sum', statement: 'select 1' } }],
    ['a result reference that is not one', { resultRef: 'nope' }],
  ])('refuses %s as malformed, asking nothing', async (_label, patch) => {
    await grantAll()
    const response = await post(GMO_ASK_PATH, askBody({ kind: 'aggregate', metric: 'sum' }, patch))
    expect(response.status).toBe(400)
    expect(source.placed).toHaveLength(0)
  })

  it('answers a defect of this deployment as internal, with no reason to act on', async () => {
    await grantAll()
    source.answer = new Error('boom')
    const response = await post(GMO_ASK_PATH, askBody())
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
    cp.provide('gmoGateway', { directory: () => Promise.reject(new GmoError('control-plane-unreachable')) })
    await cp.plugin(gmoHttp, gmoHttp.Config({})).await()
    origin = `http://127.0.0.1:${String(cp.webServer.port)}`
    const store = cp.get('accountStore') as AccountStore
    orgId = (await store.createOrganization('Acme')).id
    alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
    accessToken = await mintAccessToken()
    const response = await post(GMO_CATALOG_PATH, { protocolVersion: GMO_PROTOCOL_VERSION })
    expect(response.status).toBe(503)
  })
})

describe('reading a question', () => {
  it('reads an aggregation with every key it defines', () => {
    expect(readAskQuery({
      kind: 'aggregate', metric: 'distinct', field: 'pn', groupBy: ['gb_vendor', 'brand_l1'], dateGrain: 'month',
      orderBy: 'group_asc', limit: 20, filters: { multi: { supplier: ['HUNGO', '__null__'] } },
    })).toEqual({
      kind: 'aggregate', metric: 'distinct', field: 'pn', groupBy: ['gb_vendor', 'brand_l1'], dateGrain: 'month',
      orderBy: 'group_asc', limit: 20, filters: { multi: { supplier: ['HUNGO', '__null__'] } },
    })
  })

  it('reads an overview and a row page, and an absent filter set as an empty one', () => {
    expect(readAskQuery({ kind: 'overview', widget: 'balance_material', material: '713-00041-000-000' }))
      .toEqual({ kind: 'overview', widget: 'balance_material', filters: {}, material: '713-00041-000-000' })
    expect(readAskQuery({ kind: 'rows', sort: { field: 'remaining_gap', dir: 'desc' }, page: 2, pageSize: 50 }))
      .toEqual({ kind: 'rows', filters: {}, sort: { field: 'remaining_gap', dir: 'desc' }, page: 2, pageSize: 50 })
  })

  it.each([
    ['a metric this build does not know', { kind: 'aggregate', metric: 'avg' }],
    ['three group columns', { kind: 'aggregate', metric: 'sum', groupBy: ['a', 'b', 'c'] }],
    ['a column that is a statement', { kind: 'aggregate', metric: 'sum', groupBy: ['id; DROP TABLE t'] }],
    ['a column with a quote', { kind: 'aggregate', metric: 'sum', field: "x'" }],
    ['a grain this build does not know', { kind: 'aggregate', metric: 'sum', dateGrain: 'year' }],
    ['an order this build does not know', { kind: 'aggregate', metric: 'sum', orderBy: 'random' }],
    ['a limit that is not whole', { kind: 'aggregate', metric: 'sum', limit: 1.5 }],
    ['a widget this build does not know', { kind: 'overview', widget: 'sql' }],
    ['a keyword with a line break', { kind: 'overview', widget: 'balance', search: 'a\nb' }],
    ['a keyword past the bound', { kind: 'overview', widget: 'balance', search: 'x'.repeat(201) }],
    ['a sort direction this build does not know', { kind: 'rows', sort: { field: 'a', dir: 'up' } }],
    ['a sort key it does not define', { kind: 'rows', sort: { field: 'a', dir: 'asc', nulls: 'first' } }],
    ['a key borrowed from another kind', { kind: 'rows', metric: 'sum' }],
  ])('refuses %s', (_label, query) => {
    expect(readAskQuery(query)).toBe('invalid')
  })

  it('reads filters section by section and refuses anything it does not define', () => {
    expect(readFilters(undefined)).toEqual({})
    expect(readFilters({ search: { pn: '713' }, range: { next: { from: '2026-12-07', to: '2026-12-13' } }, empty: ['brand'] }))
      .toEqual({ search: { pn: '713' }, range: { next: { from: '2026-12-07', to: '2026-12-13' } }, empty: ['brand'] })
    for (const bad of [
      'x', [], { sql: 'select 1' }, { multi: 'x' }, { multi: { 'bad col': ['a'] } }, { multi: { a: 'x' } }, { multi: { a: [1] } },
      { multi: { a: ['x'.repeat(201)] } }, { multi: { a: Array.from({ length: 201 }, () => 'v') } },
      { search: { a: 7 } }, { search: { a: 'x\ny' } }, { range: { a: { from: 'yesterday' } } }, { range: { a: { at: '2026-01-01' } } },
      { range: { a: 'x' } }, { empty: 'a' }, { empty: ['bad col'] },
      { multi: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`c${String(index)}`, ['v']])) },
    ]) {
      expect(readFilters(bad)).toBe('invalid')
    }
  })

  it('reads a count only when it is a whole number within the bound', () => {
    expect(readCount(undefined)).toBeUndefined()
    expect(readCount(1)).toBe(1)
    expect(readCount(10_000)).toBe(10_000)
    for (const bad of [0, -1, 2.5, 10_001, '3', null]) expect(readCount(bad)).toBe('invalid')
  })
})
