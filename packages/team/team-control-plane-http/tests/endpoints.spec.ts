/**
 * The wire boundary: what these three endpoints accept, and what they answer
 * when a caller sends something they cannot act on.
 *
 * The seam's own refusals are covered where the seam lives. What is proved here
 * is that a body arriving over HTTP is parsed into the seam's request before
 * the seam sees it — the seam's types are a promise its callers keep, and a
 * caller that reached it over HTTP has made no such promise.
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import PasswordAccountAuth from '@deepseek-ai/dsh-account-auth-password'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import type { Audit } from '@deepseek-ai/dsh-audit'
import SqliteAudit from '@deepseek-ai/dsh-audit-sqlite'
import type { DeviceAuthorization } from '@deepseek-ai/dsh-device-authorization'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import { newSecret, pkceChallenge } from '@deepseek-ai/dsh-device-authorization'
import * as endpoints from '../src/index.ts'
import {
  DEVICE_PATH_PREFIX,
  LOGIN_PATH,
  MINIMUM_PROTOCOL_VERSION,
  PASSWORD_PATH,
  PROTOCOL_VERSION,
  REDEEM_PATH,
  REFRESH_PATH,
  START_PATH,
  protocolSupport,
} from '../src/protocol.ts'

let ctx: Context
let origin: string
let store: AccountStore
let audit: Audit
let orgId: OrgId
let alice: UserId

const PASSWORD = 'Correct-Horse-Battery-1'

/** A well-formed request to open a transaction. */
function startBody(): Record<string, unknown> {
  return {
    publicKey: 'a-public-key',
    platform: 'darwin',
    runnerVersion: '2.4.1',
    pkceChallenge: pkceChallenge(newSecret()),
    callbackUri: 'http://127.0.0.1:3080/team/callback',
    protocolVersion: 1,
  }
}

/** POST one JSON body and read the status and the parsed answer. */
async function post(path: string, body: unknown, method = 'POST', headers: Record<string, string> = {}): Promise<{
  status: number
  answer: Record<string, unknown>
}> {
  const response = await fetch(`${origin}${DEVICE_PATH_PREFIX}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
  return { status: response.status, answer: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(PasswordAccountAuth, {
    minSecretLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
    maxFailedAttempts: 5, lockDurationMs: 60_000,
    cost: 2, blockSize: 8, parallelization: 1,
  }).await()
  await ctx.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
  await ctx.plugin(SqliteDeviceAuthorization, {
    path: ':memory:',
    transactionTtlMs: 300_000,
    codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000,
    refreshTokenTtlMs: 2_592_000_000,
  }).await()
  store = ctx.get('accountStore') as AccountStore
  audit = ctx.get('audit') as Audit
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
  await ctx.accountAuth.setSecret(alice, PASSWORD)
  await ctx.plugin(endpoints, endpoints.Config({ organizationId: orgId } as never)).await()
  origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('opening a transaction', () => {
  it('answers with the pairing code and the transaction it belongs to', async () => {
    const { status, answer } = await post(START_PATH, startBody())
    expect(status).toBe(200)
    expect(answer.pairingCode).toMatch(/^[BCDFGHJKMNPQRSTVWXZ23456789]{4}-[BCDFGHJKMNPQRSTVWXZ23456789]{4}$/u)
    expect(typeof answer.transactionId).toBe('string')
  })

  it('refuses a body missing a field the seam requires', async () => {
    for (const field of ['publicKey', 'runnerVersion', 'pkceChallenge', 'callbackUri']) {
      const body = Object.fromEntries(
        Object.entries(startBody()).filter(([name]) => name !== field),
      )
      const { status, answer } = await post(START_PATH, body)
      expect(status, field).toBe(400)
      expect(answer.reason, field).toBe('malformed-body')
    }
  })

  it('refuses a platform the device word list does not govern', async () => {
    const { status, answer } = await post(START_PATH, { ...startBody(), platform: 'plan9' })
    expect(status).toBe(400)
    expect(answer.reason).toBe('malformed-body')
  })

  it('refuses a protocol version that is not a whole number', async () => {
    const { status } = await post(START_PATH, { ...startBody(), protocolVersion: 'one' })
    expect(status).toBe(400)
  })

  it('refuses a body that is not a JSON object', async () => {
    expect((await post(START_PATH, 'not json')).status).toBe(400)
    expect((await post(START_PATH, '[1, 2]')).status).toBe(400)
  })

  it('refuses a body larger than the endpoint reads', async () => {
    const ctxSmall = new Context()
    await ctxSmall.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await ctxSmall.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await ctxSmall.plugin(PasswordAccountAuth, {
      minSecretLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
      maxFailedAttempts: 5, lockDurationMs: 60_000,
      cost: 2, blockSize: 8, parallelization: 1,
    }).await()
    await ctxSmall.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    await ctxSmall.plugin(SqliteDeviceAuthorization, {
      path: ':memory:',
      transactionTtlMs: 1,
      codeTtlMs: 1,
      accessTokenTtlMs: 1,
      refreshTokenTtlMs: 1,
    }).await()
    await ctxSmall.plugin(endpoints, endpoints.Config({
      organizationId: 'test', maxRequestBodyBytes: 16,
    } as never)).await()
    const response = await fetch(
      `http://127.0.0.1:${String(ctxSmall.webServer.port)}${DEVICE_PATH_PREFIX}${START_PATH}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(startBody()) },
    )
    expect(response.status).toBe(400)
    expect((await response.json() as Record<string, unknown>).error).toBe('body too large')
    await ctxSmall.fiber.dispose()
  })

  it('answers a method other than POST without reading a body', async () => {
    for (const path of [START_PATH, REDEEM_PATH, REFRESH_PATH, PASSWORD_PATH]) {
      expect((await post(path, undefined, 'GET')).status, path).toBe(405)
    }
  })
})

