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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import { newSecret, pkceChallenge } from '@deepseek-ai/dsh-device-authorization'
import * as endpoints from '../src/index.ts'
import { DEVICE_PATH_PREFIX, REDEEM_PATH, REFRESH_PATH, START_PATH } from '../src/protocol.ts'

let ctx: Context
let origin: string

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
async function post(path: string, body: unknown, method = 'POST'): Promise<{
  status: number
  answer: Record<string, unknown>
}> {
  const response = await fetch(`${origin}${DEVICE_PATH_PREFIX}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
  return { status: response.status, answer: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(SqliteDeviceAuthorization, {
    path: ':memory:',
    transactionTtlMs: 300_000,
    codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000,
    refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await ctx.plugin(endpoints, endpoints.Config({} as never)).await()
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
    await ctxSmall.plugin(SqliteDeviceAuthorization, {
      path: ':memory:',
      transactionTtlMs: 1,
      codeTtlMs: 1,
      accessTokenTtlMs: 1,
      refreshTokenTtlMs: 1,
    }).await()
    await ctxSmall.plugin(endpoints, endpoints.Config({ maxRequestBodyBytes: 16 } as never)).await()
    const response = await fetch(
      `http://127.0.0.1:${String(ctxSmall.webServer.port)}${DEVICE_PATH_PREFIX}${START_PATH}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(startBody()) },
    )
    expect(response.status).toBe(400)
    expect((await response.json() as Record<string, unknown>).error).toBe('body too large')
    await ctxSmall.fiber.dispose()
  })

  it('answers a method other than POST without reading a body', async () => {
    for (const path of [START_PATH, REDEEM_PATH, REFRESH_PATH]) {
      expect((await post(path, undefined, 'GET')).status, path).toBe(405)
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

describe('a failure that is not a refusal', () => {
  it('says nothing about itself', async () => {
    const broken = new Context()
    await broken.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    broken.provide('deviceAuthorization', {
      start: () => Promise.reject(new Error('the database is on fire')),
    })
    await broken.plugin(endpoints, endpoints.Config({} as never)).await()
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

describe('mounted with no config', () => {
  it('serves the default prefix and reads a default-sized body', async () => {
    const bare = new Context()
    await bare.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await bare.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await bare.plugin(SqliteDeviceAuthorization, {
      path: ':memory:',
      transactionTtlMs: 300_000,
      codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000,
      refreshTokenTtlMs: 2_592_000_000,
    }).await()
    await bare.plugin(endpoints).await()
    const response = await fetch(
      `http://127.0.0.1:${String(bare.webServer.port)}${DEVICE_PATH_PREFIX}${START_PATH}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(startBody()) },
    )
    expect(response.status).toBe(200)
    await bare.fiber.dispose()
  })
})
