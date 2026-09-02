/**
 * The administration API, driven the way the console drives it: JSON with a
 * session cookie, an Origin, and the session's own CSRF value in a header.
 *
 * The three refusals are what these tests are really for. A write must carry a
 * session, come from this site, and echo this session's own token, and dropping
 * any one of them must be a refusal rather than an action nobody asked for.
 */

import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import SqliteConsoleMenuStore from '@deepseek-ai/dsh-team-console-menu-sqlite'
import SqliteKnowledgeGateway from '@deepseek-ai/dsh-knowledge-gateway-sqlite'
import { KNOWLEDGE_CATALOG_RESOURCE } from '@deepseek-ai/dsh-knowledge-gateway'
import {
  KnowledgeSource,
  type UpstreamKnowledgeBase,
  type UpstreamPassage,
} from '@deepseek-ai/dsh-knowledge-source'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { AccessControl, GrantId, RoleId } from '@deepseek-ai/dsh-access-control'
import type { Audit } from '@deepseek-ai/dsh-audit'
import {
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  refreshSigningInput,
  type DeviceAuthorization,
  type DeviceId,
  type IssuedCredential,
} from '@deepseek-ai/dsh-device-authorization'
import { csrfToken, hashToken } from '@deepseek-ai/dsh-team-browser-session'
import * as api from '../src/index.ts'
import type {
  WireDepartment, WireDevice, WireMember, WireMenu, WireModel, WireOrganization, WireRole,
  WireSession,
} from '../src/types.ts'

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
let apiFiber: ReturnType<Context['plugin']>
let knowledgeHome: string
/** The scripted upstream this assembly's gateway reads. */
let source: ScriptedKnowledgeSource

const PASSWORD = 'Correct-Horse-Battery-1'

/** Every permission the console's own routes ask for. */
const KB_A = '690c0727-1af5-4b7a-8465-ebd2845f2266'
const REF_A = `stub:prod:${KB_A}`

/** A knowledge source a test scripts, so the catalog has something to hold. */
class ScriptedKnowledgeSource extends KnowledgeSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'prod'
  listing: readonly UpstreamKnowledgeBase[] = [{
    upstreamId: KB_A, name: '临港知识库', description: '', kind: 'document',
    documentCount: 1, chunkCount: 0, processingCount: 0,
    embeddingModelId: 'emb-shared', updatedAt: undefined,
  }]

  /** What the next listing raises instead of answering, when a test sets one. */
  failure: Error | undefined

  list(): Promise<readonly UpstreamKnowledgeBase[]> {
    return this.failure === undefined ? Promise.resolve(this.listing) : Promise.reject(this.failure)
  }

  search(): Promise<readonly UpstreamPassage[]> {
    return Promise.resolve([])
  }
}

const ADMIN_PERMISSIONS = [
  ['organization', 'organization.admin.access'],
  ['organization', 'organization.read'], ['organization', 'organization.settings.manage'],
  ['member', 'member.read'], ['member', 'member.create'], ['member', 'member.update'],
  ['member', 'member.delete'], ['member', 'member.disable'], ['member', 'member.enable'],
  ['member', 'member.password.reset'], ['member', 'member.role.bind'],
  ['department', 'department.read'], ['department', 'department.manage'],
  ['role', 'role.read'], ['role', 'role.create'], ['role', 'role.update'],
  ['role', 'role.delete'], ['role', 'role.grant.manage'],
  ['menu', 'menu.manage'],
  ['device', 'device.inventory.read'], ['device', 'device.revoke'],
  ['model', 'model.catalog.read'], ['model', 'model.catalog.manage'],
  ['knowledge_scope', 'knowledge.catalog.read'], ['knowledge_scope', 'knowledge.catalog.manage'],
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
  return sendTo(origin, path, init)
}

