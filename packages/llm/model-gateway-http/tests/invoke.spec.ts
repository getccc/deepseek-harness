/**
 * A company model call, end to end: a Runner transport, a real Control Plane,
 * and a provider that records what actually arrived.
 *
 * The provider is a real HTTP server rather than a mock because the two facts
 * worth proving are about the bytes it receives — that the credential is
 * attached and that the model field is the catalog's — and a mock would only
 * report whatever this test told it to expect.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import SqliteAccessControl from '@deepseek-ai/dsh-access-control-sqlite'
import SqliteQuota from '@deepseek-ai/dsh-quota-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import SqliteModelGateway from '@deepseek-ai/dsh-model-gateway-sqlite'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { AccountStore, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { AccessControl } from '@deepseek-ai/dsh-access-control'
import type { Quota } from '@deepseek-ai/dsh-quota'
import type { ModelGateway } from '@deepseek-ai/dsh-model-gateway'
import * as gatewayHttp from '../src/index.ts'
import { MODEL_CATALOG_PATH, MODEL_INVOKE_PATH } from '../src/protocol.ts'

/** What the fake provider saw. */
interface Seen {
  authorization: string | undefined
  body: Record<string, unknown>
  path: string | undefined
}

let provider: Server
let providerOrigin: string
let providerSeen: Seen[]
let providerAnswer: (res: ServerResponse) => void
let cp: Context
let cpOrigin: string
let home: string
let store: AccountStore
let access: AccessControl
let quota: Quota
let gateway: ModelGateway
let orgId: OrgId
let alice: UserId
let accessToken: string
let silent: Server

const PERIOD = '2026-08'
const CREDENTIAL = credentialRef('COMPANY_DEEPSEEK_KEY')

/** A provider that records each request and answers however a test says. */
async function startProvider(): Promise<string> {
  providerSeen = []
  providerAnswer = (res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 250 } }))
  }
  provider = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      providerSeen.push({
        authorization: req.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
        path: req.url,
      })
      providerAnswer(res)
    })
  })
  provider.listen(0, '127.0.0.1')
  await once(provider, 'listening')
  return `http://127.0.0.1:${String((provider.address() as { port: number }).port)}`
}

/** POST one invocation the way the team transport does. */
async function invoke(body: unknown, token = accessToken): Promise<{ status: number; text: string }> {
  const response = await fetch(`${cpOrigin}${MODEL_INVOKE_PATH}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, text: await response.text() }
}

/** A well-formed invocation, which each test then varies. */
function invocation(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    operation: 'chat.completions',
    modelRef: 'company-v4',
    period: PERIOD,
    inputTokens: 500,
    body: { model: 'whatever-the-runner-wrote', messages: [{ role: 'user', content: 'hi' }] },
    ...patch,
  }
}

beforeEach(async () => {
  // A provider that accepts a connection and never answers, for the timeout.
  silent = createServer(() => { /* deliberately silent */ })
  silent.listen(0, '127.0.0.1')
  await once(silent, 'listening')
  providerOrigin = await startProvider()
  home = await mkdtemp(join(tmpdir(), 'dsh-gateway-http-'))
  cp = new Context()
  await cp.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await cp.plugin(LocalCredentials, { path: join(home, 'credentials.json'), dshHome: home, watch: false }).await()
  await cp.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await cp.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await cp.plugin(SqliteQuota, { path: ':memory:', reservationTtlMs: 300_000 }).await()
  await cp.plugin(SqliteDeviceAuthorization, {
    path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await cp.plugin(SqliteModelGateway, { path: ':memory:' }).await()
  await cp.plugin(gatewayHttp, gatewayHttp.Config({} as never)).await()
  cpOrigin = `http://127.0.0.1:${String(cp.webServer.port)}`

  store = cp.get('accountStore') as AccountStore
  access = cp.get('accessControl') as AccessControl
  quota = cp.get('quota') as Quota
  gateway = cp.get('modelGateway') as ModelGateway
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id

  await cp.credentials.set(CREDENTIAL, 'company-secret-key')
  await gateway.register({
    orgId, modelRef: 'company-v4', displayName: 'Company V4',
    providerRef: 'deepseek', upstreamModel: 'deepseek-chat-20260801',
    endpoint: providerOrigin, credentialRef: CREDENTIAL, maxOutputTokens: 4_000,
    inputModalities: ['text', 'image'],
  })
  const role = (await access.createRole({ orgId, name: 'engineering' })).id
  await access.bindUserRole(alice, role)
  await access.grantType(role, 'model', 'model.invoke')

  // A bound device, so the endpoint has a real token to verify.
  accessToken = await mintAccessToken()
})

