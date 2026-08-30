/**
 * The Control Plane's pages, driven the way a browser drives them: form posts
 * with an Origin, a session cookie, and the CSRF token the page rendered.
 *
 * The three refusals are what these tests are really for. A write must carry a
 * session, come from this site, and echo this session's own token, and dropping
 * any one of them must be a refusal rather than an action nobody asked for.
 */

import { generateKeyPairSync, sign } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import PasswordAccountAuth from '@deepseek-ai/dsh-account-auth-password'
import SqliteAccessControl from '@deepseek-ai/dsh-access-control-sqlite'
import SqliteAudit from '@deepseek-ai/dsh-audit-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { AccessControl, RoleId } from '@deepseek-ai/dsh-access-control'
import type { Audit } from '@deepseek-ai/dsh-audit'
import {
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  type DeviceAuthorization,
} from '@deepseek-ai/dsh-device-authorization'
import * as shell from '../src/index.ts'
import { SESSION_COOKIE, csrfToken } from '../src/session.ts'

/** One response, read the way a browser would see it. */
interface Landing {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

let ctx: Context
let origin: string
let store: AccountStore
let access: AccessControl
let audit: Audit
let devices: DeviceAuthorization
let orgId: OrgId
let alice: UserId
let adminRole: RoleId

const PASSWORD = 'correct-horse-battery-staple'

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

/** Sign in and return the cookie a browser would keep. */
async function signIn(loginName = 'alice', secret = PASSWORD): Promise<string> {
  const landed = await send('/team/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ loginName, secret }).toString(),
  })
  expect(landed.status, 'sign-in should redirect').toBe(303)
  return (head(landed, 'set-cookie') as string).split(';')[0] as string
}

/** Pull the CSRF token out of a rendered page. */
function readCsrf(body: string): string {
  const match = /name="csrf" value="([^"]+)"/u.exec(body)
  expect(match?.[1], 'the page should render a CSRF token').toBeDefined()
  return match?.[1] as string
}