describe('authenticating a member', () => {
  it('approves the Runner transaction and records the authenticated account', async () => {
    const started = await post(START_PATH, startBody())
    const login = await post(LOGIN_PATH, {
      transactionId: started.answer.transactionId,
      loginName: 'alice',
      secret: PASSWORD,
      protocolVersion: PROTOCOL_VERSION,
    })

    expect(login.status).toBe(200)
    expect(login.answer.code).toEqual(expect.any(String))
    expect(login.answer.member).toEqual({ loginName: 'alice', displayName: 'Alice' })
    const [record] = await audit.query({ orgId, action: 'member.login' })
    expect(record?.outcome).toBe('allowed')
    expect(record?.principalId).toBe(alice)
  })

  it('gives wrong and unknown credentials the same reasonless answer', async () => {
    for (const [loginName, secret] of [['alice', 'wrong-password'], ['nobody', PASSWORD]]) {
      const started = await post(START_PATH, startBody())
      const login = await post(LOGIN_PATH, {
        transactionId: started.answer.transactionId,
        loginName,
        secret,
        protocolVersion: PROTOCOL_VERSION,
      })
      expect(login).toEqual({ status: 401, answer: { error: 'unauthorized' } })
    }
  })
})

describe('redeeming and refreshing', () => {
  it('passes the seam its refusal word through', async () => {
    const { status, answer } = await post(REDEEM_PATH, {
      transactionId: 'no-such-transaction',
      code: newSecret(),
      pkceVerifier: newSecret(),
      deviceSignature: 'x',
      callbackUri: 'http://127.0.0.1:3080/team/callback',
      protocolVersion: 1,
    })
    expect(status).toBe(403)
    expect(answer).toEqual({ error: 'refused', reason: 'unknown' })
  })

  it('refuses a refresh body missing its family', async () => {
    const { status, answer } = await post(REFRESH_PATH, { refreshToken: newSecret(), deviceSignature: 'x' })
    expect(status).toBe(400)
    expect(answer.reason).toBe('malformed-body')
  })

  it('answers an unknown refresh token with the seam word', async () => {
    const { status, answer } = await post(REFRESH_PATH, {
      familyId: 'no-such-family',
      refreshToken: newSecret(),
      deviceSignature: 'x',
    })
    expect(status).toBe(403)
    expect(answer.reason).toBe('unknown')
  })
})