/** The same, against an assembly other than the one this file mostly uses. */
function sendTo(
  base: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Answer> {
  const { method = 'GET', headers = {}, body } = init
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { method, headers }, (res) => {
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

/**
 * Wait for the startup effects a freshly mounted plugin runs.
 *
 * `fiber.await()` resolves once the plugin has applied; the work its effect
 * does is asynchronous, so a test that reads what the effect wrote yields the
 * microtask queue first.
 */
async function settled(): Promise<void> {
  await new Promise((resolve) => { setImmediate(resolve) })
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
async function bindDevice(cookie: string, owner: UserId = alice): Promise<DeviceId> {
  return (await bindCredential(cookie, owner)).credential.deviceId
}

/** Bind one computer and retain the credentials needed to prove revocation. */
async function bindCredential(
  cookie: string,
  owner: UserId = alice,
): Promise<{ credential: IssuedCredential; signInput: (input: string) => string }> {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const signInput = (input: string): string =>
    sign(null, Buffer.from(input), privateKey).toString('base64url')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const verifier = newSecret()
  const started = await devices.start({
    publicKey: spki, platform: 'linux', runnerVersion: '1.0.0',
    pkceChallenge: pkceChallenge(verifier),
    callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
  })
  const issued = await devices.confirm(started.transactionId, {
    orgId, userId: owner, authenticationId: `session:${hashToken(cookie.slice(cookie.indexOf('=') + 1))}`,
  })
  const credential = await devices.redeem({
    transactionId: started.transactionId,
    code: issued.code,
    pkceVerifier: verifier,
    deviceSignature: signInput(redeemSigningInput(started.transactionId, issued.code)),
    callbackUri: 'http://127.0.0.1:3080/team/callback',
    protocolVersion: 1,
  })
  return { credential, signInput }
}

beforeEach(async () => {
  knowledgeHome = mkdtempSync(join(tmpdir(), 'dsh-admin-knowledge-'))
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(PasswordAccountAuth, {
    minSecretLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
    maxFailedAttempts: 5, lockDurationMs: 60_000,
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
  await ctx.plugin(SqliteConsoleMenuStore, { path: ':memory:' }).await()
  await ctx.plugin(ScriptedKnowledgeSource).await()
  source = ctx.get('knowledgeSource') as ScriptedKnowledgeSource
  await ctx.plugin(SqliteKnowledgeGateway, { path: join(knowledgeHome, 'knowledge.sqlite') }).await()

  store = ctx.get('accountStore') as AccountStore
  access = ctx.get('accessControl') as AccessControl
  audit = ctx.get('audit') as Audit
  devices = ctx.get('deviceAuthorization') as DeviceAuthorization
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
  await ctx.accountAuth.setSecret(alice, PASSWORD)

  apiFiber = ctx.plugin(api, api.Config({ organizationId: orgId, secureCookie: false } as never))
  await apiFiber.await()

  // Alice administers: the API governs its own control resources as it mounts,
  // so the grants come after it.
  adminRole = (await access.createRole({ orgId, name: 'admin' })).id
  for (const [type, action] of ADMIN_PERMISSIONS) await access.grantType(adminRole, type, action)
  await access.bindUserRole(alice, adminRole)

  origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(knowledgeHome, { recursive: true, force: true })
})

describe('signing in', () => {
  it('refuses an active member who has no administration-console grant', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)

    const landed = await send('/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ loginName: 'bob', secret: PASSWORD }),
    })

    expect(landed.status).toBe(403)
    expect(head(landed, 'set-cookie')).toBeUndefined()
    expect((await audit.query({ orgId, action: 'member.login' }))[0])
      .toMatchObject({ principalId: bob, outcome: 'denied', reason: 'no-grant' })
  })

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
    // The console checks a new password against this before sending it.
    expect(session.secretPolicy).toEqual({
      minLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
    })
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

  it('refuses reads and writes as soon as the console-entry grant is revoked', async () => {
    const held = await signIn()
    const entry = (await access.listRoleGrants(adminRole))
      .find(grant => grant.action === 'organization.admin.access')
    if (entry === undefined) throw new Error('test setup did not grant console entry')
    await access.revokeGrant(entry.id)

    expect((await send('/team/api/session', { headers: { cookie: held.cookie } })).status).toBe(403)
    const refused = await write('PATCH', '/team/api/organization', held, { name: 'Nope' })
    expect(refused.status).toBe(403)
    expect((await store.getOrganization(orgId))?.name).toBe('Acme')
  })
})

describe('what a role does not carry', () => {
  /** Bob may enter the console but holds none of its administrative actions. */
  async function bobsSession(): Promise<{ cookie: string; csrf: string }> {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const entry = await access.createRole({ orgId, name: 'console-entry' })
    await access.grantType(entry.id, 'organization', 'organization.admin.access')
    await access.bindUserRole(bob, entry.id)
    return signIn('bob')
  }

  it('refuses every read a member is not granted', async () => {
    const held = await bobsSession()
    for (const path of [
      '/team/api/overview', '/team/api/organization', '/team/api/members',
      '/team/api/departments', '/team/api/roles', '/team/api/devices', '/team/api/models',
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
      ['POST', '/team/api/members', { loginName: 'carol', displayName: 'Carol', secret: PASSWORD }],
      ['PATCH', `/team/api/members/${alice}`, { status: 'suspended' }],
      ['PATCH', `/team/api/members/${alice}/password`, { secret: PASSWORD }],
      ['POST', `/team/api/members/${alice}/roles`, { roleId: adminRole }],
      ['DELETE', `/team/api/members/${alice}/roles/${adminRole}`, undefined],
      ['PATCH', `/team/api/members/${alice}`, { displayName: 'Bobby' }],
      ['DELETE', `/team/api/members/${alice}`, undefined],
      ['POST', '/team/api/departments', { name: 'Sneaky', code: 'sneaky' }],
      ['PATCH', '/team/api/departments/anything', { name: 'Sneaky' }],
      ['DELETE', '/team/api/departments/anything', undefined],
      ['POST', '/team/api/menus', { name: 'Sneaky', kind: 'menu' }],
      ['PATCH', '/team/api/menus/anything', { name: 'Sneaky' }],
      ['DELETE', '/team/api/menus/anything', undefined],
      ['POST', '/team/api/roles', { name: 'sneaky' }],
      ['PATCH', `/team/api/roles/${adminRole}`, { name: 'sneaky' }],
      ['DELETE', `/team/api/roles/${adminRole}`, undefined],
      ['POST', `/team/api/roles/${adminRole}/menus`, { menuIds: [] }],
      ['POST', `/team/api/roles/${adminRole}/permissions`, { permissions: [] }],
      ['POST', `/team/api/roles/${adminRole}/grants`, { resourceType: 'model', action: 'model.invoke' }],
      ['POST', `/team/api/roles/${adminRole}/models`, { modelIds: [] }],
      ['DELETE', '/team/api/grants/anything', undefined],
      ['DELETE', '/team/api/devices/anything', undefined],
      ['POST', '/team/api/models', USABLE_MODEL],
      ['PATCH', '/team/api/models/deepseek-chat', { status: 'retired' }],
      ['DELETE', '/team/api/models/deepseek-chat', undefined],
    ] as const) {
      const refused = await write(method, path, held, body)
      expect(refused.status, path).toBe(403)
    }
    expect(await store.listUsers(orgId)).toHaveLength(2)
    expect(await access.listRoles(orgId)).toHaveLength(2)
    expect((await store.getOrganization(orgId))?.name).toBe('Acme')
    expect(await access.rolesOf(alice)).toEqual([adminRole])
    expect(await ctx.modelGateway.list(orgId)).toHaveLength(0)
  })

  it('answers the permission catalog to a console member with no administrative actions', async () => {
    const held = await bobsSession()
    const listed = await send('/team/api/permissions', { headers: { cookie: held.cookie } })
    expect(listed.status).toBe(200)
    // The catalog names what this build governs, not what this organization
    // holds, so it tells a member nothing about the organization.
    expect((payload(listed) as { action: string }[]).some(row => row.action === 'member.read')).toBe(true)
  })

  it('answers who a member is with only the console-entry permission', async () => {
    const held = await bobsSession()
    const asked = await send('/team/api/session', { headers: { cookie: held.cookie } })
    expect(asked.status).toBe(200)
    expect((payload(asked) as WireSession).permissions).toEqual([
      'organization|organization.admin.access',
    ])
    expect((payload(asked) as WireSession).secretPolicy).toMatchObject({ minLength: 8 })
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

  it('edits the company row the way it edits a department, and clears what is sent empty', async () => {
    const held = await signIn()
    const edited = await write('PATCH', '/team/api/organization', held, {
      name: 'Acme', code: 'acme', leaderId: alice, phone: '13800000000', email: 'hq@acme.example',
    })
    expect(edited.status).toBe(200)
    expect(payload(edited)).toMatchObject({
      code: 'acme', leaderId: alice, leaderName: 'Alice', phone: '13800000000', email: 'hq@acme.example',
    })

    const cleared = await write('PATCH', '/team/api/organization', held, {
      name: 'Acme', code: '', leaderId: '', phone: '', email: '',
    })
    const after = payload(cleared) as WireOrganization
    expect(after.code).toBeUndefined()
    expect(after.leaderId).toBeUndefined()
    expect(after.leaderName).toBeUndefined()
    expect(after.phone).toBeUndefined()
    expect(after.email).toBeUndefined()
  })

  it('adds a member, and refuses a second one with the same login name', async () => {
    const held = await signIn()
    const added = await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob', email: 'bob@acme.example', secret: PASSWORD,
    })
    expect(added.status).toBe(200)
    const members = (payload(added) as WireMember[])
    expect(members.map(member => member.loginName)).toEqual(['alice', 'bob'])
    expect(members.find(member => member.loginName === 'bob')?.email).toBe('bob@acme.example')
    expect(members.find(member => member.loginName === 'alice')?.email).toBeUndefined()
    expect((await audit.query({ orgId, action: 'member.create' }))[0]).toMatchObject({ principalId: alice })

    const again = await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob Two', secret: PASSWORD,
    })
    expect(again.status).toBe(409)
    expect(await store.listUsers(orgId)).toHaveLength(2)
  })

  it('provisions the initial password with the account', async () => {
    const held = await signIn()
    const members = payload(await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob', secret: PASSWORD,
    })) as WireMember[]
    const bob = members.find(member => member.loginName === 'bob') as WireMember
    await access.bindUserRole(bob.id as UserId, adminRole)

    await expect(signIn('bob', PASSWORD)).resolves.toHaveProperty('cookie')
  })

  it('does not leave an account behind when its initial password is too weak', async () => {
    const held = await signIn()
    const refused = await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob', secret: 'short',
    })

    expect(refused.status).toBe(400)
    expect(payload(refused)).toMatchObject({ reason: 'weak-secret' })
    expect(await store.findUserByLogin(orgId, 'bob')).toBeUndefined()
    expect(await audit.query({ orgId, action: 'member.create' })).toHaveLength(0)
  })

  it('changes a password and signs every session and Runner device out', async () => {
    const held = await signIn()
    const members = payload(await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob', secret: PASSWORD,
    })) as WireMember[]
    const bob = members.find(member => member.loginName === 'bob') as WireMember
    await access.bindUserRole(bob.id as UserId, adminRole)
    const bobsSession = await signIn('bob', PASSWORD)
    const credentials = await Promise.all([
      bindCredential(bobsSession.cookie, bob.id as UserId),
      bindCredential(bobsSession.cookie, bob.id as UserId),
    ])
    const nextPassword = 'Another-Correct-Horse-2'

    const reset = await write('PATCH', `/team/api/members/${bob.id}/password`, held, {
      secret: nextPassword,
    })

    expect(reset.status).toBe(200)
    expect(payload(reset)).toEqual({ reset: true, self: false })
    expect((await send('/team/api/session', { headers: { cookie: bobsSession.cookie } })).status).toBe(401)
    for (const { credential, signInput } of credentials) {
      expect(await devices.verifyAccessToken(credential.accessToken)).toBeUndefined()
      await expect(devices.refresh({
        familyId: credential.familyId,
        refreshToken: credential.refreshToken,
        deviceSignature: signInput(refreshSigningInput(credential.familyId, credential.refreshToken)),
      })).rejects.toMatchObject({ reason: 'revoked' })
    }
    const oldPassword = await send('/team/api/session', {
      method: 'POST', headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ loginName: 'bob', secret: PASSWORD }),
    })
    expect(oldPassword.status).toBe(401)
    await expect(signIn('bob', nextPassword)).resolves.toHaveProperty('cookie')
    expect((await send('/team/api/session', { headers: { cookie: held.cookie } })).status).toBe(200)
    expect(await audit.query({ orgId, action: 'member.password.reset' })).toHaveLength(1)
  })

  it('suspends a member, which is by itself the end of their sessions, then reactivates them', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const entry = await access.createRole({ orgId, name: 'console-entry' })
    await access.grantType(entry.id, 'organization', 'organization.admin.access')
    await access.bindUserRole(bob, entry.id)
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

  it('edits a model through the write that registered it, leaving its status alone', async () => {
    const held = await signIn()
    await write('POST', '/team/api/models', held, USABLE_MODEL)
    await write('PATCH', '/team/api/models/deepseek-chat', held, { status: 'retired' })

    const edited = await write('POST', '/team/api/models', held, {
      ...USABLE_MODEL, displayName: 'DeepSeek Chat v2', endpoint: 'https://api.deepseek.com/v2',
    })
    expect(edited.status).toBe(200)
    // The stable ref is the identity, so the route moves and the status a
    // separate act set stays as it was.
    expect((payload(edited) as WireModel[])[0]).toMatchObject({
      modelRef: 'deepseek-chat',
      displayName: 'DeepSeek Chat v2',
      endpoint: 'https://api.deepseek.com/v2',
      status: 'retired',
    })
    expect(await ctx.modelGateway.list(orgId)).toHaveLength(1)
  })

  it('deletes a model with the grants that named it', async () => {
    const held = await signIn()
    await write('POST', '/team/api/models', held, USABLE_MODEL)
    const governed = (await access.listResources(orgId, 'model'))
      .find(resource => resource.externalRef === 'deepseek-chat')
    await access.grantResource(adminRole, governed!.id, 'model.invoke')

    const deleted = await write('DELETE', '/team/api/models/deepseek-chat', held)
    expect(deleted.status).toBe(200)
    expect(payload(deleted)).toEqual([])
    expect(await ctx.modelGateway.list(orgId)).toHaveLength(0)
    expect((await access.listResources(orgId, 'model')).map(resource => resource.externalRef))
      .toEqual([api.MODEL_CATALOG_RESOURCE])
    expect((await access.listRoleGrants(adminRole)).some(grant => grant.kind === 'resource')).toBe(false)
    expect((await audit.query({ orgId, action: 'resource.delete' }))[0])
      .toMatchObject({ resourceId: 'deepseek-chat' })
  })

  it('will not delete the catalog resource an administrator reaches this page through', async () => {
    const held = await signIn()
    // The console's own model-catalog resource is governed under the model
    // type and is not a catalog entry. Ungoverning it would revoke the grants
    // that admit every later model.catalog request, with no way back through
    // the console.
    const deleted = await write('DELETE', `/team/api/models/${encodeURIComponent(api.MODEL_CATALOG_RESOURCE)}`, held)
    expect(deleted.status).toBe(200)
    expect((await access.listResources(orgId, 'model')).map(resource => resource.externalRef))
      .toEqual([api.MODEL_CATALOG_RESOURCE])
    const registered = await write('POST', '/team/api/models', held, USABLE_MODEL)
    expect(registered.status).toBe(200)
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
    await write('POST', '/team/api/members', held, {
      loginName: 'bob', displayName: 'Bob', secret: PASSWORD,
    })
    for (const [reason, method, path, body] of [
      ['fields', 'PATCH', '/team/api/organization', {}],
      ['login-taken', 'POST', '/team/api/members', {
        loginName: 'bob', displayName: 'Bob Two', secret: PASSWORD,
      }],
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
      loginName: 'x'.repeat(20_000), displayName: 'Bob', secret: PASSWORD,
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
      loginName: 'bob', displayName: 'Bob', secret: PASSWORD,
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

describe('the department tree', () => {
  it('reads, creates, edits, and deletes departments', async () => {
    const held = await signIn('alice', PASSWORD)

    expect(payload(await send('/team/api/departments', { headers: { cookie: held.cookie } }))).toEqual([])

    const created = await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology', phone: '13800000001', email: 'tech@zenith.dev',
      leaderId: alice, sortOrder: 2,
    })
    expect(created.status).toBe(200)
    const [department] = payload(created) as WireDepartment[]
    expect(department).toMatchObject({
      name: 'Technology', code: 'technology', category: 'department',
      leaderName: 'Alice', memberCount: 0, status: 'active',
    })

    const renamed = await write('PATCH', `/team/api/departments/${department?.id as string}`, held, {
      name: 'Platform', status: 'suspended',
    })
    expect((payload(renamed) as WireDepartment[])[0])
      .toMatchObject({ name: 'Platform', status: 'suspended' })

    const removed = await write('DELETE', `/team/api/departments/${department?.id as string}`, held)
    expect(payload(removed)).toEqual([])
  })

  it('counts the accounts in a department, by name', async () => {
    const held = await signIn('alice', PASSWORD)
    const [department] = payload(await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology',
    })) as WireDepartment[]
    await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', departmentId: department?.id, secret: PASSWORD,
    })
    const after = payload(await send('/team/api/departments', { headers: { cookie: held.cookie } })) as
      WireDepartment[]
    expect(after[0]).toMatchObject({ memberCount: 1, memberNames: ['Dev'] })
  })

  it('refuses a department without a name and a code', async () => {
    const held = await signIn('alice', PASSWORD)
    const refused = await write('POST', '/team/api/departments', held, { name: 'Technology' })
    expect(refused.status).toBe(400)
    expect(payload(refused)).toMatchObject({ reason: 'fields' })
  })

  it('refuses a code another department already has', async () => {
    const held = await signIn('alice', PASSWORD)
    await write('POST', '/team/api/departments', held, { name: 'Technology', code: 'technology' })
    const refused = await write('POST', '/team/api/departments', held, {
      name: 'Tech again', code: 'technology',
    })
    expect(refused.status).toBe(409)
    expect(payload(refused)).toMatchObject({ reason: 'code-taken' })
  })

  it('refuses a category and a status this build does not have', async () => {
    const held = await signIn('alice', PASSWORD)
    const badCategory = await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology', category: 'division',
    })
    expect(payload(badCategory)).toMatchObject({ reason: 'fields' })

    const [department] = payload(await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology',
    })) as WireDepartment[]
    const badStatus = await write('PATCH', `/team/api/departments/${department?.id as string}`, held, {
      status: 'archived',
    })
    expect(payload(badStatus)).toMatchObject({ reason: 'department-status' })
    const badEditCategory = await write('PATCH', `/team/api/departments/${department?.id as string}`, held, {
      category: 'division',
    })
    expect(payload(badEditCategory)).toMatchObject({ reason: 'fields' })
  })

  it('refuses to delete a department that still holds an account', async () => {
    const held = await signIn('alice', PASSWORD)
    const [department] = payload(await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology',
    })) as WireDepartment[]
    await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', departmentId: department?.id, secret: PASSWORD,
    })
    const refused = await write('DELETE', `/team/api/departments/${department?.id as string}`, held)
    expect(refused.status).toBe(409)
    expect(payload(refused)).toMatchObject({ reason: 'department-not-empty' })
  })
})