/** Submit a form the way the rendered page would. */
function submit(path: string, cookie: string, fields: Record<string, string>): Promise<Landing> {
  return send(path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin },
    body: new URLSearchParams(fields).toString(),
  })
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(PasswordAccountAuth, {
    minSecretLength: 8,
    maxFailedAttempts: 5,
    lockDurationMs: 60_000,
    cost: 2,
    blockSize: 8,
    parallelization: 1,
  }).await()
  await ctx.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await ctx.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
  await ctx.plugin(SqliteDeviceAuthorization, {
    path: ':memory:',
    transactionTtlMs: 300_000,
    codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000,
    refreshTokenTtlMs: 2_592_000_000,
  }).await()

  store = ctx.get('accountStore') as AccountStore
  access = ctx.get('accessControl') as AccessControl
  audit = ctx.get('audit') as Audit
  devices = ctx.get('deviceAuthorization') as DeviceAuthorization
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
  await ctx.accountAuth.setSecret(alice, PASSWORD)

  // Alice administers: every administrative page asks access control first.
  adminRole = (await access.createRole({ orgId, name: 'admin' })).id
  await access.registerResource({ orgId, type: 'member', externalRef: orgId, displayName: 'Members' })
  await access.registerResource({ orgId, type: 'device', externalRef: orgId, displayName: 'Devices' })
  for (const [type, action] of [
    ['member', 'member.create'], ['member', 'member.disable'], ['member', 'member.role.bind'],
    ['device', 'device.inventory.read'], ['device', 'device.revoke'],
  ] as const) {
    await access.grantType(adminRole, type, action)
  }
  await access.bindUserRole(alice, adminRole)

  await ctx.plugin(shell, shell.Config({ organizationId: orgId, secureCookie: false } as never)).await()
  origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('signing in', () => {
  it('sets a session cookie and records the login', async () => {
    const cookie = await signIn()
    expect(cookie).toContain(SESSION_COOKIE)
    const [event] = await audit.query({ orgId, action: 'member.login' })
    expect(event).toMatchObject({ outcome: 'allowed', principalId: alice, metadata: { authMethod: 'password' } })
  })

  it('answers every failure the same way, and records it without naming an account', async () => {
    const wrongPassword = await send('/team/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ loginName: 'alice', secret: 'not-the-password' }).toString(),
    })
    const noSuchMember = await send('/team/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ loginName: 'nobody', secret: PASSWORD }).toString(),
    })
    expect(wrongPassword.status).toBe(401)
    expect(noSuchMember.status).toBe(401)
    expect(wrongPassword.body).toBe(noSuchMember.body)
    expect(head(wrongPassword, 'set-cookie')).toBeUndefined()
    const denied = await audit.query({ orgId, action: 'member.login', outcome: 'denied' })
    expect(denied).toHaveLength(2)
    // A failed sign-in names no account: recording one would turn the trail
    // into a list of which login names exist.
    expect(denied.every(event => event.principalId === undefined)).toBe(true)
  })

  it('comes back to the page the member was going to', async () => {
    const landed = await send('/team/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ loginName: 'alice', secret: PASSWORD, next: '/team/admin/devices' }).toString(),
    })
    expect(head(landed, 'location')).toBe('/team/admin/devices')
  })

  it('refuses a sign-in submitted from another site', async () => {
    const refused = await send('/team/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
      body: new URLSearchParams({ loginName: 'alice', secret: PASSWORD }).toString(),
    })
    // Otherwise a form on another site could sign a member into an account
    // that site controls, and every page they then reached would be its.
    expect(refused.status).toBe(403)
    expect(head(refused, 'set-cookie')).toBeUndefined()
  })

  it('sends an unsigned browser to the sign-in page, and back where it was going', async () => {
    const sent = await send('/team/admin/devices')
    expect(sent.status).toBe(303)
    expect(head(sent, 'location')).toBe('/team/login?next=%2Fteam%2Fadmin%2Fdevices')
  })

  it('refuses a next that names another site', async () => {
    const shown = await send('/team/login?next=https://evil.example/steal')
    expect(shown.body).toContain('value="/team/admin/members"')
    expect(shown.body).not.toContain('evil.example')
  })

  it('ends the session on sign-out', async () => {
    const cookie = await signIn()
    const page = await send('/team/admin/members', { headers: { cookie } })
    const out = await submit('/team/logout', cookie, { csrf: readCsrf(page.body) })
    expect(out.status).toBe(303)
    expect((await send('/team/admin/members', { headers: { cookie } })).status).toBe(303)
  })
})

describe('a write needs all three', () => {
  it('refuses one that carries no session', async () => {
    const refused = await submit('/team/admin/members/create', '', { loginName: 'bob', displayName: 'Bob' })
    expect(refused.status).toBe(403)
    expect(await store.listUsers(orgId)).toHaveLength(1)
  })

  it('refuses one from another site', async () => {
    const cookie = await signIn()
    const page = await send('/team/admin/members', { headers: { cookie } })
    const refused = await send('/team/admin/members/create', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: 'https://evil.example' },
      body: new URLSearchParams({ csrf: readCsrf(page.body), loginName: 'bob', displayName: 'Bob' }).toString(),
    })
    expect(refused.status).toBe(403)
    expect(await store.listUsers(orgId)).toHaveLength(1)
  })

  it('refuses one with no Origin at all', async () => {
    const cookie = await signIn()
    const page = await send('/team/admin/members', { headers: { cookie } })
    const refused = await send('/team/admin/members/create', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ csrf: readCsrf(page.body), loginName: 'bob', displayName: 'Bob' }).toString(),
    })
    expect(refused.status).toBe(403)
  })

  it('refuses one whose CSRF token belongs to another session', async () => {
    const first = await signIn()
    const firstPage = await send('/team/admin/members', { headers: { cookie: first } })
    const second = await signIn()
    const refused = await submit('/team/admin/members/create', second, {
      csrf: readCsrf(firstPage.body),
      loginName: 'bob',
      displayName: 'Bob',
    })
    expect(refused.status).toBe(403)
    expect(await store.listUsers(orgId)).toHaveLength(1)
  })

  it('refuses a GET to an action address', async () => {
    const cookie = await signIn()
    expect((await send('/team/admin/members/create', { headers: { cookie } })).status).toBe(404)
    expect((await send('/team/logout', { headers: { cookie } })).status).toBe(405)
  })
})

