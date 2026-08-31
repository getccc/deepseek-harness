/**
 * SQLite-backed device authorization: the binding state machine, the device
 * registry it fills, and refresh-token families that revoke on reuse.
 * @module @deepseek-ai/dsh-device-authorization-sqlite
 */

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  OrgId,
  UserId,
  type OrgId as OrgIdType,
  type UserId as UserIdType,
} from '@deepseek-ai/dsh-account-store'
import {
  CredentialRefusedError,
  DeviceAuthorization,
  DeviceId,
  FamilyId,
  TransactionId,
  TransactionRefusedError,
  digestPublicKey,
  hashSecret,
  newPairingCode,
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  refreshSigningInput,
  verifyDeviceSignature,
  type AccessTokenClaims,
  type Approval,
  type Device,
  type DeviceId as DeviceIdType,
  type DevicePlatform,
  type FamilyId as FamilyIdType,
  type IssuedCode,
  type IssuedCredential,
  type PendingTransaction,
  type RedeemRequest,
  type RefreshRequest,
  type StartRequest,
  type StartedTransaction,
  type TransactionId as TransactionIdType,
} from '@deepseek-ai/dsh-device-authorization'
import {
  applySchema,
  type AccessRow,
  type DeviceRow,
  type FamilyRow,
  type RefreshRow,
  type TransactionRow,
} from './schema.ts'

export { DEVICE_AUTHORIZATION_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from './schema.ts'

/** Plugin config: where the database lives and how long each secret survives. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
  /** How long a member has to compare the pairing code and confirm, in milliseconds. */
  transactionTtlMs: number
  /**
   * How long the browser has to carry the authorization code back, in
   * milliseconds. Capped at 60 seconds: the code travels one redirect, and a
   * longer window buys an attacker time rather than buying a member anything.
   */
  codeTtlMs: number
  /** How long an access token is honoured, in milliseconds. */
  accessTokenTtlMs: number
  /** How long a refresh token may sit unused before the Runner must bind again, in milliseconds. */
  refreshTokenTtlMs: number
}

/** The longest authorization-code lifetime this build accepts, in milliseconds. */
const MAX_CODE_TTL_MS = 60_000