describe('an account profile', () => {
  it('stores the profile fields a new account was given', async () => {
    const held = await signIn('alice', PASSWORD)
    const [department] = payload(await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology',
    })) as WireDepartment[]
    const members = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', phone: '13800000002', gender: 'female',
      departmentId: department?.id, secret: PASSWORD,
    })) as WireMember[]
    expect(members.find(member => member.loginName === 'dev')).toMatchObject({
      phone: '13800000002', gender: 'female', departmentName: 'Technology',
    })
  })

  it('edits a profile without touching the login name or the status', async () => {
    const held = await signIn('alice', PASSWORD)
    const before = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', secret: PASSWORD,
    })) as WireMember[]
    const dev = before.find(member => member.loginName === 'dev') as WireMember
    const after = payload(await write('PATCH', `/team/api/members/${dev.id}`, held, {
      displayName: 'Developer', phone: '13800000003',
    })) as WireMember[]
    expect(after.find(member => member.id === dev.id)).toMatchObject({
      loginName: 'dev', displayName: 'Developer', phone: '13800000003', status: 'active',
    })
  })

  it('refuses a gender this build does not record', async () => {
    const held = await signIn('alice', PASSWORD)
    const refused = await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', gender: 'other', secret: PASSWORD,
    })
    expect(payload(refused)).toMatchObject({ reason: 'gender' })

    const members = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev2', displayName: 'Dev2', secret: PASSWORD,
    })) as WireMember[]
    const dev = members.find(member => member.loginName === 'dev2') as WireMember
    const refusedEdit = await write('PATCH', `/team/api/members/${dev.id}`, held, { gender: 'other' })
    expect(payload(refusedEdit)).toMatchObject({ reason: 'gender' })
  })
})

