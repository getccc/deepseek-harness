/**
 * What this computer keeps, and what it does with it.
 *
 * The client is exercised against a real Control Plane composition rather than
 * a stubbed one: the calls it makes are only correct if the other side accepts
 * them, and the signatures it produces are only correct if a key it generated
 * itself verifies against a digest the Control Plane stored.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { DeviceAuthorization } from '@deepseek-ai/dsh-device-authorization'
import * as endpoints from '@deepseek-ai/dsh-team-control-plane-http'
import TeamAccountClient, { ControlPlaneRefusedError, NotBoundError, platformWord, type Config } from '../src/index.ts'
import { DEVICE_KEY_RECORD, TEAM_CREDENTIAL_RECORD } from '../src/storage.ts'

let cp: Context
let runner: Context
let home: string
let client: TeamAccountClient
let auth: DeviceAuthorization
let orgId: OrgId
let alice: UserId

const CALLBACK = 'http://127.0.0.1:3080/team/callback'

/** Boot a Control Plane with the Runner-facing endpoints, on an OS-assigned port. */
async function bootControlPlane(codeTtlMs = 60_000, accessTokenTtlMs = 900_000): Promise<Context> {
  const context = new Context()
  await context.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await context.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await context.plugin(SqliteDeviceAuthorization, {
    path: ':memory:',
    transactionTtlMs: 300_000,
    codeTtlMs,
    accessTokenTtlMs,
    refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await context.plugin(endpoints, endpoints.Config({} as never)).await()
  return context
}

/** Boot a Runner holding its own credential store. */
async function bootRunner(controlPlane: Context, config: Partial<Config> = {}): Promise<Context> {
  const context = new Context()
  await context.plugin(LocalCredentials, {
    path: join(home, 'credentials.json'),
    dshHome: home,
    watch: false,
  }).await()
  await context.plugin(TeamAccountClient, {
    controlPlaneUrl: `http://127.0.0.1:${String(controlPlane.webServer.port)}`,
    callbackUri: CALLBACK,
    runnerVersion: '2.4.1',
    refreshLeadMs: 60_000,
    ...config,
  }).await()
  return context
}

/** Walk a whole binding, standing in for the member's confirmation. */
async function bind(): Promise<void> {
  const handle = await client.begin()
  const transactionId = new URL(handle.confirmUrl).pathname.split('/').pop() as string
  const issued = await auth.confirm(transactionId as never, {
    orgId, userId: alice, browserSessionId: 'browser-session',
  })
  await client.complete(transactionId as never, issued.code)
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'dsh-account-client-'))
  cp = await bootControlPlane()
  runner = await bootRunner(cp)
  client = runner.get('teamAccountClient') as TeamAccountClient
  auth = cp.get('deviceAuthorization') as DeviceAuthorization
  const store = cp.get('accountStore') as AccountStore
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
})

afterEach(async () => {
  await runner.fiber.dispose()
  await cp.fiber.dispose()
  await rm(home, { recursive: true, force: true })
})

describe('binding', () => {
  it('starts unbound, and knows it', async () => {
    expect(await client.state()).toEqual({ bound: false })
    await expect(client.accessToken()).rejects.toBeInstanceOf(NotBoundError)
  })

  it('completes a binding the Control Plane accepts', async () => {
    await bind()
    const state = await client.state()
    expect(state.bound).toBe(true)
    const [device] = await auth.listDevices(orgId)
    expect(state.deviceId).toBe(device?.id)
    expect(device).toMatchObject({ ownerId: alice, runnerVersion: '2.4.1' })
  })

  it('signs with a key it generated and never sent', async () => {
    await bind()
    const [device] = await auth.listDevices(orgId)
    const record = await runner.credentials.readRecord(DEVICE_KEY_RECORD)
    expect(record?.kind).toBe('grant')
    const payload = (record as { payload: { publicKey: string; privateKey: string } }).payload
    // The Control Plane holds the public half and nothing else; the private half
    // exists only in this computer's credential store.
    expect(device?.publicKey).toBe(payload.publicKey)
    expect(JSON.stringify(device)).not.toContain(payload.privateKey)
  })

  it('keeps the same device key across a restart', async () => {
    await bind()
    const first = await auth.listDevices(orgId)
    await runner.fiber.dispose()
    runner = await bootRunner(cp)
    client = runner.get('teamAccountClient') as TeamAccountClient
    await bind()
    const second = await auth.listDevices(orgId)
    expect(second).toHaveLength(1)
    expect(second[0]?.id).toBe(first[0]?.id)
  })

  it('refuses to complete a binding this process did not begin', async () => {
    await expect(client.complete('some-transaction' as never, 'a-code'))
      .rejects.toBeInstanceOf(NotBoundError)
  })

  it('reports the Control Plane refusal word rather than a message', async () => {
    const handle = await client.begin()
    const transactionId = new URL(handle.confirmUrl).pathname.split('/').pop() as string
    await auth.confirm(transactionId as never, { orgId, userId: alice, browserSessionId: 's' })
    await expect(client.complete(transactionId as never, 'a-code-nobody-issued'))
      .rejects.toMatchObject({ name: 'ControlPlaneRefusedError', reason: 'unknown', status: 403 })
  })
})

