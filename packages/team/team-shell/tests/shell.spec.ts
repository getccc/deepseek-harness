/**
 * The confirmation page, driven the way a browser drives it: a form post with
 * an Origin, a session cookie, and the CSRF token the page rendered.
 *
 * The three refusals are what these tests are really for. Confirming a
 * computer must carry a session, come from this site, and echo this session's
 * own token, and dropping any one of them must be a refusal rather than a
 * binding nobody asked for.
 */

import { request as httpRequest } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import SqliteAudit from '@deepseek-ai/dsh-audit-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { Audit } from '@deepseek-ai/dsh-audit'
import type { DeviceAuthorization } from '@deepseek-ai/dsh-device-authorization'
import { csrfToken, hashToken, newSessionToken } from '@deepseek-ai/dsh-team-browser-session'
import * as shell from '../src/index.ts'

/** One response, read the way a browser would see it. */
interface Landing {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

let ctx: Context
let origin: string
let store: AccountStore
let audit: Audit
let devices: DeviceAuthorization
let orgId: OrgId
let alice: UserId
let cookie: string
let csrf: string

/** Make one request with exactly these headers. */
function send(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Landing> {
  const { method = 'GET', headers = {}, body } = init
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}${path}`, { method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      res.on('end', () => {
        resolve({
          status: res.statusCode as number,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

/** Read one response header as a single value. */
function head(landing: Landing, name: string): string | undefined {
  const value = landing.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** Pull the CSRF token out of a rendered page. */
function readCsrf(body: string): string {
  const match = /name="csrf" value="([^"]+)"/u.exec(body)
  expect(match?.[1], 'the page should render a CSRF token').toBeDefined()
  return match?.[1] as string
}

/** Submit a form the way the rendered page would. */
function submit(path: string, fields: Record<string, string>): Promise<Landing> {
  return send(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin },
    body: new URLSearchParams(fields).toString(),
  })
}

/** Open a transaction the way a Runner does. */
async function pending(): Promise<{ id: string; pairingCode: string }> {
  const started = await devices.start({
    publicKey: 'a-public-key',
    platform: 'darwin',
    runnerVersion: '2.4.1',
    pkceChallenge: 'a-challenge',
    callbackUri: 'http://127.0.0.1:3080/team/callback',
    protocolVersion: 1,
  })
  return { id: started.transactionId, pairingCode: started.pairingCode }
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
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
  devices = ctx.get('deviceAuthorization') as DeviceAuthorization
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id

  // Signing in belongs to the administration API; this page only resolves the
  // session a browser already carries, so the test opens one directly.
  const token = newSessionToken()
  await store.createBrowserSession(alice, hashToken(token), Date.now() + 3_600_000)
  cookie = `${shell.SESSION_COOKIE}=${token}`
  csrf = csrfToken(token)

  await ctx.plugin(shell, shell.Config({} as never)).await()
  origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('confirming a computer', () => {
  it('shows what the member compares, and sends the browser back with the code', async () => {
    const transaction = await pending()
    const shown = await send(`/team/confirm/${transaction.id}?state=runner-state`, { headers: { cookie } })
    expect(shown.status).toBe(200)
    expect(shown.body).toContain(transaction.pairingCode)
    expect(shown.body).toContain('darwin')
    expect(shown.body).toContain('2.4.1')

    const confirmed = await submit(`/team/confirm/${transaction.id}`, {
      csrf: readCsrf(shown.body), state: 'runner-state',
    })
    expect(confirmed.status).toBe(303)
    const back = new URL(head(confirmed, 'location') as string)
    expect(back.origin).toBe('http://127.0.0.1:3080')
    expect(back.pathname).toBe('/team/callback')
    expect(back.searchParams.get('state')).toBe('runner-state')
    expect(back.searchParams.get('code')?.length).toBeGreaterThan(0)
    expect((await audit.query({ orgId, action: 'device.bind' }))[0]).toMatchObject({
      principalId: alice, outcome: 'allowed',
    })
  })

  it('sends an unsigned browser to the console, and comes back to the same transaction', async () => {
    const transaction = await pending()
    const sent = await send(`/team/confirm/${transaction.id}?state=s`)
    expect(sent.status).toBe(303)
    // The console is where signing in happens, and `next` is what brings the
    // member back to the page they were actually sent.
    expect(head(sent, 'location')).toContain(shell.CONSOLE_PATH)
    expect(head(sent, 'location')).toContain(encodeURIComponent(`/team/confirm/${transaction.id}`))
  })

  it('tells a member plainly when the request is not one this site knows', async () => {
    const shown = await send('/team/confirm/no-such-transaction', { headers: { cookie } })
    expect(shown.status).toBe(400)
    expect(shown.body).toContain('not one this site knows about')

    // The same for a confirmation posted against it: nothing to confirm.
    const posted = await submit('/team/confirm/no-such-transaction', { csrf, state: 's' })
    expect(posted.status).toBe(400)
    expect(posted.body).toContain('not one this site knows about')
  })

  it('refuses a second confirmation and records the refusal', async () => {
    const transaction = await pending()
    await submit(`/team/confirm/${transaction.id}`, { csrf, state: 's' })
    const again = await submit(`/team/confirm/${transaction.id}`, { csrf, state: 's' })
    expect(again.status).toBe(400)
    expect(again.body).toContain('already confirmed')
    expect(await audit.query({ orgId, action: 'device.bind', outcome: 'denied' })).toHaveLength(1)
  })
})

describe('a confirmation needs all three', () => {
  it('refuses one that carries no session', async () => {
    const transaction = await pending()
    const refused = await send(`/team/confirm/${transaction.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ csrf, state: 's' }).toString(),
    })
    expect(refused.status).toBe(403)
    expect(await devices.listDevices(orgId)).toEqual([])
  })

  it('refuses one from another site, and one with no Origin at all', async () => {
    const transaction = await pending()
    for (const headers of [
      { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: 'https://evil.example' },
      { 'content-type': 'application/x-www-form-urlencoded', cookie },
    ]) {
      const refused = await send(`/team/confirm/${transaction.id}`, {
        method: 'POST', headers, body: new URLSearchParams({ csrf, state: 's' }).toString(),
      })
      expect(refused.status).toBe(403)
    }
    expect(await devices.listDevices(orgId)).toEqual([])
  })

  it('refuses one whose form carries no token of this session', async () => {
    const transaction = await pending()
    for (const fields of [{ state: 's' }, { csrf: csrfToken('another session'), state: 's' }]) {
      expect((await submit(`/team/confirm/${transaction.id}`, fields)).status).toBe(403)
    }
    expect(await devices.listDevices(orgId)).toEqual([])
  })

  it('refuses a method this address does not accept', async () => {
    const transaction = await pending()
    const refused = await send(`/team/confirm/${transaction.id}`, {
      method: 'DELETE', headers: { cookie, origin },
    })
    expect(refused.status).toBe(405)
  })

  it('refuses a form larger than the page accepts', async () => {
    const transaction = await pending()
    const huge = await submit(`/team/confirm/${transaction.id}`, {
      csrf, state: 'x'.repeat(20_000),
    })
    expect(huge.status).toBe(413)
    expect(await devices.listDevices(orgId)).toEqual([])
  })
})

