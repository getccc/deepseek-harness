/**
 * The Runner-facing search route over a real HTTP server, a real device
 * credential, real access control and audit, and a scripted search backend —
 * because what this route is for is refusing things, and a refusal is only
 * worth testing against the machinery that would otherwise have allowed it.
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
import type { Audit } from '@deepseek-ai/dsh-audit'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import WebRuntime, { WebError, type WebSearchProvider, type WebSearchRequest, type WebSearchResult } from '@deepseek-ai/dsh-web'
import * as gateway from '@deepseek-ai/dsh-web-search-gateway-http'
import {
  WEB_ACCESS_PATH,
  WEB_SEARCH_ACTION,
  WEB_SEARCH_PATH,
  WEB_SEARCH_PROTOCOL_VERSION,
  WEB_SEARCH_RESOURCE_TYPE,
  reasonOf,
} from '@deepseek-ai/dsh-web-search-gateway-http'

/** A search backend a test scripts. */
class ScriptedSearch implements WebSearchProvider {
  readonly id = 'scripted'
  readonly requests: WebSearchRequest[] = []
  answer: WebSearchResult | Error = { sources: [], truncated: false }

  available(): boolean {
    return true
  }

  search(request: WebSearchRequest): Promise<WebSearchResult> {
    this.requests.push(request)
    return this.answer instanceof Error ? Promise.reject(this.answer) : Promise.resolve(this.answer)
  }
}

let home: string
let cp: Context
let origin: string
let access: AccessControl
let audit: Audit
let backend: ScriptedSearch
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
  home = mkdtempSync(join(tmpdir(), 'dsh-web-search-http-'))
  cp = new Context()
  await cp.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await cp.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await cp.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await cp.plugin(SqliteAudit, { path: join(home, 'audit.sqlite'), maxQueryRows: 500 }).await()
  await cp.plugin(SqliteDeviceAuthorization, {
    path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await cp.plugin(WebRuntime, { searchProvider: 'scripted' }).await()
  backend = new ScriptedSearch()
  cp.web.registerSearchProvider(backend)
  await cp.plugin(gateway, gateway.Config({})).await()
  origin = `http://127.0.0.1:${String(cp.webServer.port)}`

  const store = cp.get('accountStore') as AccountStore
  access = cp.get('accessControl') as AccessControl
  audit = cp.get('audit') as Audit
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
  accessToken = await mintAccessToken()
})