function toDevice(row: DeviceRow): Device {
  return {
    id: DeviceId(row.id),
    orgId: OrgId(row.org_id),
    ownerId: UserId(row.owner_id),
    platform: row.platform as DevicePlatform,
    publicKey: row.public_key,
    publicKeyDigest: row.public_key_digest,
    runnerVersion: row.runner_version,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

/**
 * Device authorization over one SQLite database.
 *
 * A lifetime that has run out is refused rather than renewed, and every
 * one-time value records when it was spent, so a replay is answered by reading
 * a column instead of by inferring anything.
 */
export class SqliteDeviceAuthorization extends DeviceAuthorization {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    transactionTtlMs: z.natural().required(),
    codeTtlMs: z.natural().max(MAX_CODE_TTL_MS).required(),
    accessTokenTtlMs: z.natural().required(),
    refreshTokenTtlMs: z.natural().required(),
  })

  private db!: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  /** Open and bring the database to the current schema. */
  protected async [Service.init](): Promise<void> {
    const db = new DatabaseSync(this.config.path)
    applySchema(db)
    this.db = db
    this.ctx.effect(() => () => { db.close() }, 'device-authorization-sqlite.close')
    await Promise.resolve()
  }

  start(request: StartRequest): Promise<StartedTransaction> {
    const now = Date.now()
    const row = {
      id: randomUUID(),
      pairingCode: newPairingCode(),
      expiresAt: now + this.config.transactionTtlMs,
    }
    this.db.prepare(
      `INSERT INTO device_transaction
         (id, public_key, public_key_digest, platform, runner_version, pkce_challenge,
          callback_uri, protocol_version, pairing_code, created_at, expires_at, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    ).run(
      row.id, request.publicKey, digestPublicKey(request.publicKey), request.platform,
      request.runnerVersion, request.pkceChallenge, request.callbackUri,
      request.protocolVersion, row.pairingCode, now, row.expiresAt,
    )
    return Promise.resolve({
      transactionId: TransactionId(row.id),
      pairingCode: row.pairingCode,
      expiresAt: row.expiresAt,
    })
  }

  describe(id: TransactionIdType): Promise<PendingTransaction> {
    const row = this.pending(id)
    if (row instanceof TransactionRefusedError) return Promise.reject(row)
    return Promise.resolve({
      transactionId: TransactionId(row.id),
      platform: row.platform as DevicePlatform,
      runnerVersion: row.runner_version,
      publicKeyDigest: row.public_key_digest,
      pairingCode: row.pairing_code,
      expiresAt: row.expires_at,
    })
  }

  confirm(id: TransactionIdType, approval: Approval): Promise<IssuedCode> {
    const row = this.pending(id)
    if (row instanceof TransactionRefusedError) return Promise.reject(row)
    const code = newSecret()
    const expiresAt = Date.now() + this.config.codeTtlMs
    this.db.prepare(
      `UPDATE device_transaction
          SET state = 'confirmed', org_id = ?, owner_id = ?, authentication_id = ?,
              code_hash = ?, code_expires_at = ?
        WHERE id = ?`,
    ).run(approval.orgId, approval.userId, approval.authenticationId, hashSecret(code), expiresAt, id)
    return Promise.resolve({ code, expiresAt, callbackUri: row.callback_uri })
  }

  redeem(request: RedeemRequest): Promise<IssuedCredential> {
    const now = Date.now()
    const row = this.db.prepare('SELECT * FROM device_transaction WHERE code_hash = ?')
      .get(hashSecret(request.code)) as TransactionRow | undefined
    // The code is looked up by its own hash, so a code paired with the wrong
    // transaction id is not found at all rather than found and then rejected.
    if (row === undefined || row.id !== request.transactionId) {
      return Promise.reject(new CredentialRefusedError('unknown'))
    }
    if (row.code_consumed_at !== null) return Promise.reject(new CredentialRefusedError('reused'))
    if (now >= (row.code_expires_at as number)) return Promise.reject(new CredentialRefusedError('expired'))
    if (row.callback_uri !== request.callbackUri || row.protocol_version !== request.protocolVersion) {
      return Promise.reject(new CredentialRefusedError('binding-mismatch'))
    }
    if (pkceChallenge(request.pkceVerifier) !== row.pkce_challenge) {
      return Promise.reject(new CredentialRefusedError('pkce-mismatch'))
    }
    const signed = redeemSigningInput(row.id, request.code)
    if (!verifyDeviceSignature(row.public_key, signed, request.deviceSignature)) {
      return Promise.reject(new CredentialRefusedError('signature-mismatch'))
    }
    this.db.prepare("UPDATE device_transaction SET state = 'redeemed', code_consumed_at = ? WHERE id = ?")
      .run(now, row.id)
    const device = this.upsertDevice(row, now)
    return Promise.resolve(this.issue(device, now))
  }

  refresh(request: RefreshRequest): Promise<IssuedCredential> {
    const now = Date.now()
    const token = this.db.prepare('SELECT * FROM refresh_token WHERE token_hash = ?')
      .get(hashSecret(request.refreshToken)) as RefreshRow | undefined
    if (token === undefined || token.family_id !== request.familyId) {
      return Promise.reject(new CredentialRefusedError('unknown'))
    }
    // Every row read below follows a foreign key from a row already in hand, so
    // it exists; the cast states that rather than guarding a path SQLite has
    // already refused to create.
    const family = this.db.prepare('SELECT * FROM credential_family WHERE id = ?')
      .get(token.family_id) as unknown as FamilyRow
    // A token presented twice means it leaked or the Runner lost track of it.
    // Both are answered the same way: every credential in the family dies, so a
    // thief and the rightful holder end up equally unable to continue.
    if (token.consumed_at !== null) {
      this.revoke(FamilyId(family.id), now)
      return Promise.reject(new CredentialRefusedError('reused'))
    }
    // A revoked device has no live family, because revoking one revokes them
    // all, so the family alone answers for the device as well.
    if (family.revoked_at !== null) return Promise.reject(new CredentialRefusedError('revoked'))
    const device = this.db.prepare('SELECT * FROM device WHERE id = ?').get(family.device_id) as unknown as DeviceRow
    if (now >= token.expires_at) return Promise.reject(new CredentialRefusedError('expired'))
    const signed = refreshSigningInput(family.id, request.refreshToken)
    if (!verifyDeviceSignature(device.public_key, signed, request.deviceSignature)) {
      return Promise.reject(new CredentialRefusedError('signature-mismatch'))
    }
    this.db.prepare('UPDATE refresh_token SET consumed_at = ? WHERE id = ?').run(now, token.id)
    this.db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').run(now, device.id)
    return Promise.resolve(this.mint(toDevice(device), FamilyId(family.id), now))
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims | undefined> {
    const row = this.db.prepare('SELECT * FROM access_token WHERE token_hash = ?')
      .get(hashSecret(token)) as AccessRow | undefined
    if (row === undefined || Date.now() >= row.expires_at) return Promise.resolve(undefined)
    const family = this.db.prepare('SELECT * FROM credential_family WHERE id = ?')
      .get(row.family_id) as unknown as FamilyRow
    // As in refresh: a revoked device holds no live family, so this one check
    // covers both.
    if (family.revoked_at !== null) return Promise.resolve(undefined)
    const device = this.db.prepare('SELECT * FROM device WHERE id = ?').get(family.device_id) as unknown as DeviceRow
    return Promise.resolve({
      orgId: OrgId(device.org_id),
      principalId: UserId(device.owner_id),
      deviceId: DeviceId(device.id),
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    })
  }

  listDevices(orgId: OrgIdType): Promise<Device[]> {
    const rows = this.db.prepare('SELECT * FROM device WHERE org_id = ? ORDER BY rowid')
      .all(orgId) as unknown as DeviceRow[]
    return Promise.resolve(rows.map(toDevice))
  }

  /**
   * Revoke a device and every family it holds. The two halves are one
   * operation on purpose: readers check only the family, so a device left
   * revoked with a live family would still be able to obtain tokens.
   */
  revokeDevice(id: DeviceIdType): Promise<void> {
    const now = Date.now()
    this.db.prepare("UPDATE device SET status = 'revoked' WHERE id = ?").run(id)
    this.db.prepare('UPDATE credential_family SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .run(now, id)
    return Promise.resolve()
  }

  revokeUserDevices(orgId: OrgIdType, userId: UserIdType): Promise<void> {
    const now = Date.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(
        `UPDATE credential_family
            SET revoked_at = ?
          WHERE revoked_at IS NULL
            AND device_id IN (SELECT id FROM device WHERE org_id = ? AND owner_id = ?)`,
      ).run(now, orgId, userId)
      this.db.prepare(
        "UPDATE device SET status = 'revoked' WHERE org_id = ? AND owner_id = ?",
      ).run(orgId, userId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return Promise.resolve()
  }

  revokeFamily(id: FamilyIdType): Promise<void> {
    this.revoke(id, Date.now())
    return Promise.resolve()
  }

  /** Read a transaction that may still be confirmed, or the reason it may not. */
  private pending(id: TransactionIdType): TransactionRow | TransactionRefusedError {
    const row = this.db.prepare('SELECT * FROM device_transaction WHERE id = ?')
      .get(id) as TransactionRow | undefined
    if (row === undefined) return new TransactionRefusedError('unknown')
    if (row.state !== 'pending') return new TransactionRefusedError('already-confirmed')
    if (Date.now() >= row.expires_at) return new TransactionRefusedError('expired')
    return row
  }

  /**
   * Record the device this transaction bound. Binding the same key again keeps
   * the device row, because it is the same computer proving the same key: a new
   * row would leave an administrator revoking one of two identities.
   */
  private upsertDevice(row: TransactionRow, now: number): Device {
    // A fresh binding supersedes every credential family previously issued to
    // this physical key. Otherwise signing in as another member would change
    // the principal seen through an older access token that still points at
    // the same mutable device row.
    this.db.prepare(
      `UPDATE credential_family
          SET revoked_at = ?
        WHERE revoked_at IS NULL
          AND device_id IN (SELECT id FROM device WHERE org_id = ? AND public_key = ?)`,
    ).run(now, row.org_id, row.public_key)
    this.db.prepare(
      `INSERT INTO device (id, org_id, owner_id, platform, public_key, public_key_digest,
                           runner_version, status, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
       ON CONFLICT (org_id, public_key) DO UPDATE SET
         owner_id = excluded.owner_id,
         runner_version = excluded.runner_version,
         status = 'active',
         last_seen_at = excluded.last_seen_at`,
    ).run(
      randomUUID(), row.org_id, row.owner_id, row.platform, row.public_key,
      row.public_key_digest, row.runner_version, now, now,
    )
    return toDevice(this.db.prepare('SELECT * FROM device WHERE org_id = ? AND public_key = ?')
      .get(row.org_id, row.public_key) as unknown as DeviceRow)
  }

  /** Open a fresh family for a device and mint its first credential pair. */
  private issue(device: Device, now: number): IssuedCredential {
    const familyId = FamilyId(randomUUID())
    this.db.prepare('INSERT INTO credential_family (id, device_id, created_at) VALUES (?, ?, ?)')
      .run(familyId, device.id, now)
    return this.mint(device, familyId, now)
  }

  /** Write the next refresh and access tokens for one family. */
  private mint(device: Device, familyId: FamilyIdType, now: number): IssuedCredential {
    const refreshToken = newSecret()
    const refreshExpiresAt = now + this.config.refreshTokenTtlMs
    this.db.prepare(
      'INSERT INTO refresh_token (id, family_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), familyId, hashSecret(refreshToken), now, refreshExpiresAt)
    const accessToken = newSecret()
    const accessExpiresAt = now + this.config.accessTokenTtlMs
    this.db.prepare(
      'INSERT INTO access_token (id, family_id, token_hash, issued_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), familyId, hashSecret(accessToken), now, accessExpiresAt)
    return {
      deviceId: device.id,
      familyId,
      refreshToken,
      refreshExpiresAt,
      accessToken,
      accessExpiresAt,
    }
  }

  /** Mark a family revoked, leaving its rows in place for a later reader. */
  private revoke(id: FamilyIdType, now: number): void {
    this.db.prepare('UPDATE credential_family SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(now, id)
  }
}

export default SqliteDeviceAuthorization
