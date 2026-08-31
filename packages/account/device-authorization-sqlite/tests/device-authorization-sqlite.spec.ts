/**
 * The binding flow end to end, and every way it is supposed to refuse.
 *
 * The tests drive a real Ed25519 key pair rather than a stub signer: the whole
 * point of the flow is that only the holder of the private key behind the
 * digest a member compared can finish it, and a stub would prove nothing about
 * that.
 */

import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import {
  CredentialRefusedError,
  TransactionRefusedError,
  digestPublicKey,
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  refreshSigningInput,
  type DeviceAuthorization,
  type IssuedCredential,
  type StartRequest,
  type TransactionId,
} from '@deepseek-ai/dsh-device-authorization'
import SqliteDeviceAuthorization, {
  DEVICE_AUTHORIZATION_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
  type Config,
} from '../src/index.ts'
import { applySchema } from '../src/schema.ts'

const orgId = OrgId('org-1')
const alice = UserId('user-alice')
const CALLBACK = 'http://127.0.0.1:3080/team/callback'
const PROTOCOL = 1

const BASE: Omit<Config, 'path'> = {
  transactionTtlMs: 300_000,
  codeTtlMs: 60_000,
  accessTokenTtlMs: 900_000,
  refreshTokenTtlMs: 2_592_000_000,
}

/** One computer's key pair, as a Runner would generate it at first start. */
function newDeviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  return {
    publicKey: spki,
    signer: (input: string) => sign(null, Buffer.from(input), privateKey).toString('base64url'),
  }
}

let ctx: Context
let auth: DeviceAuthorization
let device: ReturnType<typeof newDeviceKey>
let verifier: string

async function mount(config: Partial<Config> = {}): Promise<DeviceAuthorization> {
  const fiber = new Context()
  await fiber.plugin(SqliteDeviceAuthorization, { path: ':memory:', ...BASE, ...config }).await()
  return fiber.get('deviceAuthorization') as DeviceAuthorization
}

function request(patch: Partial<StartRequest> = {}): StartRequest {
  return {
    publicKey: device.publicKey,
    platform: 'darwin',
    runnerVersion: '2.4.1',
    pkceChallenge: pkceChallenge(verifier),
    callbackUri: CALLBACK,
    protocolVersion: PROTOCOL,
    ...patch,
  }
}

/** Walk the whole flow: start, confirm, redeem. */
async function bind(service = auth): Promise<{ id: TransactionId; credential: IssuedCredential }> {
  const started = await service.start(request())
  const issued = await service.confirm(started.transactionId, {
    orgId, userId: alice, authenticationId: 'session:session-1',
  })
  const credential = await service.redeem({
    transactionId: started.transactionId,
    code: issued.code,
    pkceVerifier: verifier,
    deviceSignature: device.signer(redeemSigningInput(started.transactionId, issued.code)),
    callbackUri: CALLBACK,
    protocolVersion: PROTOCOL,
  })
  return { id: started.transactionId, credential }
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SqliteDeviceAuthorization, { path: ':memory:', ...BASE }).await()
  auth = ctx.get('deviceAuthorization') as DeviceAuthorization
  device = newDeviceKey()
  verifier = newSecret()
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('starting a transaction', () => {
  it('belongs to nobody until someone confirms it', async () => {
    const started = await auth.start(request())
    // Nothing about an account is knowable from an unauthenticated start, so a
    // caller who opens transactions learns only what it already supplied.
    expect(await auth.listDevices(orgId)).toEqual([])
    expect(await auth.describe(started.transactionId)).toMatchObject({
      platform: 'darwin',
      runnerVersion: '2.4.1',
      publicKeyDigest: digestPublicKey(device.publicKey),
      pairingCode: started.pairingCode,
    })
  })

  it('shows a pairing code a person can compare without misreading it', async () => {
    const codes = new Set<string>()
    for (let index = 0; index < 32; index += 1) {
      const started = await auth.start(request())
      expect(started.pairingCode).toMatch(/^[BCDFGHJKMNPQRSTVWXZ23456789]{4}-[BCDFGHJKMNPQRSTVWXZ23456789]{4}$/u)
      codes.add(started.pairingCode)
    }
    expect(codes.size).toBeGreaterThan(24)
  })

  it('publishes the digest of the key, so the member compares the identity being bound', async () => {
    const started = await auth.start(request())
    const shown = await auth.describe(started.transactionId)
    expect(shown.publicKeyDigest).toBe(digestPublicKey(device.publicKey))
    expect(shown.publicKeyDigest).not.toContain(device.publicKey)
  })
})