describe('holding the credential', () => {
  it('serves the stored access token while it has time left', async () => {
    await bind()
    const first = await client.accessToken()
    expect(await client.accessToken()).toBe(first)
    expect(await auth.verifyAccessToken(first)).toMatchObject({ orgId, principalId: alice })
  })

  it('refreshes before the token can lose its own race', async () => {
    // A lead longer than the token's life means every read refreshes, which is
    // what a Runner does when it wakes to a token about to lapse.
    runner = await bootRunner(cp, { refreshLeadMs: 3_600_000 })
    client = runner.get('teamAccountClient') as TeamAccountClient
    await bind()
    const first = await client.accessToken()
    const second = await client.accessToken()
    expect(second).not.toBe(first)
    expect(await auth.verifyAccessToken(second)).toMatchObject({ orgId })
  })

  it('reports a revoked device as a refusal, not as a token', async () => {
    runner = await bootRunner(cp, { refreshLeadMs: 3_600_000 })
    client = runner.get('teamAccountClient') as TeamAccountClient
    await bind()
    const [device] = await auth.listDevices(orgId)
    await auth.revokeDevice(device?.id as never)
    await expect(client.accessToken()).rejects.toMatchObject({ reason: 'revoked' })
  })

  it('forgets the credential on sign-out and keeps the device key', async () => {
    await bind()
    await client.signOut()
    expect(await client.state()).toEqual({ bound: false })
    await expect(client.accessToken()).rejects.toBeInstanceOf(NotBoundError)
    expect(await runner.credentials.readRecord(TEAM_CREDENTIAL_RECORD)).toBeUndefined()
    // The computer is still the same computer: binding again reuses its key.
    expect(await runner.credentials.readRecord(DEVICE_KEY_RECORD)).toBeDefined()
  })
})

describe('the platform it reports', () => {
  it('names the three families the device word list governs', () => {
    expect(platformWord('darwin')).toBe('darwin')
    expect(platformWord('win32')).toBe('win32')
    expect(platformWord('linux')).toBe('linux')
    // A Runner on anything else reports as the family nearest to it, because an
    // administrator reads this next to a device rather than switching on it.
    expect(platformWord('freebsd')).toBe('linux')
  })
})

describe('a store someone edited by hand', () => {
  it('reads a record of another kind at the credential key as not bound', async () => {
    await bind()
    await runner.credentials.modifyRecord(TEAM_CREDENTIAL_RECORD, () =>
      Promise.resolve({ kind: 'api-key', key: 'someone-put-this-here' }))
    expect(await client.state()).toEqual({ bound: false })
    await expect(client.accessToken()).rejects.toBeInstanceOf(NotBoundError)
  })
})

describe('a refusal this Runner cannot read', () => {
  it('reports it as unknown rather than inventing a reason', async () => {
    const bare = new Context()
    await bare.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    bare.webServer.register({
      kind: 'prefix',
      path: '/team/device',
      handler: (_req, res) => {
        res.writeHead(503, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ retryAfter: 30 }))
      },
    })
    const lonely = await bootRunner(bare)
    await expect((lonely.get('teamAccountClient') as TeamAccountClient).begin())
      .rejects.toMatchObject({ reason: 'unknown', status: 503 })
    await expect((lonely.get('teamAccountClient') as TeamAccountClient).begin())
      .rejects.toBeInstanceOf(ControlPlaneRefusedError)
    await lonely.fiber.dispose()
    await bare.fiber.dispose()
  })
})