describe('the console navigation', () => {
  it('serves the shipped tree to any session, without a grant', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    // Bob may enter the console and nothing else.
    const entry = (await access.createRole({ orgId, name: 'entry' })).id
    await access.grantType(entry, 'organization', 'organization.admin.access')
    await access.bindUserRole(bob, entry)

    const held = await signIn('bob', PASSWORD)
    const menus = payload(await send('/team/api/menus', { headers: { cookie: held.cookie } })) as WireMenu[]
    expect(menus.length).toBeGreaterThan(0)
    expect(menus.every(menu => menu.shipped)).toBe(true)
  })

  it('creates, edits, and deletes an entry', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/menus', held, {
      name: 'Reports', kind: 'menu', routePath: '/reports',
      componentPath: 'system/UsersPage', permission: 'member|member.read', icon: 'team',
      sortOrder: 9, visible: false,
    })) as WireMenu[]
    const made = created.find(menu => menu.name === 'Reports') as WireMenu
    expect(made).toMatchObject({
      kind: 'menu', routePath: '/reports', permission: 'member|member.read',
      visible: false, shipped: false,
    })

    const edited = payload(await write('PATCH', `/team/api/menus/${made.id}`, held, {
      name: 'Usage', status: 'suspended', visible: true,
    })) as WireMenu[]
    expect(edited.find(menu => menu.id === made.id))
      .toMatchObject({ name: 'Usage', status: 'suspended', visible: true })

    const removed = payload(await write('DELETE', `/team/api/menus/${made.id}`, held)) as WireMenu[]
    expect(removed.find(menu => menu.id === made.id)).toBeUndefined()
  })

  it('refuses an entry naming a permission the catalog does not govern', async () => {
    const held = await signIn('alice', PASSWORD)
    const refused = await write('POST', '/team/api/menus', held, {
      name: 'Reports', kind: 'menu', permission: 'member|member.invent',
    })
    expect(payload(refused)).toMatchObject({ reason: 'permission' })

    const menus = payload(await send('/team/api/menus', { headers: { cookie: held.cookie } })) as WireMenu[]
    const first = menus[0] as WireMenu
    const refusedEdit = await write('PATCH', `/team/api/menus/${first.id}`, held, {
      permission: 'member|member.invent',
    })
    expect(payload(refusedEdit)).toMatchObject({ reason: 'permission' })
  })

  it('refuses a kind and a status this build does not have', async () => {
    const held = await signIn('alice', PASSWORD)
    expect(payload(await write('POST', '/team/api/menus', held, { name: 'Reports', kind: 'widget' })))
      .toMatchObject({ reason: 'menu-kind' })
    expect(payload(await write('POST', '/team/api/menus', held, { name: 'Reports' })))
      .toMatchObject({ reason: 'fields' })

    const menus = payload(await send('/team/api/menus', { headers: { cookie: held.cookie } })) as WireMenu[]
    const first = menus[0] as WireMenu
    expect(payload(await write('PATCH', `/team/api/menus/${first.id}`, held, { status: 'archived' })))
      .toMatchObject({ reason: 'menu-status' })
    expect(payload(await write('PATCH', `/team/api/menus/${first.id}`, held, { kind: 'widget' })))
      .toMatchObject({ reason: 'menu-kind' })
  })

  it('refuses to delete an entry other entries sit under', async () => {
    const held = await signIn('alice', PASSWORD)
    const menus = payload(await send('/team/api/menus', { headers: { cookie: held.cookie } })) as WireMenu[]
    const group = menus.find(menu => menu.kind === 'catalog') as WireMenu
    const refused = await write('DELETE', `/team/api/menus/${group.id}`, held)
    expect(refused.status).toBe(409)
    expect(payload(refused)).toMatchObject({ reason: 'menu-not-empty' })
  })
})

describe('roles as the console administers them', () => {
  it('carries a code, a creation moment, and who holds it', async () => {
    const held = await signIn('alice', PASSWORD)
    const roles = payload(await write('POST', '/team/api/roles', held, {
      name: 'Editor', code: 'cms_editor', description: 'Edits',
    })) as WireRole[]
    const editor = roles.find(role => role.name === 'Editor') as WireRole
    expect(editor).toMatchObject({ code: 'cms_editor', description: 'Edits', memberCount: 0 })
    expect(editor.createdAt).toBeGreaterThan(0)

    const admin = roles.find(role => role.name === 'admin') as WireRole
    expect(admin).toMatchObject({ memberCount: 1, memberNames: ['Alice'] })
  })

  it('edits and deletes a role', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Editor' })) as WireRole[]
    const editor = created.find(role => role.name === 'Editor') as WireRole

    const edited = payload(await write('PATCH', `/team/api/roles/${editor.id}`, held, {
      name: 'Reviewer', code: 'reviewer', description: '',
    })) as WireRole[]
    expect(edited.find(role => role.id === editor.id))
      .toMatchObject({ name: 'Reviewer', code: 'reviewer', description: '' })

    const removed = payload(await write('DELETE', `/team/api/roles/${editor.id}`, held)) as WireRole[]
    expect(removed.find(role => role.id === editor.id)).toBeUndefined()
  })

  it('refuses a name or a code another role already has', async () => {
    const held = await signIn('alice', PASSWORD)
    await write('POST', '/team/api/roles', held, { name: 'Editor', code: 'editor' })
    expect(payload(await write('POST', '/team/api/roles', held, { name: 'Editor' })))
      .toMatchObject({ reason: 'name-taken' })
    expect(payload(await write('POST', '/team/api/roles', held, { name: 'Other', code: 'editor' })))
      .toMatchObject({ reason: 'code-taken' })
  })

  it('refuses to delete a role the product ships', async () => {
    const held = await signIn('alice', PASSWORD)
    const shipped = (await access.createRole({ orgId, name: 'Owner', kind: 'system' })).id
    const refused = await write('DELETE', `/team/api/roles/${shipped}`, held)
    expect(refused.status).toBe(409)
    expect(payload(refused)).toMatchObject({ reason: 'system-role' })
  })

  it('grants a role the selected model resources for discovery and invocation', async () => {
    const held = await signIn('alice', PASSWORD)
    const first = payload(await write('POST', '/team/api/models', held, USABLE_MODEL)) as WireModel[]
    const models = payload(await write('POST', '/team/api/models', held, {
      ...USABLE_MODEL,
      modelRef: 'deepseek-reasoner',
      displayName: 'DeepSeek Reasoner',
      upstreamModel: 'deepseek-reasoner',
    })) as WireModel[]
    expect(first[0]?.resourceId).toBeTruthy()
    const chat = models.find(model => model.modelRef === 'deepseek-chat') as WireModel
    const reasoner = models.find(model => model.modelRef === 'deepseek-reasoner') as WireModel
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Model user' })) as WireRole[]
    const role = created.find(entry => entry.name === 'Model user') as WireRole
    await access.grantType(role.id as RoleId, 'model', 'model.discover')
    await access.grantType(role.id as RoleId, 'model', 'model.invoke')

    const narrowed = payload(await write('POST', `/team/api/roles/${role.id}/models`, held, {
      modelIds: [reasoner.resourceId],
    })) as WireRole[]

    const grants = (narrowed.find(entry => entry.id === role.id) as WireRole).grants
      .filter(grant => grant.resourceType === 'model')
    expect(grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        scope: 'resource', resourceId: reasoner.resourceId, action: 'model.discover',
      }),
      expect.objectContaining({
        scope: 'resource', resourceId: reasoner.resourceId, action: 'model.invoke',
      }),
    ]))
    expect(grants).toHaveLength(2)
    expect(grants.some(grant => grant.resourceId === chat.resourceId)).toBe(false)

    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await access.bindUserRole(bob, role.id as RoleId)
    await expect(ctx.modelGateway.discover(orgId, bob)).resolves.toEqual([
      { modelRef: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner' },
    ])
  })

  it('does not attach this organization models to a role from another organization', async () => {
    const held = await signIn('alice', PASSWORD)
    const other = await store.createOrganization('Other')
    const role = await access.createRole({ orgId: other.id, name: 'Other member' })

    const refused = await write('POST', `/team/api/roles/${role.id}/models`, held, { modelIds: [] })

    expect(refused.status).toBe(404)
    expect(await access.listRoleGrants(role.id)).toEqual([])
  })
})

describe('menu access as a way to compose a role', () => {
  it('grants what the chosen entries declare and revokes the rest', async () => {
    const held = await signIn('alice', PASSWORD)
    const menus = payload(await send('/team/api/menus', { headers: { cookie: held.cookie } })) as WireMenu[]
    const users = menus.find(menu => menu.permission === 'member|member.read') as WireMenu
    const models = menus.find(menu => menu.permission === 'model|model.catalog.read') as WireMenu
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Viewer' })) as WireRole[]
    const viewer = created.find(role => role.name === 'Viewer') as WireRole

    const granted = payload(await write('POST', `/team/api/roles/${viewer.id}/menus`, held, {
      menuIds: [users.id, models.id],
    })) as WireRole[]
    const held2 = (granted.find(role => role.id === viewer.id) as WireRole).grants
      .map(grant => `${grant.resourceType}|${grant.action}`)
    expect(held2).toContain('member|member.read')
    expect(held2).toContain('model|model.catalog.read')

    const narrowed = payload(await write('POST', `/team/api/roles/${viewer.id}/menus`, held, {
      menuIds: [users.id],
    })) as WireRole[]
    const after = (narrowed.find(role => role.id === viewer.id) as WireRole).grants
      .map(grant => `${grant.resourceType}|${grant.action}`)
    expect(after).toEqual(['member|member.read'])
  })

  it('leaves a grant no navigation entry declares exactly as it was', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Caller' })) as WireRole[]
    const caller = created.find(role => role.name === 'Caller') as WireRole
    await write('POST', `/team/api/roles/${caller.id}/grants`, held, {
      resourceType: 'model', action: 'model.invoke',
    })

    const after = payload(await write('POST', `/team/api/roles/${caller.id}/menus`, held, {
      menuIds: [],
    })) as WireRole[]
    expect((after.find(role => role.id === caller.id) as WireRole).grants
      .map(grant => grant.action)).toEqual(['model.invoke'])
  })

  it('refuses menu access that is not a list of entry ids', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Viewer' })) as WireRole[]
    const viewer = created.find(role => role.name === 'Viewer') as WireRole
    const refused = await write('POST', `/team/api/roles/${viewer.id}/menus`, held, { menuIds: 'all' })
    expect(refused.status).toBe(400)
    expect(payload(refused)).toMatchObject({ reason: 'fields' })
  })
})