describe('confirming', () => {
  it('refuses a transaction nobody opened', async () => {
    await expect(auth.describe('missing' as TransactionId)).rejects
      .toMatchObject({ name: 'TransactionRefusedError', reason: 'unknown' })
  })

  it('refuses to confirm the same transaction twice', async () => {
    const started = await auth.start(request())
    await auth.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
    await expect(auth.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' }))
      .rejects.toMatchObject({ reason: 'already-confirmed' })
    await expect(auth.describe(started.transactionId)).rejects.toBeInstanceOf(TransactionRefusedError)
  })

  it('refuses a transaction whose window has closed', async () => {
    const brief = await mount({ transactionTtlMs: 0 })
    const started = await brief.start(request())
    await expect(brief.describe(started.transactionId)).rejects.toMatchObject({ reason: 'expired' })
    await expect(brief.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' }))
      .rejects.toMatchObject({ reason: 'expired' })
  })
})

describe('redeeming', () => {
  it('binds the device only once the private key has been proved', async () => {
    const { credential } = await bind()
    const [bound] = await auth.listDevices(orgId)
    expect(bound).toMatchObject({
      ownerId: alice,
      platform: 'darwin',
      publicKey: device.publicKey,
      status: 'active',
    })
    expect(credential.deviceId).toBe(bound?.id)
    expect(await auth.verifyAccessToken(credential.accessToken))
      .toMatchObject({ orgId, principalId: alice, deviceId: credential.deviceId })
  })

  it('refuses a code that was already spent', async () => {
    const started = await auth.start(request())
    const issued = await auth.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
    const redeem = {
      transactionId: started.transactionId,
      code: issued.code,
      pkceVerifier: verifier,
      deviceSignature: device.signer(redeemSigningInput(started.transactionId, issued.code)),
      callbackUri: CALLBACK,
      protocolVersion: PROTOCOL,
    }
    await auth.redeem(redeem)
    await expect(auth.redeem(redeem)).rejects.toMatchObject({ reason: 'reused' })
    expect(await auth.listDevices(orgId)).toHaveLength(1)
  })

  it('refuses a code presented without the verifier that opened the transaction', async () => {
    const started = await auth.start(request())
    const issued = await auth.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
    await expect(auth.redeem({
      transactionId: started.transactionId,
      code: issued.code,
      pkceVerifier: newSecret(),
      deviceSignature: device.signer(redeemSigningInput(started.transactionId, issued.code)),
      callbackUri: CALLBACK,
      protocolVersion: PROTOCOL,
    })).rejects.toMatchObject({ reason: 'pkce-mismatch' })
    expect(await auth.listDevices(orgId)).toEqual([])
  })

  it('refuses a code signed by a different key than the one the member compared', async () => {
    const started = await auth.start(request())
    const issued = await auth.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
    const impostor = newDeviceKey()
    await expect(auth.redeem({
      transactionId: started.transactionId,
      code: issued.code,
      pkceVerifier: verifier,
      deviceSignature: impostor.signer(redeemSigningInput(started.transactionId, issued.code)),
      callbackUri: CALLBACK,
      protocolVersion: PROTOCOL,
    })).rejects.toMatchObject({ reason: 'signature-mismatch' })
  })

  it('refuses a signature made over a different transaction', async () => {
    const first = await auth.start(request())
    const second = await auth.start(request())
    const issued = await auth.confirm(second.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
    await expect(auth.redeem({
      transactionId: second.transactionId,
      code: issued.code,
      pkceVerifier: verifier,
      deviceSignature: device.signer(redeemSigningInput(first.transactionId, issued.code)),
      callbackUri: CALLBACK,
      protocolVersion: PROTOCOL,
    })).rejects.toMatchObject({ reason: 'signature-mismatch' })
  })

  it('refuses a callback address or protocol version other than the bound one', async () => {
    for (const patch of [{ callbackUri: 'http://127.0.0.1:9999/team/callback' }, { protocolVersion: 2 }]) {
      const started = await auth.start(request())
      const issued = await auth.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
      await expect(auth.redeem({
        transactionId: started.transactionId,
        code: issued.code,
        pkceVerifier: verifier,
        deviceSignature: device.signer(redeemSigningInput(started.transactionId, issued.code)),
        callbackUri: CALLBACK,
        protocolVersion: PROTOCOL,
        ...patch,
      })).rejects.toMatchObject({ reason: 'binding-mismatch' })
    }
  })

  it('refuses a code that outlived its window', async () => {
    const brief = await mount({ codeTtlMs: 0 })
    const started = await brief.start(request())
    const issued = await brief.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
    await expect(brief.redeem({
      transactionId: started.transactionId,
      code: issued.code,
      pkceVerifier: verifier,
      deviceSignature: device.signer(redeemSigningInput(started.transactionId, issued.code)),
      callbackUri: CALLBACK,
      protocolVersion: PROTOCOL,
    })).rejects.toMatchObject({ reason: 'expired' })
  })

  it('refuses a code paired with a transaction it does not belong to', async () => {
    const other = await auth.start(request())
    const started = await auth.start(request())
    const issued = await auth.confirm(started.transactionId, { orgId, userId: alice, authenticationId: 'session:s' })
    await expect(auth.redeem({
      transactionId: other.transactionId,
      code: issued.code,
      pkceVerifier: verifier,
      deviceSignature: device.signer(redeemSigningInput(other.transactionId, issued.code)),
      callbackUri: CALLBACK,
      protocolVersion: PROTOCOL,
    })).rejects.toMatchObject({ reason: 'unknown' })
  })

  it('refuses a code nobody issued', async () => {
    const started = await auth.start(request())
    await expect(auth.redeem({
      transactionId: started.transactionId,
      code: newSecret(),
      pkceVerifier: verifier,
      deviceSignature: 'x',
      callbackUri: CALLBACK,
      protocolVersion: PROTOCOL,
    })).rejects.toMatchObject({ reason: 'unknown' })
  })

  it('keeps one device row when the same computer binds again', async () => {
    const first = await bind()
    verifier = newSecret()
    const second = await bind()
    expect(await auth.listDevices(orgId)).toHaveLength(1)
    expect(second.credential.deviceId).toBe(first.credential.deviceId)
    // Rebinding opens a fresh family; the previous one is not implicitly closed,
    // because the member may still be working in the earlier session.
    expect(second.credential.familyId).not.toBe(first.credential.familyId)
  })
})

describe('refreshing', () => {
  it('rotates the refresh token and keeps the family', async () => {
    const { credential } = await bind()
    const next = await auth.refresh({
      familyId: credential.familyId,
      refreshToken: credential.refreshToken,
      deviceSignature: device.signer(refreshSigningInput(credential.familyId, credential.refreshToken)),
    })
    expect(next.familyId).toBe(credential.familyId)
    expect(next.refreshToken).not.toBe(credential.refreshToken)
    expect(await auth.verifyAccessToken(next.accessToken)).toMatchObject({ deviceId: credential.deviceId })
  })

  it('revokes the whole family when a spent refresh token comes back', async () => {
    const { credential } = await bind()
    const exchange = {
      familyId: credential.familyId,
      refreshToken: credential.refreshToken,
      deviceSignature: device.signer(refreshSigningInput(credential.familyId, credential.refreshToken)),
    }
    const next = await auth.refresh(exchange)
    await expect(auth.refresh(exchange)).rejects.toMatchObject({ reason: 'reused' })
    // The rightful holder loses the family too: a replay means either the token
    // leaked or the Runner lost track of it, and neither can be told apart.
    await expect(auth.refresh({
      familyId: next.familyId,
      refreshToken: next.refreshToken,
      deviceSignature: device.signer(refreshSigningInput(next.familyId, next.refreshToken)),
    })).rejects.toMatchObject({ reason: 'revoked' })
    expect(await auth.verifyAccessToken(next.accessToken)).toBeUndefined()
  })

  it('refuses a token that outlived its window', async () => {
    const brief = await mount({ refreshTokenTtlMs: 0 })
    const { credential } = await bind(brief)
    await expect(brief.refresh({
      familyId: credential.familyId,
      refreshToken: credential.refreshToken,
      deviceSignature: device.signer(refreshSigningInput(credential.familyId, credential.refreshToken)),
    })).rejects.toMatchObject({ reason: 'expired' })
  })

  it('refuses a token the caller pairs with the wrong family, and one nobody issued', async () => {
    const { credential } = await bind()
    await expect(auth.refresh({
      familyId: 'other-family' as typeof credential.familyId,
      refreshToken: credential.refreshToken,
      deviceSignature: 'x',
    })).rejects.toMatchObject({ reason: 'unknown' })
    await expect(auth.refresh({
      familyId: credential.familyId,
      refreshToken: newSecret(),
      deviceSignature: 'x',
    })).rejects.toMatchObject({ reason: 'unknown' })
  })

  it('refuses a refresh signed by another key', async () => {
    const { credential } = await bind()
    const impostor = newDeviceKey()
    await expect(auth.refresh({
      familyId: credential.familyId,
      refreshToken: credential.refreshToken,
      deviceSignature: impostor.signer(refreshSigningInput(credential.familyId, credential.refreshToken)),
    })).rejects.toBeInstanceOf(CredentialRefusedError)
  })

  it('refuses a malformed signature without crashing', async () => {
    const { credential } = await bind()
    await expect(auth.refresh({
      familyId: credential.familyId,
      refreshToken: credential.refreshToken,
      deviceSignature: 'not-a-signature',
    })).rejects.toMatchObject({ reason: 'signature-mismatch' })
  })
})

describe('revoking', () => {
  it('ends every credential the device holds', async () => {
    const { credential } = await bind()
    await auth.revokeDevice(credential.deviceId)
    expect(await auth.verifyAccessToken(credential.accessToken)).toBeUndefined()
    await expect(auth.refresh({
      familyId: credential.familyId,
      refreshToken: credential.refreshToken,
      deviceSignature: device.signer(refreshSigningInput(credential.familyId, credential.refreshToken)),
    })).rejects.toMatchObject({ reason: 'revoked' })
    expect((await auth.listDevices(orgId))[0]).toMatchObject({ status: 'revoked' })
  })

  it('accepts revoking a device twice, and one nothing bound', async () => {
    const { credential } = await bind()
    await expect(auth.revokeDevice(credential.deviceId)).resolves.toBeUndefined()
    await expect(auth.revokeDevice(credential.deviceId)).resolves.toBeUndefined()
    await expect(auth.revokeDevice('missing' as typeof credential.deviceId)).resolves.toBeUndefined()
  })

  it('leaves no family alive behind a revoked device, including one from an earlier binding', async () => {
    const first = await bind()
    verifier = newSecret()
    const second = await bind()
    expect(second.credential.familyId).not.toBe(first.credential.familyId)
    await auth.revokeDevice(second.credential.deviceId)
    // Readers check the family and not the device, so revoking a device has to
    // reach every family it ever opened, not only the current one.
    for (const credential of [first.credential, second.credential]) {
      await expect(auth.refresh({
        familyId: credential.familyId,
        refreshToken: credential.refreshToken,
        deviceSignature: device.signer(refreshSigningInput(credential.familyId, credential.refreshToken)),
      })).rejects.toMatchObject({ reason: 'revoked' })
      expect(await auth.verifyAccessToken(credential.accessToken)).toBeUndefined()
    }
  })

  it('ends one family without touching the device', async () => {
    const { credential } = await bind()
    await auth.revokeFamily(credential.familyId)
    expect(await auth.verifyAccessToken(credential.accessToken)).toBeUndefined()
    expect((await auth.listDevices(orgId))[0]).toMatchObject({ status: 'active' })
  })

  it('reports an access token that nobody issued or that has lapsed as no token at all', async () => {
    const brief = await mount({ accessTokenTtlMs: 0 })
    const { credential } = await bind(brief)
    expect(await brief.verifyAccessToken(credential.accessToken)).toBeUndefined()
    expect(await auth.verifyAccessToken(newSecret())).toBeUndefined()
  })
})

describe('opening a database', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-device-'))
    path = join(dir, 'device.sqlite')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('stamps the application id and schema version', () => {
    const db = new DatabaseSync(path)
    applySchema(db)
    expect((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id)
      .toBe(DEVICE_AUTHORIZATION_SQLITE_APPLICATION_ID)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('refuses a file another application owns', () => {
    const db = new DatabaseSync(path)
    db.exec('PRAGMA application_id = 12345')
    expect(() => { applySchema(db) }).toThrow(/another application/u)
    db.close()
  })

  it('refuses a database written with any other released schema', () => {
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${DEVICE_AUTHORIZATION_SQLITE_APPLICATION_ID}`)
    db.exec('PRAGMA user_version = 1')
    expect(() => { applySchema(db) }).toThrow(/not supported by this build/u)
    db.close()
  })

  it('refuses a confirmed transaction that names no account', () => {
    const db = new DatabaseSync(path)
    applySchema(db)
    // The CHECK ties the state to the account columns, so a caller that reached
    // the database directly cannot leave a confirmed transaction anonymous.
    expect(() => db.prepare(
      `INSERT INTO device_transaction
         (id, public_key, public_key_digest, platform, runner_version, pkce_challenge,
          callback_uri, protocol_version, pairing_code, created_at, expires_at, state)
       VALUES ('t', 'k', 'd', 'darwin', '1', 'c', ?, 1, 'AAAA-BBBB', 0, 0, 'confirmed')`,
    ).run(CALLBACK)).toThrow(/CHECK/u)
    db.close()
  })
})