afterEach(async () => {
  await cp.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

/** Let Alice search the web. */
async function grant(): Promise<void> {
  const role = await access.createRole({ orgId, name: 'engineering' })
  await access.bindUserRole(alice, role.id)
  await access.grantType(role.id, WEB_SEARCH_RESOURCE_TYPE, WEB_SEARCH_ACTION)
}

/** Send no `authorization` header at all. */
const NO_TOKEN = 'none'

/**
 * POST one body to the search route. The token is a separate argument rather
 * than a defaulted one, so a test about sending none cannot silently send one.
 */
async function post(body: unknown, token: string | null = null, method = 'POST', path = WEB_SEARCH_PATH): Promise<Response> {
  const bearerToken = token ?? accessToken
  return fetch(`${origin}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === NO_TOKEN ? {} : { authorization: `Bearer ${bearerToken}` }),
    },
    body: method === 'GET' ? null : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** A well-formed search body. */
function searchBody(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { protocolVersion: WEB_SEARCH_PROTOCOL_VERSION, query: '中微公司 股价', ...patch }
}

describe('the version is decided before anything else', () => {
  it.each([
    ['an older version', 0],
    ['a newer version', WEB_SEARCH_PROTOCOL_VERSION + 1],
    ['a version that is not a number', 'one'],
    ['no version at all', undefined],
  ])('refuses %s with the supported range', async (_label, protocolVersion) => {
    const body: Record<string, unknown> = { query: '年假' }
    if (protocolVersion !== undefined) body['protocolVersion'] = protocolVersion
    const response = await post(body, NO_TOKEN)
    expect(response.status).toBe(426)
    expect(await response.json()).toEqual({
      error: 'web', reason: 'update-required', minimum: 1, current: WEB_SEARCH_PROTOCOL_VERSION,
    })
  })
})

describe('who is asking comes from the token', () => {
  it('refuses a request without a token, and one with a token it did not issue, alike', async () => {
    for (const token of [NO_TOKEN, 'not-a-token']) {
      const response = await post(searchBody(), token)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'web', reason: 'unauthenticated' })
    }
    expect(backend.requests).toEqual([])
  })

  it('refuses a member no role lets search, and records the refusal', async () => {
    const response = await post(searchBody())
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'web', reason: 'not-allowed' })
    expect(backend.requests).toEqual([])
    const events = await audit.query({ orgId, action: 'web.search' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ outcome: 'denied', reason: 'no-grant', principalId: alice, resourceId: orgId })
    // The governed resource now exists, so a type grant can cover it.
    expect((await access.listResources(orgId, WEB_SEARCH_RESOURCE_TYPE)).map(resource => resource.externalRef)).toEqual([orgId])
  })
})

describe('a granted member searches through the Control Plane', () => {
  it('answers the web service result verbatim and records the source count', async () => {
    await grant()
    backend.answer = {
      content: 'an answer',
      sources: [{ url: 'https://a.test/x', title: 'A', snippet: 'about a', publishedAt: '2026-01-01' }, { url: 'https://b.test/y' }],
      truncated: true,
    }
    const response = await post(searchBody({ maxResults: 2 }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(backend.answer)
    expect(backend.requests).toEqual([{ query: '中微公司 股价', maxResults: 2 }])
    const events = await audit.query({ orgId, action: 'web.search' })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ outcome: 'allowed', principalId: alice, metadata: { itemCount: 2 } })
  })

  it('omits an absent content and an absent bound rather than inventing them', async () => {
    await grant()
    const response = await post(searchBody())
    expect(await response.json()).toEqual({ sources: [], truncated: false })
    expect(backend.requests).toEqual([{ query: '中微公司 股价' }])
    // Registered once per organization, not once per search.
    await post(searchBody())
    expect(await access.listResources(orgId, WEB_SEARCH_RESOURCE_TYPE)).toHaveLength(1)
  })

  it.each([
    ['a missing query', { query: undefined }],
    ['a blank query', { query: '   ' }],
    ['a query that is not text', { query: 3 }],
    ['a bound that is not a whole number', { maxResults: 1.5 }],
    ['a bound below one', { maxResults: 0 }],
    ['a bound that is not a number', { maxResults: '3' }],
  ])('refuses %s as malformed', async (_label, patch) => {
    await grant()
    // An undefined patch value removes the field rather than sending `null`.
    const body = Object.fromEntries(
      Object.entries({ ...searchBody(), ...patch }).filter(([, value]) => value !== undefined),
    )
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'malformed' })
    expect(backend.requests).toEqual([])
  })

  it('refuses a body that is not JSON, one that is not an object, one too large, and a method other than POST', async () => {
    await grant()
    expect((await post('not json')).status).toBe(400)
    expect((await post([1, 2])).status).toBe(400)
    expect((await post(searchBody({ query: 'x'.repeat(20_000) }))).status).toBe(400)
    const response = await post(undefined, null, 'GET')
    expect(response.status).toBe(405)
    expect(await response.json()).toEqual({ error: 'method not allowed' })
  })
})

describe('the decision route', () => {
  it('answers the member\'s web.search decision without recording anything', async () => {
    let response = await post({ protocolVersion: WEB_SEARCH_PROTOCOL_VERSION }, null, 'POST', WEB_ACCESS_PATH)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ allowed: false })
    // The governed resource exists from the first decision, so a grant can cover it.
    expect(await access.listResources(orgId, WEB_SEARCH_RESOURCE_TYPE)).toHaveLength(1)
    await grant()
    response = await post({ protocolVersion: WEB_SEARCH_PROTOCOL_VERSION }, null, 'POST', WEB_ACCESS_PATH)
    expect(await response.json()).toEqual({ allowed: true })
    expect(await audit.query({ orgId, action: 'web.search' })).toEqual([])
    expect(backend.requests).toEqual([])
  })

  it('decides the version and the token the same way the search route does', async () => {
    expect((await post({ protocolVersion: 0 }, NO_TOKEN, 'POST', WEB_ACCESS_PATH)).status).toBe(426)
    expect((await post({ protocolVersion: WEB_SEARCH_PROTOCOL_VERSION }, NO_TOKEN, 'POST', WEB_ACCESS_PATH)).status).toBe(401)
    expect((await post(undefined, null, 'GET', WEB_ACCESS_PATH)).status).toBe(405)
  })
})

describe('a search that fails after it was allowed', () => {
  it.each([
    ['no credential', 'WEB_PROVIDER_CREDENTIAL_MISSING', 'upstream-unavailable', 502],
    ['no usable provider', 'WEB_PROVIDER_UNAVAILABLE', 'upstream-unavailable', 502],
    ['a provider error', 'WEB_PROVIDER_ERROR', 'upstream-invalid', 502],
    ['a cancelled search', 'WEB_ABORTED', 'cancelled', 499],
  ])('answers %s as %s and records the failure', async (_label, code, reason, status) => {
    await grant()
    backend.answer = new WebError('scripted failure', code)
    const response = await post(searchBody())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: 'web', reason })
    const events = await audit.query({ orgId, action: 'web.search' })
    expect(events[0]).toMatchObject({ outcome: 'error', metadata: { webFailure: reason } })
  })

  it('answers a failure that is not a web failure as internal, and records it without a reason', async () => {
    await grant()
    backend.answer = new Error('disk on fire')
    const response = await post(searchBody())
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal' })
    const events = await audit.query({ orgId, action: 'web.search' })
    expect(events[0]).toMatchObject({ outcome: 'error' })
    expect(events[0]?.metadata).toEqual({})
    expect(reasonOf(new Error('plain'))).toBeUndefined()
  })
})