describe('the fields a partial edit leaves alone', () => {
  it('places a department under another, and edits one field of it', async () => {
    const held = await signIn('alice', PASSWORD)
    const [parent] = payload(await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology',
    })) as WireDepartment[]
    const withChild = payload(await write('POST', '/team/api/departments', held, {
      name: 'Platform', code: 'platform', parentId: parent?.id, category: 'company',
    })) as WireDepartment[]
    const child = withChild.find(department => department.code === 'platform') as WireDepartment
    expect(child).toMatchObject({ parentId: parent?.id, category: 'company' })

    const edited = payload(await write('PATCH', `/team/api/departments/${child.id}`, held, {
      sortOrder: 4,
    })) as WireDepartment[]
    expect(edited.find(department => department.id === child.id))
      .toMatchObject({ name: 'Platform', code: 'platform', sortOrder: 4 })
  })

  it('adds an entry under another, with no icon and no permission', async () => {
    const held = await signIn('alice', PASSWORD)
    const menus = payload(await send('/team/api/menus', { headers: { cookie: held.cookie } })) as WireMenu[]
    const group = menus.find(menu => menu.kind === 'catalog') as WireMenu
    const after = payload(await write('POST', '/team/api/menus', held, {
      name: 'Plain', kind: 'menu', parentId: group.id,
    })) as WireMenu[]
    const plain = after.find(menu => menu.name === 'Plain') as WireMenu
    expect(plain.parentId).toBe(group.id)
    expect(plain.icon).toBeUndefined()
    expect(plain.permission).toBeUndefined()

    const edited = payload(await write('PATCH', `/team/api/menus/${plain.id}`, held, {
      kind: 'action',
    })) as WireMenu[]
    expect(edited.find(menu => menu.id === plain.id)).toMatchObject({ name: 'Plain', kind: 'action' })
  })

  it('edits one profile field, and ignores a value that is not text', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', secret: PASSWORD,
    })) as WireMember[]
    const dev = created.find(member => member.loginName === 'dev') as WireMember
    const edited = payload(await write('PATCH', `/team/api/members/${dev.id}`, held, {
      phone: 13_800_000_004,
      email: 'dev@zenith.dev',
    })) as WireMember[]
    const after = edited.find(member => member.id === dev.id) as WireMember
    expect(after).toMatchObject({ displayName: 'Dev', email: 'dev@zenith.dev' })
    expect(after.phone).toBeUndefined()
  })

  it('edits one role field', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Editor' })) as WireRole[]
    const editor = created.find(role => role.name === 'Editor') as WireRole
    const edited = payload(await write('PATCH', `/team/api/roles/${editor.id}`, held, {
      description: 'Edits pages',
    })) as WireRole[]
    expect(edited.find(role => role.id === editor.id))
      .toMatchObject({ name: 'Editor', description: 'Edits pages' })
  })

  it('leaves a grant on one named resource out of menu access', async () => {
    const held = await signIn('alice', PASSWORD)
    const resource = await access.registerResource({
      orgId, type: 'model', externalRef: 'v4', displayName: 'V4',
    })
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Caller' })) as WireRole[]
    const caller = created.find(role => role.name === 'Caller') as WireRole
    await access.grantResource(caller.id as never, resource.id, 'model.invoke')

    const after = payload(await write('POST', `/team/api/roles/${caller.id}/menus`, held, {
      menuIds: [],
    })) as WireRole[]
    expect((after.find(role => role.id === caller.id) as WireRole).grants)
      .toMatchObject([{ scope: 'resource', action: 'model.invoke' }])
  })
})

describe('a failure the console has no words for', () => {
  it('answers that the site could not serve the request, and says nothing else', async () => {
    const held = await signIn('alice', PASSWORD)
    for (const [method, path, body] of [
      // A parent that is not there fails a foreign key, which is neither a
      // duplicate code nor a permission this build does not govern.
      ['POST', '/team/api/departments', { name: 'Orphan', code: 'orphan', parentId: 'nowhere' }],
      ['PATCH', '/team/api/departments/nowhere', { name: 'Nowhere' }],
      ['DELETE', '/team/api/departments/nowhere', undefined],
      ['POST', '/team/api/menus', { name: 'Orphan', kind: 'menu', parentId: 'nowhere' }],
      ['PATCH', '/team/api/menus/nowhere', { name: 'Nowhere' }],
      ['DELETE', '/team/api/menus/nowhere', undefined],
      ['PATCH', '/team/api/roles/nowhere', { name: 'Nowhere' }],
      ['DELETE', '/team/api/roles/nowhere', undefined],
    ] as const) {
      const failed = await write(method, path, held, body)
      expect(failed.status, path).toBe(500)
      expect(payload(failed), path).toMatchObject({ error: 'unavailable' })
    }
  })
})

describe('an edit that names every field it may', () => {
  it('writes every department field', async () => {
    const held = await signIn('alice', PASSWORD)
    const [department] = payload(await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology',
    })) as WireDepartment[]
    const edited = payload(await write('PATCH', `/team/api/departments/${department?.id as string}`, held, {
      name: 'Platform', code: 'platform', category: 'company', leaderId: alice,
      phone: '13800000005', email: 'platform@zenith.dev', sortOrder: 3, status: 'active',
    })) as WireDepartment[]
    expect(edited[0]).toMatchObject({
      name: 'Platform', code: 'platform', category: 'company', leaderName: 'Alice',
      phone: '13800000005', email: 'platform@zenith.dev', sortOrder: 3,
    })
  })

  it('writes every navigation-entry field', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/menus', held, {
      name: 'Plain', kind: 'menu',
    })) as WireMenu[]
    const plain = created.find(menu => menu.name === 'Plain') as WireMenu
    const edited = payload(await write('PATCH', `/team/api/menus/${plain.id}`, held, {
      routePath: '/reports', componentPath: 'system/UsersPage',
      permission: 'member|member.read', icon: 'team', sortOrder: 6,
    })) as WireMenu[]
    expect(edited.find(menu => menu.id === plain.id)).toMatchObject({
      routePath: '/reports', componentPath: 'system/UsersPage',
      permission: 'member|member.read', icon: 'team', sortOrder: 6,
    })
  })

  it('writes every account profile field, and clears one sent as null', async () => {
    const held = await signIn('alice', PASSWORD)
    const [department] = payload(await write('POST', '/team/api/departments', held, {
      name: 'Technology', code: 'technology',
    })) as WireDepartment[]
    const created = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', email: 'dev@zenith.dev', secret: PASSWORD,
    })) as WireMember[]
    const dev = created.find(member => member.loginName === 'dev') as WireMember

    const edited = payload(await write('PATCH', `/team/api/members/${dev.id}`, held, {
      gender: 'male', departmentId: department?.id, phone: '13800000006',
    })) as WireMember[]
    expect(edited.find(member => member.id === dev.id)).toMatchObject({
      gender: 'male', departmentName: 'Technology', phone: '13800000006',
    })

    const cleared = payload(await write('PATCH', `/team/api/members/${dev.id}`, held, {
      email: null,
    })) as WireMember[]
    expect((cleared.find(member => member.id === dev.id) as WireMember).email).toBeUndefined()
  })

  it('refuses an edit to a role name another role already has', async () => {
    const held = await signIn('alice', PASSWORD)
    await write('POST', '/team/api/roles', held, { name: 'Editor', code: 'editor' })
    const both = payload(await write('POST', '/team/api/roles', held, {
      name: 'Reviewer', code: 'reviewer',
    })) as WireRole[]
    const reviewer = both.find(role => role.name === 'Reviewer') as WireRole
    const refused = await write('PATCH', `/team/api/roles/${reviewer.id}`, held, { name: 'Editor' })
    expect(refused.status).toBe(409)
    expect(payload(refused)).toMatchObject({ reason: 'name-taken' })
  })

  it('refuses an edit to a department code another department already has', async () => {
    const held = await signIn('alice', PASSWORD)
    await write('POST', '/team/api/departments', held, { name: 'Technology', code: 'technology' })
    const both = payload(await write('POST', '/team/api/departments', held, {
      name: 'Sales', code: 'sales',
    })) as WireDepartment[]
    const sales = both.find(department => department.code === 'sales') as WireDepartment
    const refused = await write('PATCH', `/team/api/departments/${sales.id}`, held, {
      code: 'technology',
    })
    expect(refused.status).toBe(409)
    expect(payload(refused)).toMatchObject({ reason: 'code-taken' })
  })
})

