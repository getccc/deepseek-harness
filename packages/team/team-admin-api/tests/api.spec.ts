/**
 * The administration API, driven the way the console drives it: JSON with a
 * session cookie, an Origin, and the session's own CSRF value in a header.
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
import SqliteModelGateway from '@deepseek-ai/dsh-model-gateway-sqlite'
import SqliteQuota from '@deepseek-ai/dsh-quota-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { AccessControl, RoleId } from '@deepseek-ai/dsh-access-control'
import type { Audit } from '@deepseek-ai/dsh-audit'
import {
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  type DeviceAuthorization,
  type DeviceId,
} from '@deepseek-ai/dsh-device-authorization'
import { csrfToken, hashToken } from '@deepseek-ai/dsh-team-browser-session'
import * as api from '../src/index.ts'
import type { WireDevice, WireMember, WireModel, WireRole, WireSession } from '../src/types.ts'

/** One response, read the way the console reads it. */
interface Answer {
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

/** Every permission the console's own routes ask for. */
const ADMIN_PERMISSIONS = [
  ['organization', 'organization.read'], ['organization', 'organization.settings.manage'],
  ['member', 'member.read'], ['member', 'member.create'], ['member', 'member.disable'],
  ['member', 'member.enable'], ['member', 'member.role.bind'],
  ['role', 'role.read'], ['role', 'role.create'], ['role', 'role.grant.manage'],
  ['device', 'device.inventory.read'], ['device', 'device.revoke'],
  ['model', 'model.catalog.read'], ['model', 'model.catalog.manage'],
] as const

/** A model registration the catalog accepts, for tests that break one field. */
const USABLE_MODEL = {
  modelRef: 'deepseek-chat',
  displayName: 'DeepSeek Chat',
  providerRef: 'deepseek',
  upstreamModel: 'deepseek-chat',
  endpoint: 'https://api.deepseek.com/',
  credentialRef: 'COMPANY_DEEPSEEK_KEY',
  maxOutputTokens: 8192,
}

/** Make one request with exactly these headers. */
function send(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Answer> {
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
function head(answer: Answer, name: string): string | undefined {
  const value = answer.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** The JSON one answer carried. */
function payload(answer: Answer): unknown {
  return JSON.parse(answer.body)
}

/** Sign in and keep what the console keeps. */
async function signIn(loginName = 'alice', secret = PASSWORD): Promise<{ cookie: string; csrf: string }> {
  const landed = await send('/team/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ loginName, secret }),
  })
  expect(landed.status, 'sign-in should succeed').toBe(200)
  return {
    cookie: (head(landed, 'set-cookie') as string).split(';')[0] as string,
    csrf: (payload(landed) as WireSession).csrf,
  }
}

/** Make one write the way the console makes it. */
function write(
  method: string, path: string, held: { cookie: string; csrf: string }, body?: unknown,
): Promise<Answer> {
  return send(path, {
    method,
    headers: {
      'content-type': 'application/json', origin, cookie: held.cookie, 'x-dsh-csrf': held.csrf,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/**
 * Bind one computer the whole way, signature and all.
 *
 * A device row exists only after a Runner proved possession of its key. The
 * page a member confirms on belongs to another package, so the confirmation
 * here is the seam call that page makes.
 */
async function bindDevice(cookie: string): Promise<DeviceId> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const verifier = newSecret()
  const started = await devices.start({
    publicKey: spki, platform: 'linux', runnerVersion: '1.0.0',
    pkceChallenge: pkceChallenge(verifier),
    callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
  })
  const issued = await devices.confirm(started.transactionId, {
    orgId, userId: alice, browserSessionId: hashToken(cookie.slice(cookie.indexOf('=') + 1)),
  })
  await devices.redeem({
    transactionId: started.transactionId,
    code: issued.code,
    pkceVerifier: verifier,
    deviceSignature: sign(
      null, Buffer.from(redeemSigningInput(started.transactionId, issued.code)), privateKey,
    ).toString('base64url'),
    callbackUri: 'http://127.0.0.1:3080/team/callback',
    protocolVersion: 1,
  })
  return (await devices.listDevices(orgId)).find(device => device.publicKey === spki)?.id as DeviceId
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(PasswordAccountAuth, {
    minSecretLength: 8, maxFailedAttempts: 5, lockDurationMs: 60_000,
    cost: 2, blockSize: 8, parallelization: 1,
  }).await()
  await ctx.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await ctx.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
  await ctx.plugin(SqliteDeviceAuthorization, {
    path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await ctx.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 900_000 }).await()
  await ctx.plugin(SqliteModelGateway, { path: ':memory:' }).await()

  store = ctx.get('accountStore') as AccountStore
  access = ctx.get('accessControl') as AccessControl
  audit = ctx.get('audit') as Audit
  devices = ctx.get('deviceAuthorization') as DeviceAuthorization
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
  await ctx.accountAuth.setSecret(alice, PASSWORD)

  await ctx.plugin(api, api.Config({ organizationId: orgId, secureCookie: false } as never)).await()

  // Alice administers: the API governs its own control resources as it mounts,
  // so the grants come after it.
  adminRole = (await access.createRole({ orgId, name: 'admin' })).id
  for (const [type, action] of ADMIN_PERMISSIONS) await access.grantType(adminRole, type, action)
  await access.bindUserRole(alice, adminRole)

  origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('signing in', () => {
  it('answers with the session the console needs, and records the login', async () => {
    const landed = await send('/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ loginName: 'alice', secret: PASSWORD }),
    })
    expect(landed.status).toBe(200)
    expect(head(landed, 'set-cookie')).toContain('dsh_cp_session=')
    const session = (payload(landed) as WireSession)
    expect(session.member).toMatchObject({ loginName: 'alice', displayName: 'Alice' })
    expect(session.organization.name).toBe('Acme')
    expect(session.organization.policyRevision).toMatch(/^\d+$/u)
    expect(session.permissions).toContain('member|member.read')
    expect(session.csrf).not.toBe('')
    expect((await audit.query({ orgId, action: 'member.login' }))[0]).toMatchObject({ outcome: 'allowed' })
  })

  it('answers every failure the same way, and records it without naming an account', async () => {
    for (const attempt of [
      { loginName: 'alice', secret: 'wrong-password' },
      { loginName: 'nobody', secret: PASSWORD },
      { loginName: '', secret: '' },
    ]) {
      const refused = await send('/team/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify(attempt),
      })
      expect(refused.status).toBe(401)
      expect((payload(refused) as { detail: string }).detail)
        .toBe('That member and password do not match.')
      expect(head(refused, 'set-cookie')).toBeUndefined()
    }
    const records = await audit.query({ orgId, action: 'member.login' })
    expect(records).toHaveLength(3)
    expect(records.every(row => row.outcome === 'denied' && row.principalId === undefined)).toBe(true)
  })

  it('refuses a sign-in from another site, and one whose body is not an object', async () => {
    const crossSite = await send('/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ loginName: 'alice', secret: PASSWORD }),
    })
    expect(crossSite.status).toBe(403)

    for (const body of ['[]', 'not json at all', '"a string"']) {
      const malformed = await send('/team/api/session', {
        method: 'POST', headers: { 'content-type': 'application/json', origin }, body,
      })
      expect(malformed.status, body).toBe(400)
    }
  })

  it('refuses a sign-in body larger than the deployment accepts', async () => {
    const huge = await send('/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ loginName: 'x'.repeat(20_000), secret: PASSWORD }),
    })
    expect(huge.status).toBe(413)
  })

  it('ends the session on sign-out, and the cookie stops working', async () => {
    const held = await signIn()
    const ended = await write('DELETE', '/team/api/session', held)
    expect(ended.status).toBe(200)
    expect(head(ended, 'set-cookie')).toContain('Max-Age=0')
    expect((await send('/team/api/members', { headers: { cookie: held.cookie } })).status).toBe(401)
    expect(await audit.query({ orgId, action: 'member.logout' })).toHaveLength(1)
  })

  it('tells a browser carrying nothing that nobody is signed in', async () => {
    const asked = await send('/team/api/session')
    expect(asked.status).toBe(401)
    expect((payload(asked) as { error: string }).error).toBe('unauthenticated')
  })
})

describe('a write needs all three', () => {
  it('refuses one that carries no session', async () => {
    const refused = await send('/team/api/organization', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin, 'x-dsh-csrf': 'anything' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(refused.status).toBe(401)
    expect((await store.getOrganization(orgId))?.name).toBe('Acme')
  })

  it('refuses one from another site', async () => {
    const held = await signIn()
    const refused = await send('/team/api/organization', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json', origin: 'https://evil.example',
        cookie: held.cookie, 'x-dsh-csrf': held.csrf,
      },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(refused.status).toBe(403)
    expect((await store.getOrganization(orgId))?.name).toBe('Acme')
  })

  it('refuses one with no Origin at all', async () => {
    const held = await signIn()
    const refused = await send('/team/api/organization', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: held.cookie, 'x-dsh-csrf': held.csrf },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(refused.status).toBe(403)
  })

  it('refuses one whose CSRF value is missing, wrong, or another session-s', async () => {
    const held = await signIn()
    const other = csrfToken('a token this session never had')
    for (const csrf of [undefined, '', other]) {
      const refused = await send('/team/api/organization', {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json', origin, cookie: held.cookie,
          ...(csrf === undefined ? {} : { 'x-dsh-csrf': csrf }),
        },
        body: JSON.stringify({ name: 'Nope' }),
      })
      expect(refused.status, String(csrf)).toBe(403)
    }
    expect((await store.getOrganization(orgId))?.name).toBe('Acme')
  })
})

describe('what a role does not carry', () => {
  /** Bob signs in successfully and holds nothing. */
  async function bobsSession(): Promise<{ cookie: string; csrf: string }> {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    return signIn('bob')
  }

  it('refuses every read a member is not granted', async () => {
    const held = await bobsSession()
    for (const path of [
      '/team/api/overview', '/team/api/organization', '/team/api/members',
      '/team/api/roles', '/team/api/devices', '/team/api/models',
    ]) {
      const refused = await send(path, { headers: { cookie: held.cookie } })
      expect(refused.status, path).toBe(403)
      expect((payload(refused) as { detail: string }).detail, path).toBe('Your roles do not include this.')
    }
  })

  it('refuses every write a member is not granted, and says so with nothing done', async () => {
    const held = await bobsSession()
    for (const [method, path, body] of [
      ['PATCH', '/team/api/organization', { name: 'Bob Industries' }],
      ['POST', '/team/api/members', { loginName: 'carol', displayName: 'Carol' }],
      ['PATCH', `/team/api/members/${alice}`, { status: 'suspended' }],
      ['POST', `/team/api/members/${alice}/roles`, { roleId: adminRole }],
      ['DELETE', `/team/api/members/${alice}/roles/${adminRole}`, undefined],
      ['POST', '/team/api/roles', { name: 'sneaky' }],
      ['POST', `/team/api/roles/${adminRole}/grants`, { resourceType: 'model', action: 'model.invoke' }],
      ['DELETE', '/team/api/grants/anything', undefined],
      ['DELETE', '/team/api/devices/anything', undefined],
      ['POST', '/team/api/models', USABLE_MODEL],
      ['PATCH', '/team/api/models/deepseek-chat', { status: 'retired' }],
    ] as const) {
      const refused = await write(method, path, held, body)
      expect(refused.status, path).toBe(403)
    }
    expect(await store.listUsers(orgId)).toHaveLength(2)
    expect(await access.listRoles(orgId)).toHaveLength(1)
    expect((await store.getOrganization(orgId))?.name).toBe('Acme')
    expect(await access.rolesOf(alice)).toEqual([adminRole])
    expect(await ctx.modelGateway.list(orgId)).toHaveLength(0)
  })

  it('answers the permission catalog to any signed-in member, holding nothing', async () => {
    const held = await bobsSession()
    const listed = await send('/team/api/permissions', { headers: { cookie: held.cookie } })
    expect(listed.status).toBe(200)
    // The catalog names what this build governs, not what this organization
    // holds, so it tells a member nothing about the organization.
    expect((payload(listed) as { action: string }[]).some(row => row.action === 'member.read')).toBe(true)
  })

  it('answers who a member is even when their roles carry nothing', async () => {
    const held = await bobsSession()
    const asked = await send('/team/api/session', { headers: { cookie: held.cookie } })
    expect(asked.status).toBe(200)
    expect((payload(asked) as WireSession).permissions).toEqual([])
  })
})

describe('administering', () => {
  it('renames the organization', async () => {
    const held = await signIn()
    const renamed = await write('PATCH', '/team/api/organization', held, { name: 'Acme Labs' })
    expect(renamed.status).toBe(200)
    expect((payload(renamed) as { name: string }).name).toBe('Acme Labs')
    expect((await store.getOrganization(orgId))?.name).toBe('Acme Labs')
    expect(await audit.query({ orgId, action: 'policy.update' })).toHaveLength(1)
  })

  it('adds a member, and refuses a second one with the same login name', async () => {
    const held = await signIn()
    const added = await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob', email: 'bob@acme.example',
    })
    expect(added.status).toBe(200)
    const members = (payload(added) as WireMember[])
    expect(members.map(member => member.loginName)).toEqual(['alice', 'bob'])
    expect(members.find(member => member.loginName === 'bob')?.email).toBe('bob@acme.example')
    expect(members.find(member => member.loginName === 'alice')?.email).toBeUndefined()
    expect((await audit.query({ orgId, action: 'member.create' }))[0]).toMatchObject({ principalId: alice })

    const again = await write('POST', '/team/api/members', held, { loginName: 'bob', displayName: 'Bob Two' })
    expect(again.status).toBe(409)
    expect(await store.listUsers(orgId)).toHaveLength(2)
  })

  it('suspends a member, which is by itself the end of their sessions, then reactivates them', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const bobs = await signIn('bob')
    const held = await signIn()

    const suspended = await write('PATCH', `/team/api/members/${bob}`, held, { status: 'suspended' })
    expect(suspended.status).toBe(200)
    // Bob's browser still holds the cookie; it stops working immediately.
    expect((await send('/team/api/session', { headers: { cookie: bobs.cookie } })).status).toBe(401)
    expect((await audit.query({ orgId, action: 'member.disable' }))[0]).toMatchObject({ resourceId: bob })

    const back = await write('PATCH', `/team/api/members/${bob}`, held, { status: 'active' })
    expect((payload(back) as WireMember[]).find(member => member.id === bob)?.status).toBe('active')
    // Enabling is recorded as itself, not as one more disable.
    expect((await audit.query({ orgId, action: 'member.enable' }))[0]).toMatchObject({ resourceId: bob })
  })

  it('creates a role, binds it, and unbinds it again', async () => {
    const held = await signIn()
    const created = await write('POST', '/team/api/roles', held, {
      name: 'engineering', description: 'Builds things',
    })
    expect(created.status).toBe(200)
    const engineering = (payload(created) as WireRole[]).find(role => role.name === 'engineering')
    expect(engineering).toMatchObject({ description: 'Builds things', kind: 'custom', grants: [] })

    const bound = await write('POST', `/team/api/members/${alice}/roles`, held, { roleId: engineering?.id })
    expect((payload(bound) as WireMember[])[0]?.roles.map(role => role.name)).toContain('engineering')
    expect(await audit.query({ orgId, action: 'binding.add' })).toHaveLength(1)

    const unbound = await write('DELETE', `/team/api/members/${alice}/roles/${engineering?.id}`, held)
    expect((payload(unbound) as WireMember[])[0]?.roles.map(role => role.name)).toEqual(['admin'])
    expect(await access.rolesOf(alice)).toEqual([adminRole])
    expect(await audit.query({ orgId, action: 'binding.remove' })).toHaveLength(1)
  })

  it('adds and revokes a permission through the closed catalog', async () => {
    const held = await signIn()
    const granted = await write('POST', `/team/api/roles/${adminRole}/grants`, held, {
      resourceType: 'model', action: 'model.invoke',
    })
    expect(granted.status).toBe(200)
    const grant = (payload(granted) as WireRole[])[0]?.grants.find(row => row.action === 'model.invoke')
    expect(grant).toMatchObject({ scope: 'type', resourceType: 'model' })

    const revoked = await write('DELETE', `/team/api/grants/${grant?.id}`, held)
    expect((payload(revoked) as WireRole[])[0]?.grants.some(row => row.action === 'model.invoke')).toBe(false)
    expect(await audit.query({ orgId, action: 'grant.revoke' })).toHaveLength(1)
  })

  it('registers a company model and withdraws it from service', async () => {
    const held = await signIn()
    const registered = await write('POST', '/team/api/models', held, USABLE_MODEL)
    expect(registered.status).toBe(200)
    expect((payload(registered) as WireModel[])[0]).toMatchObject({
      modelRef: 'deepseek-chat', status: 'active', credentialRef: 'COMPANY_DEEPSEEK_KEY',
    })
    expect((await audit.query({ orgId, action: 'resource.register' }))[0])
      .toMatchObject({ resourceId: 'deepseek-chat' })

    const retired = await write('PATCH', '/team/api/models/deepseek-chat', held, { status: 'retired' })
    expect((payload(retired) as WireModel[])[0]?.status).toBe('retired')
    const back = await write('PATCH', '/team/api/models/deepseek-chat', held, { status: 'active' })
    expect((payload(back) as WireModel[])[0]?.status).toBe('active')
    // Withdrawing a model and returning it are separate acts in the record.
    expect(await audit.query({ orgId, action: 'resource.disable' })).toHaveLength(1)
    expect((await audit.query({ orgId, action: 'resource.enable' }))[0])
      .toMatchObject({ resourceId: 'deepseek-chat' })
  })
})