describe('when the seam runs out of time, or the site cannot answer', () => {
  it('tells a member when a confirmation request has run out of time', async () => {
    const brief = new Context()
    await brief.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await brief.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await brief.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    await brief.plugin(SqliteDeviceAuthorization, {
      path: ':memory:',
      // Already expired by the time the page reads it, which is the state a
      // member reaches by leaving the pairing page open.
      transactionTtlMs: 1,
      codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000,
      refreshTokenTtlMs: 2_592_000_000,
    }).await()
    const briefStore = brief.get('accountStore') as AccountStore
    const briefOrg = (await briefStore.createOrganization('Acme')).id
    const bob = (await briefStore.createUser({ orgId: briefOrg, loginName: 'bob', displayName: 'Bob' })).id
    const token = newSessionToken()
    await briefStore.createBrowserSession(bob, hashToken(token), Date.now() + 3_600_000)
    await brief.plugin(shell, shell.Config({} as never)).await()

    const started = await (brief.get('deviceAuthorization') as DeviceAuthorization).start({
      publicKey: 'a-public-key', platform: 'linux', runnerVersion: '1.0.0',
      pkceChallenge: 'a-challenge',
      callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
    })
    const briefOrigin = `http://127.0.0.1:${String(brief.webServer.port)}`
    const shown = await new Promise<Landing>((resolve, reject) => {
      const req = httpRequest(
        `${briefOrigin}/team/confirm/${started.transactionId}?state=s`,
        { headers: { cookie: `${shell.SESSION_COOKIE}=${token}` } },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
          res.on('end', () => {
            resolve({
              status: res.statusCode as number,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          })
        },
      )
      req.on('error', reject)
      req.end()
    })
    expect(shown.status).toBe(400)
    expect(shown.body).toContain('took too long')

    // A confirmation posted against it records the seam's own word, so the
    // trail says the request ran out of time rather than only that it failed.
    const briefOrigin2 = `http://127.0.0.1:${String(brief.webServer.port)}`
    await new Promise<Landing>((resolve, reject) => {
      const req = httpRequest(`${briefOrigin2}/team/confirm/${started.transactionId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: `${shell.SESSION_COOKIE}=${token}`,
          origin: briefOrigin2,
        },
      }, (res) => {
        res.on('data', () => {})
        res.on('end', () => {
          resolve({ status: res.statusCode as number, headers: res.headers, body: '' })
        })
      })
      req.on('error', reject)
      req.write(new URLSearchParams({ csrf: csrfToken(token), state: 's' }).toString())
      req.end()
    })
    expect((await (brief.get('audit') as Audit).query({ orgId: briefOrg, outcome: 'denied' }))[0])
      .toMatchObject({ action: 'device.bind', reason: 'expired' })
    await brief.fiber.dispose()
  })

  it('says the site could not answer, rather than that the request was unrecognized', async () => {
    const broken = new Context()
    await broken.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await broken.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await broken.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    broken.provide('deviceAuthorization', {
      describe: () => Promise.reject(new Error('the database is on fire')),
      confirm: () => Promise.reject(new Error('the database is on fire')),
    })
    const brokenStore = broken.get('accountStore') as AccountStore
    const brokenOrg = (await brokenStore.createOrganization('Acme')).id
    const bob = (await brokenStore.createUser({ orgId: brokenOrg, loginName: 'bob', displayName: 'Bob' })).id
    const token = newSessionToken()
    await brokenStore.createBrowserSession(bob, hashToken(token), Date.now() + 3_600_000)
    await broken.plugin(shell, shell.Config({} as never)).await()
    const brokenOrigin = `http://127.0.0.1:${String(broken.webServer.port)}`
    const brokenCookie = `${shell.SESSION_COOKIE}=${token}`

    const call = (init: { method?: string; headers?: Record<string, string>; body?: string }) =>
      new Promise<Landing>((resolve, reject) => {
        const req = httpRequest(`${brokenOrigin}/team/confirm/anything`, {
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
        }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
          res.on('end', () => {
            resolve({
              status: res.statusCode as number,
              headers: res.headers,
              body: Buffer.concat(chunks).toString('utf8'),
            })
          })
        })
        req.on('error', reject)
        if (init.body !== undefined) req.write(init.body)
        req.end()
      })

    const shown = await call({ headers: { cookie: brokenCookie } })
    expect(shown.status).toBe(500)
    expect(shown.body).toContain('could not answer')

    const posted = await call({
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded', cookie: brokenCookie, origin: brokenOrigin,
      },
      body: new URLSearchParams({ csrf: csrfToken(token), state: 's' }).toString(),
    })
    expect(posted.status).toBe(500)
    // The record says the site failed, not that the member was refused.
    expect((await (broken.get('audit') as Audit).query({ orgId: brokenOrg }))[0])
      .toMatchObject({ action: 'device.bind', outcome: 'error' })
    await broken.fiber.dispose()
  })
})