describe('deleting an account', () => {
  it('removes it with the roles bound to it and the devices it holds', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', secret: PASSWORD,
    })) as WireMember[]
    const dev = created.find(member => member.loginName === 'dev') as WireMember
    await write('POST', `/team/api/members/${dev.id}/roles`, held, { roleId: adminRole })

    const after = payload(await write('DELETE', `/team/api/members/${dev.id}`, held)) as WireMember[]
    expect(after.find(member => member.id === dev.id)).toBeUndefined()
    expect(await access.rolesOf(dev.id as UserId)).toHaveLength(0)
    expect(await store.getUser(dev.id as UserId)).toBeUndefined()
  })

  it('stops the computers the account bound from working', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', secret: PASSWORD,
    })) as WireMember[]
    const dev = created.find(member => member.loginName === 'dev') as WireMember
    const theirs = await bindDevice(held.cookie, dev.id as UserId)

    await write('DELETE', `/team/api/members/${dev.id}`, held)
    expect((await devices.listDevices(orgId)).find(device => device.id === theirs)?.status)
      .toBe('revoked')
  })

  it('leaves a computer another member bound where it is', async () => {
    const held = await signIn('alice', PASSWORD)
    const alicesDevice = await bindDevice(held.cookie)
    const created = payload(await write('POST', '/team/api/members', held, {
      loginName: 'dev', displayName: 'Dev', secret: PASSWORD,
    })) as WireMember[]
    const dev = created.find(member => member.loginName === 'dev') as WireMember

    await write('DELETE', `/team/api/members/${dev.id}`, held)
    const remaining = await devices.listDevices(orgId)
    expect(remaining.find(device => device.id === alicesDevice)?.status).not.toBe('revoked')
  })

  it('refuses to delete the account the request was made from', async () => {
    const held = await signIn('alice', PASSWORD)
    const refused = await write('DELETE', `/team/api/members/${alice}`, held)
    expect(refused.status).toBe(409)
    expect(payload(refused)).toMatchObject({ reason: 'self-delete' })
    expect(await store.getUser(alice)).toBeDefined()
  })
})

describe('setting a role’s permissions', () => {
  it('grants what was checked and revokes what was not', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Viewer' })) as WireRole[]
    const viewer = created.find(role => role.name === 'Viewer') as WireRole

    const granted = payload(await write('POST', `/team/api/roles/${viewer.id}/permissions`, held, {
      permissions: ['member|member.read', 'role|role.read'],
    })) as WireRole[]
    expect((granted.find(role => role.id === viewer.id) as WireRole).grants
      .map(grant => grant.action).sort()).toEqual(['member.read', 'role.read'])

    const narrowed = payload(await write('POST', `/team/api/roles/${viewer.id}/permissions`, held, {
      permissions: ['role|role.read'],
    })) as WireRole[]
    expect((narrowed.find(role => role.id === viewer.id) as WireRole).grants
      .map(grant => grant.action)).toEqual(['role.read'])
  })

  it('leaves a grant on one named resource alone', async () => {
    const held = await signIn('alice', PASSWORD)
    const resource = await access.registerResource({
      orgId, type: 'model', externalRef: 'v4', displayName: 'V4',
    })
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Caller' })) as WireRole[]
    const caller = created.find(role => role.name === 'Caller') as WireRole
    await access.grantResource(caller.id as never, resource.id, 'model.invoke')

    const after = payload(await write('POST', `/team/api/roles/${caller.id}/permissions`, held, {
      permissions: [],
    })) as WireRole[]
    expect((after.find(role => role.id === caller.id) as WireRole).grants)
      .toMatchObject([{ scope: 'resource', action: 'model.invoke' }])
  })

  it('refuses a list that is not permission pairs the catalog names', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Viewer' })) as WireRole[]
    const viewer = created.find(role => role.name === 'Viewer') as WireRole
    expect(payload(await write('POST', `/team/api/roles/${viewer.id}/permissions`, held, {
      permissions: 'everything',
    }))).toMatchObject({ reason: 'fields' })
    expect(payload(await write('POST', `/team/api/roles/${viewer.id}/permissions`, held, {
      permissions: ['member|member.invent'],
    }))).toMatchObject({ reason: 'permission' })
  })
})

describe('a role that covers the permission catalog', () => {
  it('is brought up to the catalog the moment it is marked', async () => {
    const held = await signIn('alice', PASSWORD)
    const created = payload(await write('POST', '/team/api/roles', held, { name: 'Owner' })) as WireRole[]
    const owner = created.find(role => role.name === 'Owner') as WireRole
    expect(owner.coversCatalog).toBe(false)

    const marked = payload(await write('PATCH', `/team/api/roles/${owner.id}`, held, {
      coversCatalog: true,
    })) as WireRole[]
    const after = marked.find(role => role.id === owner.id) as WireRole
    expect(after.coversCatalog).toBe(true)
    expect(after.grants.length).toBeGreaterThan(30)
    expect(after.grants.map(grant => grant.action)).toContain('member.delete')
  })

  it('needs grant management, not only the permission to edit a role', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const editor = await access.createRole({ orgId, name: 'role-editor' })
    for (const [type, action] of [
      ['organization', 'organization.admin.access'],
      ['role', 'role.read'], ['role', 'role.update'],
    ] as const) await access.grantType(editor.id, type, action)
    await access.bindUserRole(bob, editor.id)

    const held = await signIn('bob', PASSWORD)
    const renamed = await write('PATCH', `/team/api/roles/${adminRole}`, held, { name: 'renamed' })
    expect(renamed.status).toBe(200)
    const widened = await write('PATCH', `/team/api/roles/${adminRole}`, held, { coversCatalog: true })
    expect(widened.status).toBe(403)
  })
})

describe('starting with a role that covers the catalog', () => {
  it('brings it back up to the catalog, so a new permission is not missing', async () => {
    const owner = await access.createRole({ orgId, name: 'Owner', coversCatalog: true })
    await access.syncCatalogRole(owner.id)
    const [dropped] = (await access.listRoleGrants(owner.id))
      .filter(grant => grant.kind === 'type' && grant.action === 'member.delete')
    await access.revokeGrant(dropped?.id as GrantId)
    expect((await access.listRoleGrants(owner.id)).map(grant => grant.action))
      .not.toContain('member.delete')

    // A restart is what a build carrying a new permission looks like from here.
    await apiFiber.dispose()
    apiFiber = ctx.plugin(api, api.Config({ organizationId: orgId, secureCookie: false } as never))
    await apiFiber.await()
    await settled()

    expect((await access.listRoleGrants(owner.id)).map(grant => grant.action))
      .toContain('member.delete')
    const recorded = (await audit.query({ orgId, action: 'grant.add' })).length
    expect(recorded).toBeGreaterThan(0)

    // A start that finds the role already complete records nothing: nothing
    // about what it admits changed.
    await apiFiber.dispose()
    apiFiber = ctx.plugin(api, api.Config({ organizationId: orgId, secureCookie: false } as never))
    await apiFiber.await()
    await settled()
    expect((await audit.query({ orgId, action: 'grant.add' })).length).toBe(recorded)
  })

  it('leaves a role nobody marked exactly as it is', async () => {
    const reader = await access.createRole({ orgId, name: 'Reader' })
    await apiFiber.dispose()
    apiFiber = ctx.plugin(api, api.Config({ organizationId: orgId, secureCookie: false } as never))
    await apiFiber.await()
    expect(await access.listRoleGrants(reader.id)).toHaveLength(0)
  })
})

