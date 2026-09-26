/**
 * The Runner-facing release route over a real HTTP server, a real device
 * credential, real access control, and a real release store — because what
 * this route decides is who is offered which release, and a staged release
 * reaching everyone is only ruled out against the machinery that grants it.
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
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import TeamReleaseStore from '@deepseek-ai/dsh-team-release'
import * as route from '@deepseek-ai/dsh-team-release-http'
import {
  RELEASE_MANIFEST_PATH, RELEASE_PROTOCOL_VERSION, RELEASE_RESOURCE_TYPE, RELEASE_STAGED_ACTION,
} from '@deepseek-ai/dsh-team-release-http'

let home: string
let cp: Context
let origin: string
let orgId: OrgId
let alice: UserId
let access: AccessControl
let releases: TeamReleaseStore
let accessToken: string

/** One device credential for Alice, as a Runner holds it. */
async function mintAccessToken(): Promise<string> {
  const { generateKeyPairSync, sign } = await import('node:crypto')
  const auth = cp.get('deviceAuthorization') as import('@deepseek-ai/dsh-device-authorization').DeviceAuthorization
  const { newSecret, pkceChallenge, redeemSigningInput } = await import('@deepseek-ai/dsh-device-authorization')
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const verifier = newSecret()
  const started = await auth.start({
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64url'),
    platform: 'darwin',
    runnerVersion: '1.0.0',
    pkceChallenge: pkceChallenge(verifier),
    callbackUri: 'http://127.0.0.1:3090/team/callback',
    protocolVersion: 1,
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

/** Give Alice a role that is offered staged releases. */
async function grantStaged(): Promise<void> {
  const role = await access.createRole({ orgId, name: 'pilot' })
  await access.bindUserRole(alice, role.id)
  await access.grantType(role.id, RELEASE_RESOURCE_TYPE, RELEASE_STAGED_ACTION)
}

/** Publish one release, as the console does with what the release machine signed. */
function publish(version: string, channel: 'staged' | 'general'): void {
  releases.publish(orgId, {
    version,
    manifest: JSON.stringify({
      manifest: { manifestVersion: 1, version, minimumFrom: '1.0.0', publishedAt: 1, artifacts: [] },
      signature: `signature-${version}`,
    }),
    signature: `signature-${version}`,
    channel,
  })
}

/** Ask the route as a Runner does. */
async function ask(token = accessToken, protocolVersion = RELEASE_PROTOCOL_VERSION, method = 'POST') {
  const response = await fetch(`${origin}${RELEASE_MANIFEST_PATH}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...method === 'POST' ? { body: JSON.stringify({ protocolVersion }) } : {},
  })
  return { status: response.status, body: await response.json() as Record<string, unknown> }
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dsh-release-http-'))
  cp = new Context()
  await cp.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  await cp.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await cp.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  await cp.plugin(SqliteDeviceAuthorization, {
    path: ':memory:', transactionTtlMs: 300_000, codeTtlMs: 60_000,
    accessTokenTtlMs: 900_000, refreshTokenTtlMs: 2_592_000_000,
  }).await()
  await cp.plugin(TeamReleaseStore, { path: join(home, 'releases.sqlite') }).await()
  await cp.plugin(route, route.Config({})).await()
  origin = `http://127.0.0.1:${String(cp.webServer.port)}`

  const store = cp.get('accountStore') as AccountStore
  access = cp.get('accessControl') as AccessControl
  releases = cp.get('teamReleases') as TeamReleaseStore
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
  accessToken = await mintAccessToken()
})

afterEach(async () => {
  await cp.fiber.dispose()
  rmSync(home, { recursive: true, force: true })
})

describe('the release a member is offered', () => {
  it('answers the newest general release', async () => {
    publish('1.0.0', 'general')
    publish('1.1.0', 'general')
    const { status, body } = await ask()
    expect(status).toBe(200)
    expect(body).toMatchObject({ signature: 'signature-1.1.0', minimumVersion: null })
    expect((body['manifest'] as { version: string }).version).toBe('1.1.0')
  })

  it('keeps a staged release from a member no role offers it to', async () => {
    publish('1.0.0', 'general')
    publish('1.1.0', 'staged')
    expect((await ask()).body).toMatchObject({ signature: 'signature-1.0.0' })
    await grantStaged()
    expect((await ask()).body).toMatchObject({ signature: 'signature-1.1.0' })
  })

  it('answers the floor this deployment enforces', async () => {
    publish('1.1.0', 'general')
    releases.setFloor(orgId, '1.1.0')
    expect((await ask()).body).toMatchObject({ minimumVersion: '1.1.0' })
  })

  it('answers 404 when nothing is published for this member, with the floor', async () => {
    releases.setFloor(orgId, '1.0.0')
    const { status, body } = await ask()
    expect(status).toBe(404)
    expect(body).toMatchObject({ error: 'no release', minimumVersion: '1.0.0' })
  })

  it('refuses an unknown token, another protocol, and another method', async () => {
    publish('1.0.0', 'general')
    expect((await ask('not-a-token')).status).toBe(401)
    expect((await ask(accessToken, 99)).status).toBe(426)
    expect((await ask(accessToken, RELEASE_PROTOCOL_VERSION, 'GET')).status).toBe(405)
  })

  it('offers nothing from a withdrawn release', async () => {
    publish('1.0.0', 'general')
    publish('1.1.0', 'general')
    releases.withdraw(orgId, '1.1.0')
    expect((await ask()).body).toMatchObject({ signature: 'signature-1.0.0' })
  })
})