describe('what an action refuses on its own terms', () => {
  it('will not act without the fields the route needs', async () => {
    const held = await signIn()
    for (const [method, path, body] of [
      ['PATCH', '/team/api/organization', {}],
      ['POST', '/team/api/members', { loginName: 'bob' }],
      ['PATCH', `/team/api/members/${alice}`, { status: 'banished' }],
      ['POST', `/team/api/members/${alice}/roles`, {}],
      ['POST', '/team/api/roles', { description: 'no name' }],
      ['POST', `/team/api/roles/${adminRole}/grants`, { resourceType: 'model' }],
      ['POST', `/team/api/roles/${adminRole}/grants`, { resourceType: 'nothing', action: 'nothing.at.all' }],
      ['POST', '/team/api/models', { modelRef: 'half-a-model' }],
      ['PATCH', '/team/api/models/deepseek-chat', { status: 'paused' }],
    ] as const) {
      const refused = await write(method, path, held, body)
      expect(refused.status, path).toBe(400)
    }
    expect(await store.listUsers(orgId)).toHaveLength(1)
    expect(await access.listRoles(orgId)).toHaveLength(1)
    expect((await access.listRoleGrants(adminRole))).toHaveLength(ADMIN_PERMISSIONS.length)
  })

  it('will not register a model no call could reach, and names which field', async () => {
    const held = await signIn()
    for (const [reason, broken] of [
      ['endpoint', { endpoint: 'api.deepseek.com' }],
      // Plain HTTP would carry the company key in the clear.
      ['endpoint-security', { endpoint: 'http://api.deepseek.com/' }],
      ['endpoint-security', { maxOutputTokens: 2.5 }],
      ['endpoint-security', { maxOutputTokens: 0 }],
      // A credential key and a credential reference address different things,
      // and only the reference resolves when the gateway makes the call.
      ['credential', { credentialRef: 'company/deepseek' }],
      ['fields', { modelRef: '' }],
    ] as const) {
      const refused = await write('POST', '/team/api/models', held, { ...USABLE_MODEL, ...broken })
      expect(refused.status, reason).toBe(400)
      // The console renders its own copy per reason, so the word is what a
      // member in either language actually reads.
      expect((payload(refused) as { reason: string }).reason, reason).toBe(reason)
    }
    expect(await ctx.modelGateway.list(orgId)).toHaveLength(0)
  })

  it('names the reason for every refusal a member can act on', async () => {
    const held = await signIn()
    await write('POST', '/team/api/members', held, { loginName: 'bob', displayName: 'Bob' })
    for (const [reason, method, path, body] of [
      ['fields', 'PATCH', '/team/api/organization', {}],
      ['login-taken', 'POST', '/team/api/members', { loginName: 'bob', displayName: 'Bob Two' }],
      ['member-status', 'PATCH', `/team/api/members/${alice}`, { status: 'banished' }],
      ['permission', 'POST', `/team/api/roles/${adminRole}/grants`, {
        resourceType: 'nothing', action: 'nothing.at.all',
      }],
      ['model-status', 'PATCH', '/team/api/models/deepseek-chat', { status: 'paused' }],
    ] as const) {
      const refused = await write(method, path, held, body)
      expect((payload(refused) as { reason: string }).reason, path).toBe(reason)
    }

    const malformed = await send('/team/api/organization', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json', origin, cookie: held.cookie, 'x-dsh-csrf': held.csrf,
      },
      body: '[1,2,3]',
    })
    expect((payload(malformed) as { reason: string }).reason).toBe('body')
  })

  it('refuses a body larger than the deployment accepts', async () => {
    const held = await signIn()
    const huge = await write('POST', '/team/api/members', held, {
      loginName: 'x'.repeat(20_000), displayName: 'Bob',
    })
    expect(huge.status).toBe(413)
    expect(await store.listUsers(orgId)).toHaveLength(1)
  })

  it('refuses a sign-out that drops one of the three proofs', async () => {
    const held = await signIn()
    const refused = await send('/team/api/session', {
      method: 'DELETE', headers: { origin, cookie: held.cookie },
    })
    expect(refused.status).toBe(403)
    // The session it failed to end still works.
    expect((await send('/team/api/session', { headers: { cookie: held.cookie } })).status).toBe(200)
  })

  it('reads a secret that is not a string as no secret at all', async () => {
    const refused = await send('/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ loginName: 'alice', secret: 12_345 }),
    })
    expect(refused.status).toBe(401)
  })

  it('creates a role with no description rather than refusing one', async () => {
    const held = await signIn()
    const created = await write('POST', '/team/api/roles', held, { name: 'observers' })
    expect(created.status).toBe(200)
    expect((payload(created) as WireRole[]).find(role => role.name === 'observers')?.description).toBe('')
  })

  it('lets a store failure through as the site-s, not as a name already taken', async () => {
    const held = await signIn()
    // Only a duplicate login name is the administrator's mistake; anything else
    // the store raises is this site failing to carry out the request.
    store.createUser = () => Promise.reject(new Error('the database is on fire'))
    const answered = await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob',
    })
    expect(answered.status).toBe(500)
    expect((payload(answered) as { error: string }).error).toBe('unavailable')
  })

  it('refuses a write body that is not a JSON object', async () => {
    const held = await signIn()
    const malformed = await send('/team/api/organization', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json', origin, cookie: held.cookie, 'x-dsh-csrf': held.csrf,
      },
      body: '[1,2,3]',
    })
    expect(malformed.status).toBe(400)
  })
})