describe('administering the knowledge catalog', () => {
  /** One catalog read, projected the way the console receives it. */
  interface WireCatalog {
    source: { health: string; lastFailure?: string }
    knowledgeBases: {
      knowledgeRef: string
      resourceId: string
      displayName: string
      adminEnabled: boolean
      remotePresent: boolean
      effectiveEnabled: boolean
      embeddingModelId: string
      upstreamUpdatedAt?: number
    }[]
  }

  it('answers an empty catalog before anyone synchronizes', async () => {
    const held = await signIn()
    const answer = await send('/team/api/knowledge-bases', { headers: { cookie: held.cookie } })
    expect(answer.status).toBe(200)
    const view = payload(answer) as WireCatalog
    expect(view.knowledgeBases).toEqual([])
    expect(view.source.health).toBe('never-synced')
  })

  it('reports when a knowledge base last changed upstream, and why the last sync failed', async () => {
    // Both are what the console's health banner and rows are made of: an
    // administrator reading "failing" needs the reason, and a row that never
    // says when it last changed cannot be told from one that never changes.
    const held = await signIn()
    source.listing = [{ ...source.listing[0]!, updatedAt: 1_756_745_979_714 }]
    await write('POST', '/team/api/knowledge-bases/sync', held, {})
    source.failure = new Error('the knowledge host is unreachable')
    const failed = await write('POST', '/team/api/knowledge-bases/sync', held, {})
    source.failure = undefined
    const view = payload(failed) as WireCatalog
    expect(view.source).toMatchObject({ health: 'failing' })
    expect(view.source.lastFailure).toBeTypeOf('string')
    // The catalog it already holds survives a failed listing, timestamps and all.
    expect(view.knowledgeBases[0]?.upstreamUpdatedAt).toBe(1_756_745_979_714)
  })

  it('synchronizes, and shows what the catalog now governs', async () => {
    const held = await signIn()
    const synced = await write('POST', '/team/api/knowledge-bases/sync', held, {})
    expect(synced.status).toBe(200)
    const view = payload(synced) as WireCatalog
    expect(view.knowledgeBases).toEqual([expect.objectContaining({
      knowledgeRef: REF_A,
      displayName: '临港知识库',
      adminEnabled: true,
      remotePresent: true,
      effectiveEnabled: true,
      embeddingModelId: 'emb-shared',
    })])
    // No upstream identifier field: the reference is the only knowledge id
    // that leaves this Control Plane.
    expect(Object.keys(view.knowledgeBases[0] ?? {})).not.toContain('upstreamId')
  })

  it('switches one entry off and records it', async () => {
    const held = await signIn()
    await write('POST', '/team/api/knowledge-bases/sync', held, {})
    const patched = await write('PATCH', `/team/api/knowledge-bases/${encodeURIComponent(REF_A)}`, held, { enabled: false })
    expect(patched.status).toBe(200)
    expect((payload(patched) as WireCatalog).knowledgeBases[0]).toMatchObject({
      adminEnabled: false, effectiveEnabled: false,
    })
    expect((await audit.query({ orgId, action: 'resource.disable' }))[0]).toMatchObject({ resourceId: REF_A })

    const restored = await write('PATCH', `/team/api/knowledge-bases/${encodeURIComponent(REF_A)}`, held, { enabled: true })
    expect((payload(restored) as WireCatalog).knowledgeBases[0]).toMatchObject({
      adminEnabled: true, effectiveEnabled: true,
    })
    expect((await audit.query({ orgId, action: 'resource.enable' }))[0]).toMatchObject({ resourceId: REF_A })
  })

  it.each([
    ['a reference the catalog does not hold', 'stub:prod:00000000-0000-0000-0000-000000000000', { enabled: false }, 404],
    ['a reference that is not one', 'not-a-reference', { enabled: false }, 400],
    ['a switch that is not a boolean', REF_A, { enabled: 'off' }, 400],
  ])('refuses %s', async (_label, ref, body, status) => {
    const held = await signIn()
    await write('POST', '/team/api/knowledge-bases/sync', held, {})
    const answer = await write('PATCH', `/team/api/knowledge-bases/${encodeURIComponent(ref)}`, held, body)
    expect(answer.status).toBe(status)
  })

  it('gives a role none, all, or selected knowledge — and nothing else changes', async () => {
    const held = await signIn()
    await write('POST', '/team/api/knowledge-bases/sync', held, {})
    const readers = (await access.createRole({ orgId, name: 'readers' })).id
    await access.grantType(readers, 'model', 'model.invoke')

    const all = await write('POST', `/team/api/roles/${readers}/knowledge-bases`, held, { mode: 'all' })
    expect(all.status).toBe(200)
    const afterAll = await access.listRoleGrants(readers)
    expect(afterAll.filter(grant => grant.action === 'knowledge.search'))
      .toEqual([expect.objectContaining({ kind: 'type', resourceType: 'knowledge_scope' })])

    const resourceId = (await access.listResources(orgId, 'knowledge_scope'))
      .find(resource => resource.externalRef === REF_A)?.id
    const some = await write('POST', `/team/api/roles/${readers}/knowledge-bases`, held, {
      mode: 'selected', knowledgeRefs: [REF_A],
    })
    expect(some.status).toBe(200)
    const afterSome = await access.listRoleGrants(readers)
    expect(afterSome.filter(grant => grant.action === 'knowledge.search'))
      .toEqual([expect.objectContaining({ kind: 'resource', resourceId })])

    const none = await write('POST', `/team/api/roles/${readers}/knowledge-bases`, held, { mode: 'none' })
    expect(none.status).toBe(200)
    const afterNone = await access.listRoleGrants(readers)
    expect(afterNone.filter(grant => grant.action === 'knowledge.search')).toEqual([])
    // The unrelated model grant survived every one of those replacements.
    expect(afterNone.some(grant => grant.action === 'model.invoke')).toBe(true)
  })

  it('refuses to grant search on the catalog administration resource', async () => {
    const held = await signIn()
    await write('POST', '/team/api/knowledge-bases/sync', held, {})
    const readers = (await access.createRole({ orgId, name: 'readers' })).id
    // It is a knowledge_scope resource, so it would pass a naive membership
    // check against listResources; the durable catalog is what decides.
    const answer = await write('POST', `/team/api/roles/${readers}/knowledge-bases`, held, {
      mode: 'selected', knowledgeRefs: ['urn:dsh:admin:knowledge-catalog'],
    })
    expect(answer.status).toBe(400)
    expect(await access.listRoleGrants(readers)).toEqual([])
  })

  it.each([
    ['no mode', {}],
    ['an unknown mode', { mode: 'everything' }],
    ['a selection that is not a list', { mode: 'selected', knowledgeRefs: 'all of them' }],
    ['a selection holding a non-string', { mode: 'selected', knowledgeRefs: [7] }],
    ['a knowledge base this organization does not govern', { mode: 'selected', knowledgeRefs: ['stub:prod:nope'] }],
  ])('refuses a role knowledge editor sent %s', async (_label, body) => {
    const held = await signIn()
    await write('POST', '/team/api/knowledge-bases/sync', held, {})
    const readers = (await access.createRole({ orgId, name: 'readers' })).id
    const answer = await write('POST', `/team/api/roles/${readers}/knowledge-bases`, held, body)
    expect(answer.status).toBe(400)
  })

  it('refuses a role this organization does not administer', async () => {
    const held = await signIn()
    const elsewhere = (await store.createOrganization('Other')).id
    const outsiders = (await access.createRole({ orgId: elsewhere, name: 'outsiders' })).id
    const answer = await write('POST', `/team/api/roles/${outsiders}/knowledge-bases`, held, { mode: 'all' })
    expect(answer.status).toBe(404)
  })

  it('refuses every knowledge route to a member without the permission', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const console_ = (await access.createRole({ orgId, name: 'console-only' })).id
    await access.grantType(console_, 'organization', 'organization.admin.access')
    await access.bindUserRole(bob, console_)
    const held = await signIn('bob')
    expect((await send('/team/api/knowledge-bases', { headers: { cookie: held.cookie } })).status).toBe(403)
    expect((await write('POST', '/team/api/knowledge-bases/sync', held, {})).status).toBe(403)
    expect((await write('PATCH', `/team/api/knowledge-bases/${encodeURIComponent(REF_A)}`, held, { enabled: false })).status).toBe(403)
  })

  it('projects the knowledge permissions a console member actually holds', async () => {
    const held = await signIn()
    const session = await send('/team/api/session', { headers: { cookie: held.cookie } })
    expect((payload(session) as { permissions: string[] }).permissions)
      .toEqual(expect.arrayContaining([
        'knowledge_scope|knowledge.catalog.read',
        'knowledge_scope|knowledge.catalog.manage',
      ]))
  })
})