describe('what a role does not carry', () => {
  it('refuses every write a member is not granted, not only the pages', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const cookie = await signIn('bob')
    // Bob's own token, derived the way the page that rendered a form would
    // derive it, so what refuses these writes is access control and not CSRF.
    const csrf = csrfToken(cookie.slice(cookie.indexOf('=') + 1))
    for (const [path, fields] of [
      ['/team/admin/members/create', { loginName: 'carol', displayName: 'Carol' }],
      ['/team/admin/members/suspend', { userId: alice }],
      ['/team/admin/members/bind', { userId: alice, roleId: adminRole }],
      ['/team/admin/roles/create', { name: 'sneaky' }],
      ['/team/admin/devices/revoke', { deviceId: 'anything' }],
    ] as const) {
      const refused = await submit(path, cookie, { ...fields, csrf })
      expect(refused.status, path).toBe(403)
      expect(refused.body, path).toContain('Your roles do not include this')
    }
    expect(await store.listUsers(orgId)).toHaveLength(2)
    expect(await access.listRoles(orgId)).toHaveLength(1)
  })

  it('refuses a member whose roles do not include the action', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const cookie = await signIn('bob')
    // Bob signed in successfully and still cannot read any of these:
    // authentication says who, and authorization says whether.
    for (const path of ['/team/admin/devices', '/team/admin/members', '/team/admin/roles']) {
      expect((await send(path, { headers: { cookie } })).status, path).toBe(403)
    }
  })
})

describe('administering', () => {
  it('adds a member and records who added them', async () => {
    const cookie = await signIn()
    const page = await send('/team/admin/members', { headers: { cookie } })
    const added = await submit('/team/admin/members/create', cookie, {
      csrf: readCsrf(page.body), loginName: 'bob', displayName: 'Bob',
    })
    expect(added.status).toBe(303)
    expect((await store.listUsers(orgId)).map(user => user.loginName)).toEqual(['alice', 'bob'])
    expect((await audit.query({ orgId, action: 'member.create' }))[0]).toMatchObject({
      principalId: alice, outcome: 'allowed',
    })
  })

  it('suspends a member, which is by itself the end of their sessions', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const bobCookie = await signIn('bob')
    const adminCookie = await signIn()
    const page = await send('/team/admin/members', { headers: { cookie: adminCookie } })
    await submit('/team/admin/members/suspend', adminCookie, { csrf: readCsrf(page.body), userId: bob })

    // Bob's browser still holds the cookie; it stops working immediately.
    expect((await send('/team/admin/members', { headers: { cookie: bobCookie } })).status).toBe(303)
    expect((await audit.query({ orgId, action: 'member.disable' }))[0]).toMatchObject({ resourceId: bob })
  })

  it('creates a role and binds it', async () => {
    const cookie = await signIn()
    const rolesPage = await send('/team/admin/roles', { headers: { cookie } })
    await submit('/team/admin/roles/create', cookie, {
      csrf: readCsrf(rolesPage.body), name: 'engineering', description: 'Builds things',
    })
    expect((await access.listRoles(orgId)).map(role => role.name)).toContain('engineering')
    const membersPage = await send('/team/admin/members', { headers: { cookie } })
    const engineering = (await access.listRoles(orgId)).find(role => role.name === 'engineering')
    await submit('/team/admin/members/bind', cookie, {
      csrf: readCsrf(membersPage.body), userId: alice, roleId: engineering?.id as string,
    })
    expect(await access.rolesOf(alice)).toContain(engineering?.id)
    expect(await audit.query({ orgId, action: 'binding.add' })).toHaveLength(1)
  })

  it('answers an address that names no page, and an action that names nothing', async () => {
    const cookie = await signIn()
    expect((await send('/team/admin/nothing', { headers: { cookie } })).status).toBe(404)
    const page = await send('/team/admin/members', { headers: { cookie } })
    const posted = await submit('/team/admin/nothing/at/all', cookie, { csrf: readCsrf(page.body) })
    expect(posted.status).toBe(404)
  })
})