describe('changing a password', () => {
  const NEXT = 'Another-Horse-Battery-2'
  const TOKEN = 'a-device-access-token'
  let claims: { orgId: OrgId; principalId: UserId; deviceId: string; issuedAt: number; expiresAt: number }
  let listDevices: MockInstance<DeviceAuthorization['listDevices']>

  const change = (body: unknown, authorization: string | null = `Bearer ${TOKEN}`) =>
    post(PASSWORD_PATH, body, 'POST', authorization === null ? {} : { authorization })

  beforeEach(() => {
    claims = { orgId, principalId: alice, deviceId: 'device-1', issuedAt: 0, expiresAt: Date.now() + 60_000 }
    vi.spyOn(ctx.deviceAuthorization, 'verifyAccessToken')
      .mockImplementation(token => Promise.resolve(token === TOKEN ? claims as never : undefined))
    listDevices = vi.spyOn(ctx.deviceAuthorization, 'listDevices').mockResolvedValue([])
  })

  it('replaces the password of the account the access token belongs to', async () => {
    const answer = await change({ currentSecret: PASSWORD, newSecret: NEXT, protocolVersion: PROTOCOL_VERSION })
    expect(answer).toEqual({ status: 200, answer: { changed: true } })
    expect((await ctx.accountAuth.authenticate(orgId, 'alice', NEXT)).ok).toBe(true)
    expect((await ctx.accountAuth.authenticate(orgId, 'alice', PASSWORD)).ok).toBe(false)
  })

  it('revokes the account\'s other active devices and keeps the requesting one', async () => {
    const device = (id: string, ownerId: UserId, status: 'active' | 'revoked') => ({ id, ownerId, status }) as never
    listDevices.mockResolvedValue([
      device('device-1', alice, 'active'),
      device('device-2', alice, 'active'),
      device('device-3', alice, 'revoked'),
      device('device-4', 'someone-else' as UserId, 'active'),
    ])
    const revoke = vi.spyOn(ctx.deviceAuthorization, 'revokeDevice').mockResolvedValue()
    const revokeSessions = vi.spyOn(store, 'revokeBrowserSessions')
    await change({ currentSecret: PASSWORD, newSecret: NEXT })
    expect(revoke.mock.calls).toEqual([['device-2']])
    expect(revokeSessions).toHaveBeenCalledWith(alice)
  })

  it('refuses a request without a usable bearer token', async () => {
    const body = { currentSecret: PASSWORD, newSecret: NEXT }
    for (const authorization of [null, TOKEN, `Basic ${TOKEN}`, 'Bearer', `Bearer ${TOKEN} extra`, 'Bearer wrong']) {
      expect(await change(body, authorization), String(authorization)).toEqual({
        status: 401, answer: { error: 'unauthorized' },
      })
    }
    expect((await ctx.accountAuth.authenticate(orgId, 'alice', PASSWORD)).ok).toBe(true)
  })

  it('refuses a token that belongs to another organization or to no account', async () => {
    const body = { currentSecret: PASSWORD, newSecret: NEXT }
    claims = { ...claims, orgId: 'other-org' as OrgId }
    expect((await change(body)).status).toBe(401)
    claims = { ...claims, orgId, principalId: 'nobody' as UserId }
    expect((await change(body)).status).toBe(401)
  })

  it('refuses a wrong current password and records the denial', async () => {
    const answer = await change({ currentSecret: 'Wrong-Horse-Battery-9', newSecret: NEXT })
    expect(answer).toEqual({ status: 403, answer: { error: 'refused', reason: 'current-secret-incorrect' } })
    const [record] = await audit.query({ orgId, action: 'member.password.change' })
    expect(record).toMatchObject({ outcome: 'denied', reason: 'invalid-credentials', principalId: alice })
  })

  it('refuses the password it already is, before the policy sees it', async () => {
    expect(await change({ currentSecret: PASSWORD, newSecret: PASSWORD })).toEqual({
      status: 400, answer: { error: 'refused', reason: 'secret-unchanged' },
    })
  })

  it('answers the rules of a password the deployment refuses, as fields', async () => {
    const { status, answer } = await change({ currentSecret: PASSWORD, newSecret: 'short' })
    expect(status).toBe(400)
    expect(answer).toEqual({
      error: 'refused',
      reason: 'weak-secret',
      policy: { minLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'] },
    })
  })

  it('refuses a body missing a password', async () => {
    for (const body of [{ newSecret: NEXT }, { currentSecret: PASSWORD }, { currentSecret: PASSWORD, newSecret: 7 }]) {
      const { status, answer } = await change(body)
      expect(status).toBe(400)
      expect(answer.reason).toBe('malformed-body')
    }
  })

  it('says nothing about a failure of the account provider', async () => {
    vi.spyOn(ctx.accountAuth, 'setSecret').mockRejectedValue(new Error('the hash function is on fire'))
    expect(await change({ currentSecret: PASSWORD, newSecret: NEXT })).toEqual({
      status: 500, answer: { error: 'internal' },
    })
  })
})

describe('a failure that is not a refusal', () => {
  it('says nothing about itself', async () => {
    const broken = new Context()
    await broken.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    broken.provide('accountStore', {})
    broken.provide('accountAuth', {})
    broken.provide('audit', {})
    broken.provide('deviceAuthorization', {
      start: () => Promise.reject(new Error('the database is on fire')),
    })
    await broken.plugin(endpoints, endpoints.Config({ organizationId: 'test' } as never)).await()
    const response = await fetch(
      `http://127.0.0.1:${String(broken.webServer.port)}${DEVICE_PATH_PREFIX}${START_PATH}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(startBody()) },
    )
    expect(response.status).toBe(500)
    // A Runner learns that this deployment has a problem, and nothing else.
    expect(await response.text()).toBe(JSON.stringify({ error: 'internal' }))
    await broken.fiber.dispose()
  })
})

describe('mounted with default endpoint config', () => {
  it('serves the default prefix and reads a default-sized body', async () => {
    const bare = new Context()
    await bare.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await bare.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await bare.plugin(PasswordAccountAuth, {
      minSecretLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
      maxFailedAttempts: 5, lockDurationMs: 60_000,
      cost: 2, blockSize: 8, parallelization: 1,
    }).await()
    await bare.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    await bare.plugin(SqliteDeviceAuthorization, {
      path: ':memory:',
      transactionTtlMs: 300_000,
      codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000,
      refreshTokenTtlMs: 2_592_000_000,
    }).await()
    await bare.plugin(endpoints, endpoints.Config({ organizationId: 'test' } as never)).await()
    const response = await fetch(
      `http://127.0.0.1:${String(bare.webServer.port)}${DEVICE_PATH_PREFIX}${START_PATH}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(startBody()) },
    )
    expect(response.status).toBe(200)
    await bare.fiber.dispose()
  })
})

describe('speaking the same protocol', () => {
  it('places a version on one side of the supported range', () => {
    expect(protocolSupport(PROTOCOL_VERSION)).toBe('supported')
    expect(protocolSupport(MINIMUM_PROTOCOL_VERSION)).toBe('supported')
    expect(protocolSupport(MINIMUM_PROTOCOL_VERSION - 1)).toBe('too-old')
    // Not the Runner's fault: this Control Plane is the one that needs updating.
    expect(protocolSupport(PROTOCOL_VERSION + 1)).toBe('too-new')
  })

  it('refuses an unsupported version with the range the Runner must act on', async () => {
    for (const version of [MINIMUM_PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1]) {
      const { status, answer } = await post(START_PATH, { ...startBody(), protocolVersion: version })
      // 426 rather than 400: the request was understood and refused for what
      // the Runner is, which is the one refusal an update fixes.
      expect(status, String(version)).toBe(426)
      expect(answer, String(version)).toEqual({
        error: 'refused',
        reason: 'protocol-unsupported',
        minimum: MINIMUM_PROTOCOL_VERSION,
        current: PROTOCOL_VERSION,
      })
    }
  })

  it('decides the version before reading anything else, on every endpoint', async () => {
    // A body that is otherwise empty still gets the protocol answer, so a
    // Runner too old to know a field exists is not told about that field.
    for (const path of [START_PATH, REDEEM_PATH, REFRESH_PATH, PASSWORD_PATH]) {
      const { status, answer } = await post(path, { protocolVersion: PROTOCOL_VERSION + 1 })
      expect(status, path).toBe(426)
      expect(answer.reason, path).toBe('protocol-unsupported')
    }
  })

  it('leaves a missing version to the endpoint that names the field', async () => {
    const body = Object.fromEntries(
      Object.entries(startBody()).filter(([name]) => name !== 'protocolVersion'),
    )
    const { status, answer } = await post(START_PATH, body)
    expect(status).toBe(400)
    expect(answer.reason).toBe('malformed-body')
  })
})