describe('what the console reads', () => {
  it('counts on the overview only what is still in service', async () => {
    const held = await signIn()
    await write('POST', '/team/api/models', held, USABLE_MODEL)
    const before = await send('/team/api/overview', { headers: { cookie: held.cookie } })
    expect((payload(before) as { models: number; activeModels: number }))
      .toMatchObject({ members: 1, activeMembers: 1, roles: 1, devices: 0, activeDevices: 0, models: 1, activeModels: 1 })

    await write('PATCH', '/team/api/models/deepseek-chat', held, { status: 'retired' })
    const after = await send('/team/api/overview', { headers: { cookie: held.cookie } })
    // The row is still there to administer; it is not in service.
    expect((payload(after) as { models: number; activeModels: number }))
      .toMatchObject({ models: 1, activeModels: 0 })
  })

  it('sends the policy revision as a string, because JSON has no bigint', async () => {
    const held = await signIn()
    const read = await send('/team/api/organization', { headers: { cookie: held.cookie } })
    const organization = (payload(read) as { policyRevision: string })
    expect(typeof organization.policyRevision).toBe('string')
    expect(organization.policyRevision).toBe(
      (await store.getOrganization(orgId))?.policyRevision.toString(),
    )
  })

  it('shows only the roles this organization administers', async () => {
    // Binding is not org-scoped, and this console administers one organization:
    // a role it names is one this API could also take away.
    const elsewhere = (await store.createOrganization('Other')).id
    const outsiders = (await access.createRole({ orgId: elsewhere, name: 'outsiders' })).id
    await access.bindUserRole(alice, outsiders)
    const held = await signIn()
    const listed = await send('/team/api/members', { headers: { cookie: held.cookie } })
    expect(await access.rolesOf(alice)).toContain(outsiders)
    expect((payload(listed) as WireMember[])[0]?.roles.map(role => role.id)).toEqual([adminRole])
  })

  it('names the resource a grant covers when the grant names one', async () => {
    // Granting one named resource is not something this console does; it is
    // something the roles view has to render when an operator has done it.
    const resource = await access.registerResource({
      orgId, type: 'model', externalRef: 'deepseek-chat', displayName: 'DeepSeek Chat',
    })
    await access.grantResource(adminRole, resource.id, 'model.invoke')
    const held = await signIn()
    const listed = await send('/team/api/roles', { headers: { cookie: held.cookie } })
    const grant = (payload(listed) as WireRole[])[0]?.grants.find(row => row.scope === 'resource')
    expect(grant).toMatchObject({ resourceType: 'model', resourceDisplayName: 'DeepSeek Chat' })
  })

  it('lists the computers bound to this organization, and revokes one', async () => {
    const held = await signIn()
    expect(payload(await send('/team/api/devices', { headers: { cookie: held.cookie } })))
      .toEqual([])

    const device = await bindDevice(held.cookie)
    const listed = await send('/team/api/devices', { headers: { cookie: held.cookie } })
    expect((payload(listed) as WireDevice[])[0]).toMatchObject({
      id: device, platform: 'linux', runnerVersion: '1.0.0', status: 'active', ownerId: alice,
    })
    const counted = await send('/team/api/overview', { headers: { cookie: held.cookie } })
    expect(payload(counted)).toMatchObject({ devices: 1, activeDevices: 1 })

    const revoked = await write('DELETE', `/team/api/devices/${device}`, held)
    expect((payload(revoked) as WireDevice[])[0]?.status).toBe('revoked')
    expect((await audit.query({ orgId, action: 'device.revoke' }))[0]).toMatchObject({ resourceId: device })
    // The row stays for an administrator to see; it is not in service.
    const after = await send('/team/api/overview', { headers: { cookie: held.cookie } })
    expect(payload(after)).toMatchObject({ devices: 1, activeDevices: 0 })
  })

  it('reads the company catalog as its own view', async () => {
    const held = await signIn()
    await write('POST', '/team/api/models', held, USABLE_MODEL)
    const listed = await send('/team/api/models', { headers: { cookie: held.cookie } })
    expect(listed.status).toBe(200)
    expect((payload(listed) as WireModel[])[0]).toMatchObject({ modelRef: 'deepseek-chat' })
  })

  it('answers no cached copy of one member-s view to the next member', async () => {
    const held = await signIn()
    const read = await send('/team/api/members', { headers: { cookie: held.cookie } })
    expect(head(read, 'cache-control')).toBe('no-store')
  })
})