/** Bind a device the way the handoff does, and take its access token. */
async function mintAccessToken(): Promise<string> {
  const { generateKeyPairSync, sign } = await import('node:crypto')
  const auth = cp.get('deviceAuthorization') as import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization
  const { newSecret, pkceChallenge, redeemSigningInput } =
    await import('@deepseek-ai/dsh-device-authorization')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  const verifier = newSecret()
  const started = await auth.start({
    publicKey: spki, platform: 'darwin', runnerVersion: '2.4.1',
    pkceChallenge: pkceChallenge(verifier),
    callbackUri: 'http://127.0.0.1:3080/team/callback', protocolVersion: 1,
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
    callbackUri: 'http://127.0.0.1:3080/team/callback',
    protocolVersion: 1,
  })
  return credential.accessToken
}

afterEach(async () => {
  await cp.fiber.dispose()
  provider.close()
  silent.close()
  await rm(home, { recursive: true, force: true })
})

describe('a company model call', () => {
  it('lists only models this device principal may discover', async () => {
    const [role] = await access.listRoles(orgId)
    await access.grantType(role?.id as never, 'model', 'model.discover')

    const response = await fetch(`${cpOrigin}${MODEL_CATALOG_PATH}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    })

    expect(response.status).toBe(200)
    // The modality list rides along: it is how a Runner knows, before sending,
    // whether a message with an image may go to this model.
    expect(await response.json()).toEqual({
      models: [{ modelRef: 'company-v4', displayName: 'Company V4', inputModalities: ['text', 'image'] }],
    })
  })

  it('does not publish the model catalog without a live device credential', async () => {
    const response = await fetch(`${cpOrigin}${MODEL_CATALOG_PATH}`)
    expect(response.status).toBe(401)
  })

  it('attaches the credential the Runner never held, and the model the catalog names', async () => {
    const answered = await invoke(invocation())
    expect(answered.status).toBe(200)
    expect(providerSeen).toHaveLength(1)
    const seen = providerSeen[0] as Seen
    // The credential appears here and nowhere the Runner can reach.
    expect(seen.authorization).toBe('Bearer company-secret-key')
    expect(seen.path).toBe('/v1/chat/completions')
    // The Runner wrote one model in the body and named another to the gateway;
    // the provider sees the one the catalog holds.
    expect(seen.body.model).toBe('deepseek-chat-20260801')
    expect(seen.body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('preserves a provider base URL path prefix', async () => {
    await gateway.register({
      orgId, modelRef: 'company-v4', displayName: 'Company V4',
      providerRef: 'dashscope', upstreamModel: 'qwen-plus',
      endpoint: `${providerOrigin}/compatible-mode/v1`,
      credentialRef: CREDENTIAL, maxOutputTokens: 4_000,
      inputModalities: ['text'],
    })

    expect((await invoke(invocation())).status).toBe(200)
    expect(providerSeen[0]?.path).toBe('/compatible-mode/v1/chat/completions')
  })

  it('settles from what the provider reported', async () => {
    await invoke(invocation())
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({
      settledTokens: 750,
      reservedTokens: 0,
    })
  })

  it('reads usage out of a streamed answer without holding it', async () => {
    providerAnswer = (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n')
      res.write('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n')
      res.write('data: {"choices":[],"usage":{"prompt_tokens":500,"completion_tokens":42}}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    }
    const answered = await invoke(invocation())
    expect(answered.status).toBe(200)
    expect(answered.text).toContain('hello'.slice(0, 2))
    expect(answered.text).toContain('[DONE]')
    expect((await quota.usage(orgId, PERIOD)).settledTokens).toBe(542)
  })

  it('releases the whole claim when the provider refused the request', async () => {
    providerAnswer = (res) => {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad request' } }))
    }
    const answered = await invoke(invocation())
    // The provider's own answer is passed through rather than translated: the
    // adapter that built the request is the one that can read it.
    expect(answered.status).toBe(400)
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({ settledTokens: 0, reservedTokens: 0 })
  })

  it('estimates when a call succeeds but reports nothing', async () => {
    providerAnswer = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [] }))
    }
    await invoke(invocation())
    // A call that produced no usage field may still have produced tokens, so
    // it is charged the ceiling and marked rather than released.
    expect((await quota.usage(orgId, PERIOD)).settledTokens).toBe(4_000)
  })

  it('charges an indeterminate call rather than releasing it', async () => {
    provider.close()
    const answered = await invoke(invocation())
    expect(answered.status).toBe(502)
    // No response at all is not evidence the provider refused.
    expect((await quota.usage(orgId, PERIOD)).settledTokens).toBe(4_000)
  })
})

describe('what the endpoint refuses', () => {
  it('refuses an existing device token as soon as its account is suspended', async () => {
    await store.setUserStatus(alice, 'suspended')

    expect((await invoke(invocation())).status).toBe(403)
    expect(providerSeen).toEqual([])
  })

  it('answers an unknown, lapsed, and revoked token the same way', async () => {
    expect((await invoke(invocation(), 'not-a-token')).status).toBe(401)
    const [device] = await (cp.get('deviceAuthorization') as
      import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization).listDevices(orgId)
    await (cp.get('deviceAuthorization') as
      import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization).revokeDevice(device?.id as never)
    expect((await invoke(invocation())).status).toBe(401)
    expect(providerSeen).toEqual([])
  })

  it('answers a request with no token at all', async () => {
    const response = await fetch(`${cpOrigin}${MODEL_INVOKE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(invocation()),
    })
    expect(response.status).toBe(401)
  })

  it('refuses an operation this build does not carry, before reading anything else', async () => {
    const answered = await invoke(invocation({ operation: 'files.upload' }))
    expect(answered.status).toBe(400)
    expect((JSON.parse(answered.text) as { reason: string }).reason).toBe('unknown-operation')
    expect((await quota.usage(orgId, PERIOD)).reservedTokens).toBe(0)
  })

  it('refuses a body missing what the gateway needs', async () => {
    for (const patch of [
      { modelRef: '' }, { period: 42 }, { inputTokens: 'many' }, { body: 'not an object' },
    ]) {
      const answered = await invoke(invocation(patch))
      expect(answered.status, JSON.stringify(patch)).toBe(400)
      expect((JSON.parse(answered.text) as { reason: string }).reason, JSON.stringify(patch)).toBe('malformed-body')
    }
  })

  it('passes the gateway refusal through as its own word', async () => {
    await gateway.setStatus(orgId, 'company-v4', 'retired')
    const answered = await invoke(invocation())
    expect(answered.status).toBe(403)
    expect((JSON.parse(answered.text) as { reason: string }).reason).toBe('model-retired')
    expect(providerSeen).toEqual([])
  })

  it('answers a method other than POST', async () => {
    expect((await fetch(`${cpOrigin}${MODEL_INVOKE_PATH}`)).status).toBe(405)
  })

  it('refuses a body larger than it reads, and one that is not JSON at all', async () => {
    const small = new Context()
    await small.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    small.provide('modelGateway', { authorize: () => Promise.reject(new Error('unreachable')) })
    small.provide('deviceAuthorization', { verifyAccessToken: () => Promise.resolve({}) })
    small.provide('credentials', { resolve: () => Promise.resolve(undefined) })
    await small.plugin(gatewayHttp, gatewayHttp.Config({ maxRequestBodyBytes: 32 } as never)).await()
    const origin = `http://127.0.0.1:${String(small.webServer.port)}`
    const send = (body: string) => fetch(`${origin}${MODEL_INVOKE_PATH}`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body,
    })
    expect((await send(JSON.stringify({ pad: 'y'.repeat(200) }))).status).toBe(400)
    expect((await send('not json')).status).toBe(400)
    expect((await send('[1,2]')).status).toBe(400)
    await small.fiber.dispose()
  })

  it('carries the optional facts the adapter supplied all the way to the ledger', async () => {
    const answered = await invoke(invocation({ maxOutputTokens: 120, correlationId: 'c-9f2a' }))
    expect(answered.status).toBe(200)
    // A smaller ask is honoured, so the reservation was 500 + 120.
    expect((await quota.usage(orgId, PERIOD)).settledTokens).toBe(620)
  })

  it('says nothing about itself when the gateway fails for a reason that is not a refusal', async () => {
    const broken = new Context()
    await broken.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    broken.provide('modelGateway', { authorize: () => Promise.reject(new Error('the database is on fire')) })
    broken.provide('deviceAuthorization', { verifyAccessToken: () => Promise.resolve({}) })
    broken.provide('credentials', { resolve: () => Promise.resolve(undefined) })
    await broken.plugin(gatewayHttp, gatewayHttp.Config({} as never)).await()
    const response = await fetch(`http://127.0.0.1:${String(broken.webServer.port)}${MODEL_INVOKE_PATH}`, {
      method: 'POST',
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
      body: JSON.stringify(invocation()),
    })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal' })
    await broken.fiber.dispose()
  })

  it('answers a provider that sent no content type, and one that sent no body', async () => {
    providerAnswer = (res) => {
      res.writeHead(204)
      res.end()
    }
    const answered = await invoke(invocation())
    expect(answered.status).toBe(204)
    // No usage in an empty body, so the call is charged its ceiling.
    expect((await quota.usage(orgId, PERIOD)).settledTokens).toBe(4_000)
  })

  it('refuses a request that sent the token header twice', async () => {
    // node:http joins them into one comma-separated string, which is not a
    // bearer token; a request that sent two carries none.
    const response = await fetch(`${cpOrigin}${MODEL_INVOKE_PATH}`, {
      method: 'POST',
      headers: [
        ['authorization', `Bearer ${accessToken}`],
        ['authorization', `Bearer ${accessToken}`],
        ['content-type', 'application/json'],
      ],
      body: JSON.stringify(invocation()),
    })
    expect(response.status).toBe(401)
  })

  it('reports a stored entry whose credential reference is not one at all', async () => {
    // The catalog refuses such an entry now, so the gateway is stubbed to hand
    // one over the way an older build could have left one behind: the
    // endpoint's own guard is what keeps that row from becoming a confusing
    // member-facing failure.
    const legacy = new Context()
    await legacy.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    await legacy.plugin(LocalCredentials, {
      path: join(home, 'legacy-credentials.json'), dshHome: home, watch: false,
    }).await()
    legacy.provide('deviceAuthorization', {
      verifyAccessToken: () => Promise.resolve({ orgId, principalId: alice, deviceId: 'd' }),
    })
    const settled: unknown[] = []
    legacy.provide('modelGateway', {
      authorize: () => Promise.resolve({
        modelRef: 'company-v4',
        endpoint: cpOrigin,
        upstreamModel: 'u',
        // A credential key, not a credential reference: the two address
        // different things, and only the reference resolves.
        credentialRef: 'company/deepseek',
        reservationId: 'r',
        maxOutputTokens: 4_000,
        policyRevision: 1n,
      }),
      settle: (_id: unknown, settlement: unknown) => {
        settled.push(settlement)
        return Promise.resolve()
      },
    })
    await legacy.plugin(gatewayHttp, gatewayHttp.Config({} as never)).await()
    const response = await fetch(
      `http://127.0.0.1:${String(legacy.webServer.port)}${MODEL_INVOKE_PATH}`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
        body: JSON.stringify(invocation()),
      },
    )
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'internal' })
    // Nothing was spent: the request never reached a provider.
    expect(settled).toEqual([{ kind: 'released' }])
    await legacy.fiber.dispose()
  })

  it('gives up on a provider that never answers, and charges the call', async () => {
    const patient = new Context()
    await patient.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
    patient.provide('deviceAuthorization', {
      verifyAccessToken: () => Promise.resolve({ orgId, principalId: alice, deviceId: 'd' }),
    })
    const settled: unknown[] = []
    patient.provide('modelGateway', {
      authorize: () => Promise.resolve({
        modelRef: 'company-v4',
        endpoint: `http://127.0.0.1:${String((silent.address() as { port: number }).port)}`,
        upstreamModel: 'u',
        credentialRef: 'COMPANY_DEEPSEEK_KEY',
        reservationId: 'r',
        maxOutputTokens: 4_000,
        policyRevision: 1n,
      }),
      settle: (_id: unknown, settlement: unknown) => {
        settled.push(settlement)
        return Promise.resolve()
      },
    })
    patient.provide('credentials', { resolve: () => Promise.resolve({ value: 'k', source: 'env' }) })
    await patient.plugin(gatewayHttp, gatewayHttp.Config({ upstreamTimeoutMs: 50 } as never)).await()

    const response = await fetch(
      `http://127.0.0.1:${String(patient.webServer.port)}${MODEL_INVOKE_PATH}`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
        body: JSON.stringify(invocation()),
      },
    )
    expect(response.status).toBe(502)
    // A provider that never answered may still have generated tokens.
    expect(settled).toEqual([{ kind: 'estimated', inputTokens: 0, outputTokens: 4_000 }])
    await patient.fiber.dispose()
  })

  it('reports a catalog entry naming a credential nobody configured as its own problem', async () => {
    await gateway.register({
      orgId, modelRef: 'company-v4', displayName: 'Company V4',
      providerRef: 'deepseek', upstreamModel: 'deepseek-chat-20260801',
      endpoint: cpOrigin, credentialRef: 'COMPANY_MISSING_KEY', maxOutputTokens: 4_000,
      inputModalities: ['text'],
    })
    const answered = await invoke(invocation())
    expect(answered.status).toBe(500)
    expect(JSON.parse(answered.text)).toEqual({ error: 'internal' })
    // Nothing was spent: the request never reached a provider.
    expect(await quota.usage(orgId, PERIOD)).toMatchObject({ settledTokens: 0, reservedTokens: 0 })
  })
})