describe('confirming a computer', () => {
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

  it('shows what the member compares, and sends the browser back with the code', async () => {
    const cookie = await signIn()
    const transaction = await pending()
    const shown = await send(`/team/confirm/${transaction.id}?state=runner-state`, { headers: { cookie } })
    expect(shown.status).toBe(200)
    expect(shown.body).toContain(transaction.pairingCode)
    expect(shown.body).toContain('darwin')
    expect(shown.body).toContain('2.4.1')

    const confirmed = await submit(`/team/confirm/${transaction.id}`, cookie, {
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

  it('asks an unsigned browser to sign in first, and comes back to the same transaction', async () => {
    const transaction = await pending()
    const sent = await send(`/team/confirm/${transaction.id}?state=s`)
    expect(sent.status).toBe(303)
    expect(head(sent, 'location')).toContain(encodeURIComponent(`/team/confirm/${transaction.id}`))
  })

  it('refuses a confirmation whose form carries no token of this session', async () => {
    const cookie = await signIn()
    const transaction = await pending()
    const refused = await submit(`/team/confirm/${transaction.id}`, cookie, { state: 's' })
    expect(refused.status).toBe(403)
    expect(await devices.listDevices(orgId)).toEqual([])
  })

  it('tells a member plainly when the request is not one this site knows', async () => {
    const cookie = await signIn()
    const shown = await send('/team/confirm/no-such-transaction', { headers: { cookie } })
    expect(shown.status).toBe(400)
    expect(shown.body).toContain('not one this site knows about')

    // The same for a confirmation posted against it: nothing to confirm.
    const posted = await submit('/team/confirm/no-such-transaction', cookie, {
      csrf: csrfToken(cookie.slice(cookie.indexOf('=') + 1)), state: 's',
    })
    expect(posted.status).toBe(400)
    expect(posted.body).toContain('not one this site knows about')
  })

  it('refuses a second confirmation and records the refusal', async () => {
    const cookie = await signIn()
    const transaction = await pending()
    const shown = await send(`/team/confirm/${transaction.id}?state=s`, { headers: { cookie } })
    await submit(`/team/confirm/${transaction.id}`, cookie, { csrf: readCsrf(shown.body), state: 's' })
    const again = await submit(`/team/confirm/${transaction.id}`, cookie, {
      csrf: readCsrf(shown.body), state: 's',
    })
    expect(again.status).toBe(400)
    expect(again.body).toContain('already confirmed')
    expect(await audit.query({ orgId, action: 'device.bind', outcome: 'denied' })).toHaveLength(1)
  })
})

describe('bodies, addresses, and pages that render nothing', () => {
  it('refuses a form larger than the page accepts', async () => {
    const cookie = await signIn()
    const page = await send('/team/admin/members', { headers: { cookie } })
    const huge = await submit('/team/admin/members/create', cookie, {
      csrf: readCsrf(page.body), loginName: 'x'.repeat(20_000), displayName: 'Bob',
    })
    expect(huge.status).toBe(413)
    expect(await store.listUsers(orgId)).toHaveLength(1)
  })

  it('refuses a sign-in body larger than the page accepts', async () => {
    const huge = await send('/team/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
      body: new URLSearchParams({ loginName: 'x'.repeat(20_000), secret: PASSWORD }).toString(),
    })
    expect(huge.status).toBe(413)
  })

  it('refuses an action whose form did not carry what it needs', async () => {
    const cookie = await signIn()
    const page = await send('/team/admin/members', { headers: { cookie } })
    const csrf = readCsrf(page.body)
    // Each of these would otherwise reach a store that would hold an empty
    // login name, or bind a role id that names nothing.
    for (const [path, fields] of [
      ['/team/admin/members/create', { csrf }],
      ['/team/admin/members/create', { csrf, loginName: 'bob' }],
      ['/team/admin/members/suspend', { csrf }],
      ['/team/admin/members/bind', { csrf, userId: alice }],
      ['/team/admin/roles/create', { csrf, description: 'no name' }],
      ['/team/admin/devices/revoke', { csrf }],
    ] as const) {
      const refused = await submit(path, cookie, fields)
      expect(refused.status, path).toBe(400)
    }
    expect(await store.listUsers(orgId)).toHaveLength(1)
    expect(await access.listRoles(orgId)).toHaveLength(1)
  })

  it('refuses a method the sign-in page does not accept', async () => {
    expect((await send('/team/login', { method: 'DELETE' })).status).toBe(405)
  })

  it('refuses a next that is protocol-relative', async () => {
    const shown = await send('/team/login?next=//evil.example/steal')
    expect(shown.body).toContain('value="/team/admin/members"')
  })

  it('serves the members page at the bare administrative address', async () => {
    const cookie = await signIn()
    for (const path of ['/team/admin', '/team/admin/']) {
      const shown = await send(path, { headers: { cookie } })
      expect(shown.status, path).toBe(200)
      expect(shown.body, path).toContain('Members')
    }
  })

  it('lists a revoked device without offering to revoke it again', async () => {
    const cookie = await signIn()
    // A device row exists only after a Runner proved possession of its key, so
    // the whole flow runs, signature and all.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
    const verifier = newSecret()
    const started = await devices.start({
      publicKey: spki, platform: 'linux', runnerVersion: '1.0.0',
      pkceChallenge: pkceChallenge(verifier),
      callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
    })
    const shown = await send(`/team/confirm/${started.transactionId}?state=s`, { headers: { cookie } })
    const confirmed = await submit(`/team/confirm/${started.transactionId}`, cookie, {
      csrf: readCsrf(shown.body), state: 's',
    })
    const code = new URL(head(confirmed, 'location') as string).searchParams.get('code') as string
    await devices.redeem({
      transactionId: started.transactionId,
      code,
      pkceVerifier: verifier,
      deviceSignature: sign(null, Buffer.from(redeemSigningInput(started.transactionId, code)), privateKey)
        .toString('base64url'),
      callbackUri: 'http://127.0.0.1:3080/team/callback',
      protocolVersion: 1,
    })

    const listed = await send('/team/admin/devices', { headers: { cookie } })
    expect(listed.body).toContain('linux')
    expect(listed.body).toContain('Revoke')
    const [device] = await devices.listDevices(orgId)
    await submit('/team/admin/devices/revoke', cookie, {
      csrf: readCsrf(listed.body), deviceId: device?.id as string,
    })
    const after = await send('/team/admin/devices', { headers: { cookie } })
    expect(after.body).toContain('revoked')
    expect(after.body).not.toContain('>Revoke<')
    expect((await audit.query({ orgId, action: 'device.revoke' }))[0]).toMatchObject({ resourceId: device?.id })
  })

  it('tells a member when a confirmation request has run out of time', async () => {
    const brief = new Context()
    await brief.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await brief.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await brief.plugin(PasswordAccountAuth, {
      minSecretLength: 8, maxFailedAttempts: 5, lockDurationMs: 60_000,
      cost: 2, blockSize: 8, parallelization: 1,
    }).await()
    await brief.plugin(SqliteAccessControl, { path: ':memory:' }).await()
    await brief.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    await brief.plugin(SqliteDeviceAuthorization, {
      path: ':memory:', transactionTtlMs: 0, codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
    }).await()
    const briefStore = brief.get('accountStore') as AccountStore
    const briefOrg = (await briefStore.createOrganization('Acme')).id
    const bob = (await briefStore.createUser({ orgId: briefOrg, loginName: 'bob', displayName: 'Bob' })).id
    await brief.accountAuth.setSecret(bob, PASSWORD)
    await brief.plugin(shell, shell.Config({ organizationId: briefOrg, secureCookie: false } as never)).await()

    const briefOrigin = `http://127.0.0.1:${String(brief.webServer.port)}`
    const landed = await new Promise<Landing>((resolve, reject) => {
      const req = httpRequest(`${briefOrigin}/team/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: briefOrigin },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        res.on('end', () => {
          resolve({ status: res.statusCode as number, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        })
      })
      req.on('error', reject)
      req.write(new URLSearchParams({ loginName: 'bob', secret: PASSWORD }).toString())
      req.end()
    })
    const cookie = (head(landed, 'set-cookie') as string).split(';')[0] as string
    const started = await (brief.get('deviceAuthorization') as DeviceAuthorization).start({
      publicKey: 'k', platform: 'linux', runnerVersion: '1.0.0',
      pkceChallenge: 'c', callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
    })
    const shown = await new Promise<Landing>((resolve, reject) => {
      const req = httpRequest(`${briefOrigin}/team/confirm/${started.transactionId}?state=s`,
        { headers: { cookie } }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
          res.on('end', () => {
            resolve({ status: res.statusCode as number, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
          })
        })
      req.on('error', reject)
      req.end()
    })
    expect(shown.status).toBe(400)
    expect(shown.body).toContain('took too long')

    // Posting the confirmation anyway records the refusal with the seam's own
    // word rather than with a guess.
    const posted = await new Promise<Landing>((resolve, reject) => {
      const req = httpRequest(`${briefOrigin}/team/confirm/${started.transactionId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: briefOrigin },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
        res.on('end', () => {
          resolve({ status: res.statusCode as number, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        })
      })
      req.on('error', reject)
      req.write(new URLSearchParams({
        csrf: csrfToken(cookie.slice(cookie.indexOf('=') + 1)),
        state: 's',
      }).toString())
      req.end()
    })
    expect(posted.status).toBe(400)
    const denied = await (brief.get('audit') as Audit).query({ orgId: briefOrg, action: 'device.bind' })
    expect(denied[0]).toMatchObject({ outcome: 'denied', reason: 'expired' })
    await brief.fiber.dispose()
  })
})

describe('when the site itself cannot answer', () => {
  it('says so, rather than telling the member their request was unrecognized', async () => {
    const broken = new Context()
    await broken.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await broken.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await broken.plugin(PasswordAccountAuth, {
      minSecretLength: 8, maxFailedAttempts: 5, lockDurationMs: 60_000,
      cost: 2, blockSize: 8, parallelization: 1,
    }).await()
    await broken.plugin(SqliteAccessControl, { path: ':memory:' }).await()
    await broken.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    broken.provide('deviceAuthorization', {
      describe: () => Promise.reject(new Error('the database is on fire')),
      confirm: () => Promise.reject(new Error('the database is on fire')),
    })
    const brokenStore = broken.get('accountStore') as AccountStore
    const brokenOrg = (await brokenStore.createOrganization('Acme')).id
    const bob = (await brokenStore.createUser({ orgId: brokenOrg, loginName: 'bob', displayName: 'Bob' })).id
    await broken.accountAuth.setSecret(bob, PASSWORD)
    await broken.plugin(shell, shell.Config({ organizationId: brokenOrg, secureCookie: false } as never)).await()
    const brokenOrigin = `http://127.0.0.1:${String(broken.webServer.port)}`

    const call = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
      new Promise<Landing>((resolve, reject) => {
        const req = httpRequest(`${brokenOrigin}${path}`, {
          method: init.method ?? 'GET',
          headers: init.headers ?? {},
        }, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
          res.on('end', () => {
            resolve({ status: res.statusCode as number, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
          })
        })
        req.on('error', reject)
        if (init.body !== undefined) req.write(init.body)
        req.end()
      })

    const landed = await call('/team/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: brokenOrigin },
      body: new URLSearchParams({ loginName: 'bob', secret: PASSWORD }).toString(),
    })
    const cookie = (head(landed, 'set-cookie') as string).split(';')[0] as string

    const shown = await call('/team/confirm/anything?state=s', { headers: { cookie } })
    expect(shown.status).toBe(500)
    expect(shown.body).toContain('could not answer')

    const posted = await call('/team/confirm/anything', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, origin: brokenOrigin },
      body: new URLSearchParams({
        csrf: csrfToken(cookie.slice(cookie.indexOf('=') + 1)), state: 's',
      }).toString(),
    })
    expect(posted.status).toBe(500)
    // The record says the site failed, not that the member was refused.
    expect((await (broken.get('audit') as Audit).query({ orgId: brokenOrg }))[0])
      .toMatchObject({ action: 'device.bind', outcome: 'error' })
    await broken.fiber.dispose()
  })
})

describe('a Control Plane nobody configured', () => {
  it('refuses to load rather than authenticating against an organization that does not exist', () => {
    // The shipped Control Plane patch omits the key for this reason: the
    // failure happens as the plugin applies, naming what is missing, rather
    // than later as "that member and password do not match" for every member
    // forever. It throws before touching the context, so this calls it directly.
    expect(() => {
      shell.apply(ctx, shell.Config({ organizationId: '   ', secureCookie: false } as never))
    }).toThrow(/organizationId must name the organization/u)
  })
})