describe('addresses and methods this API does not have', () => {
  it('answers an address that names nothing', async () => {
    const held = await signIn()
    expect((await send('/team/api/nothing', { headers: { cookie: held.cookie } })).status).toBe(404)
    expect((await write('POST', '/team/api/nothing/at/all', held, {})).status).toBe(404)
    expect((await write('DELETE', '/team/api/members/x/roles', held)).status).toBe(404)
  })

  it('refuses a method no route accepts', async () => {
    const held = await signIn()
    const refused = await send('/team/api/session', { method: 'PUT', headers: { cookie: held.cookie } })
    expect(refused.status).toBe(405)
  })
})

describe('when the site itself cannot answer', () => {
  it('says so, rather than telling the member their request was malformed', async () => {
    const held = await signIn()
    // Nothing in this build removes an organization; an operator reaching the
    // database can. An administration API with no organization behind it is
    // the site's failure, not a request the member made wrongly.
    store.getOrganization = () => Promise.resolve(undefined)
    const answered = await send('/team/api/session', { headers: { cookie: held.cookie } })
    expect(answered.status).toBe(500)
    expect((payload(answered) as { error: string }).error).toBe('unavailable')
  })

  it('says the same when the session names an account the store no longer has', async () => {
    const held = await signIn()
    // A session resolves through its account, so this cannot happen while the
    // store is consistent. If it ever does, the console must not render a
    // signed-in member with no name.
    store.getUser = () => Promise.resolve(undefined)
    const answered = await send('/team/api/session', { headers: { cookie: held.cookie } })
    expect(answered.status).toBe(500)
  })
})

describe('a Control Plane nobody configured', () => {
  it('refuses to load rather than authenticating against an organization that does not exist', () => {
    // The shipped Control Plane patch omits the key for this reason: the
    // failure happens as the plugin applies, naming what is missing, rather
    // than later as "that member and password do not match" for every member
    // forever. It throws before touching the context, so this calls it directly.
    expect(() => {
      api.apply(ctx, api.Config({ organizationId: '   ', secureCookie: false } as never))
    }).toThrow(/organizationId must name the organization/u)
  })
})