describe('a Control Plane whose knowledge arrives late', () => {
  it('governs the catalog whenever the gateway mounts, not only when it beat the console', async () => {
    // The gateway mounts on its own schedule — it waits on a credential and an
    // upstream source — so the console cannot assume it is already there. A
    // one-time look that lost that race left an administrator holding
    // catalog-wide grants over a resource that did not exist: every knowledge
    // control refused, and no grant that could fix it.
    const late = new Context()
    await late.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await late.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await late.plugin(PasswordAccountAuth, {
      minSecretLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
      maxFailedAttempts: 5, lockDurationMs: 60_000, cost: 2, blockSize: 8, parallelization: 1,
    }).await()
    await late.plugin(SqliteAccessControl, { path: ':memory:' }).await()
    await late.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    await late.plugin(SqliteDeviceAuthorization, {
      path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
    }).await()
    await late.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 900_000 }).await()
    await late.plugin(SqliteModelGateway, { path: ':memory:' }).await()
    await late.plugin(SqliteConsoleMenuStore, { path: ':memory:' }).await()

    const lateStore = late.get('accountStore') as AccountStore
    const lateAccess = late.get('accessControl') as AccessControl
    const lateOrg = (await lateStore.createOrganization('Late')).id
    const frank = (await lateStore.createUser({
      orgId: lateOrg, loginName: 'frank', displayName: 'Frank',
    })).id
    await late.accountAuth.setSecret(frank, PASSWORD)
    await late.plugin(api, api.Config({ organizationId: lateOrg, secureCookie: false } as never)).await()
    const role = (await lateAccess.createRole({ orgId: lateOrg, name: 'admin' })).id
    for (const [type, action] of ADMIN_PERMISSIONS) await lateAccess.grantType(role, type, action)
    await lateAccess.bindUserRole(frank, role)
    expect(await lateAccess.listResources(lateOrg, 'knowledge_scope')).toEqual([])

    await late.plugin({
      name: 'late-knowledge-gateway',
      apply: (ctx: Context) => {
        ctx.provide('knowledgeGateway', {
          catalogView: () => Promise.resolve({ source: {}, entries: [] }),
        })
      },
    }).await()
    // Cordis unparks the console's injection on the next tick.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect((await lateAccess.listResources(lateOrg, 'knowledge_scope'))
      .map(resource => resource.externalRef)).toEqual([KNOWLEDGE_CATALOG_RESOURCE])

    // What the administrator sees: the console reports the permission its menu
    // entry is guarded by, so the entry is there to click.
    const lateOrigin = `http://127.0.0.1:${String(late.webServer.port)}`
    const landed = await sendTo(lateOrigin, '/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: lateOrigin },
      body: JSON.stringify({ loginName: 'frank', secret: PASSWORD }),
    })
    expect((payload(landed) as WireSession).permissions).toContain('knowledge_scope|knowledge.catalog.read')
    await late.fiber.dispose()
  })
})

describe('a Control Plane that governs no knowledge', () => {
  it('registers no knowledge resource and answers every knowledge route as absent', async () => {
    // A deployment without knowledge is a complete Control Plane, not a broken
    // one: the API loads, and the routes report that this installation has no
    // such thing rather than that the caller did something wrong.
    const bare = new Context()
    await bare.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await bare.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await bare.plugin(PasswordAccountAuth, {
      minSecretLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
      maxFailedAttempts: 5, lockDurationMs: 60_000, cost: 2, blockSize: 8, parallelization: 1,
    }).await()
    await bare.plugin(SqliteAccessControl, { path: ':memory:' }).await()
    await bare.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    await bare.plugin(SqliteDeviceAuthorization, {
      path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
    }).await()
    await bare.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 900_000 }).await()
    await bare.plugin(SqliteModelGateway, { path: ':memory:' }).await()
    await bare.plugin(SqliteConsoleMenuStore, { path: ':memory:' }).await()

    const bareStore = bare.get('accountStore') as AccountStore
    const bareAccess = bare.get('accessControl') as AccessControl
    const bareOrg = (await bareStore.createOrganization('Sparse')).id
    const dana = (await bareStore.createUser({
      orgId: bareOrg, loginName: 'dana', displayName: 'Dana',
    })).id
    await bare.accountAuth.setSecret(dana, PASSWORD)
    await bare.plugin(api, api.Config({ organizationId: bareOrg, secureCookie: false } as never)).await()
    const role = (await bareAccess.createRole({ orgId: bareOrg, name: 'admin' })).id
    for (const [type, action] of ADMIN_PERMISSIONS) await bareAccess.grantType(role, type, action)
    await bareAccess.bindUserRole(dana, role)

    // Nothing governs a knowledge catalog here, so the menu entry guarding it
    // is unreachable rather than leading to a page that cannot load.
    expect(await bareAccess.listResources(bareOrg, 'knowledge_scope')).toEqual([])

    const bareOrigin = `http://127.0.0.1:${String(bare.webServer.port)}`
    const landed = await sendTo(bareOrigin, '/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: bareOrigin },
      body: JSON.stringify({ loginName: 'dana', secret: PASSWORD }),
    })
    const cookie = (head(landed, 'set-cookie') as string).split(';')[0] as string
    const csrf = (payload(landed) as WireSession).csrf
    const headers = { 'content-type': 'application/json', origin: bareOrigin, cookie, 'x-dsh-csrf': csrf }

    for (const [method, path, body] of [
      ['GET', '/team/api/knowledge-bases', undefined],
      ['POST', '/team/api/knowledge-bases/sync', {}],
      ['PATCH', `/team/api/knowledge-bases/${encodeURIComponent(REF_A)}`, { enabled: false }],
      ['POST', `/team/api/roles/${role}/knowledge-bases`, { mode: 'all' }],
    ] as const) {
      const answer = await sendTo(bareOrigin, path, {
        method,
        headers: method === 'GET' ? { cookie } : headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      expect(answer.status, path).toBe(404)
    }
    await bare.fiber.dispose()
  })
})

describe('knowledge administration refuses what it should', () => {
  it('refuses the role knowledge editor to a member without role.grant.manage', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    await ctx.accountAuth.setSecret(bob, PASSWORD)
    const limited = (await access.createRole({ orgId, name: 'catalog-only' })).id
    await access.grantType(limited, 'organization', 'organization.admin.access')
    await access.grantType(limited, 'knowledge_scope', 'knowledge.catalog.manage')
    await access.bindUserRole(bob, limited)
    const held = await signIn('bob')
    // Curating the catalog and changing another role's grants are different
    // permissions: holding the first admits nothing about the second.
    const answer = await write('POST', `/team/api/roles/${adminRole}/knowledge-bases`, held, { mode: 'all' })
    expect(answer.status).toBe(403)
    expect((await access.listRoleGrants(adminRole)).some(grant => grant.action === 'knowledge.search'))
      .toBe(false)
  })

  it('does not turn an unexpected gateway fault into "no such knowledge base"', async () => {
    const faulty = new Context()
    await faulty.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await faulty.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await faulty.plugin(PasswordAccountAuth, {
      minSecretLength: 8, requiredClasses: ['uppercase', 'lowercase', 'digit'],
      maxFailedAttempts: 5, lockDurationMs: 60_000, cost: 2, blockSize: 8, parallelization: 1,
    }).await()
    await faulty.plugin(SqliteAccessControl, { path: ':memory:' }).await()
    await faulty.plugin(SqliteAudit, { path: ':memory:', maxQueryRows: 100 }).await()
    await faulty.plugin(SqliteDeviceAuthorization, {
      path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
      accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
    }).await()
    await faulty.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 900_000 }).await()
    await faulty.plugin(SqliteModelGateway, { path: ':memory:' }).await()
    await faulty.plugin(SqliteConsoleMenuStore, { path: ':memory:' }).await()
    faulty.provide('knowledgeGateway', {
      catalogView: () => Promise.resolve({ source: {}, entries: [] }),
      setEnabled: () => Promise.reject(new Error('the disk is on fire')),
    })

    const faultyStore = faulty.get('accountStore') as AccountStore
    const faultyAccess = faulty.get('accessControl') as AccessControl
    const faultyOrg = (await faultyStore.createOrganization('Fault')).id
    const erin = (await faultyStore.createUser({
      orgId: faultyOrg, loginName: 'erin', displayName: 'Erin',
    })).id
    await faulty.accountAuth.setSecret(erin, PASSWORD)
    await faulty.plugin(api, api.Config({ organizationId: faultyOrg, secureCookie: false } as never)).await()
    const role = (await faultyAccess.createRole({ orgId: faultyOrg, name: 'admin' })).id
    for (const [type, action] of ADMIN_PERMISSIONS) await faultyAccess.grantType(role, type, action)
    await faultyAccess.bindUserRole(erin, role)

    const faultyOrigin = `http://127.0.0.1:${String(faulty.webServer.port)}`
    const landed = await sendTo(faultyOrigin, '/team/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: faultyOrigin },
      body: JSON.stringify({ loginName: 'erin', secret: PASSWORD }),
    })
    const cookie = (head(landed, 'set-cookie') as string).split(';')[0] as string
    const csrf = (payload(landed) as WireSession).csrf
    const answer = await sendTo(faultyOrigin, `/team/api/knowledge-bases/${encodeURIComponent(REF_A)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: faultyOrigin, cookie, 'x-dsh-csrf': csrf },
      body: JSON.stringify({ enabled: false }),
    })
    // 500, not 404: a fault of this deployment must not read as a member
    // naming something that does not exist.
    expect(answer.status).toBe(500)
    await faulty.fiber.dispose()
  })
})
