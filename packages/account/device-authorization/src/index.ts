/**
 * The device-authorization seam: how a member's browser session becomes a
 * long-lived credential on one computer, and nowhere else.
 *
 * A Runner opens a transaction with a public key it just generated; the member
 * compares a pairing code and a key digest between the local page and the
 * Control Plane page; confirming mints a one-time authorization code the
 * browser carries back; the Runner redeems it by proving PKCE possession and
 * signing with the device key. What it gets is a refresh-token family whose
 * reuse revokes the family, and short-lived access tokens.
 * @module @deepseek-ai/dsh-device-authorization
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import type { DeviceId, FamilyId, TransactionId } from './brand.ts'
import type { CREDENTIAL_REFUSALS } from './vocabulary.ts'
import type {
  AccessTokenClaims,
  Approval,
  Device,
  IssuedCode,
  IssuedCredential,
  PendingTransaction,
  RedeemRequest,
  RefreshRequest,
  StartRequest,
  StartedTransaction,
} from './types.ts'

export { DeviceId, FamilyId, TransactionId } from './brand.ts'
export {
  digestPublicKey,
  hashSecret,
  newPairingCode,
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  refreshSigningInput,
  verifyDeviceSignature,
} from './crypto.ts'
export type {
  AccessTokenClaims,
  Approval,
  Device,
  DevicePlatform,
  DeviceStatus,
  IssuedCode,
  IssuedCredential,
  PendingTransaction,
  RedeemRequest,
  RefreshRequest,
  StartRequest,
  StartedTransaction,
  TransactionState,
} from './types.ts'
export { CREDENTIAL_REFUSALS, DEVICE_PLATFORMS } from './vocabulary.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    deviceAuthorization: DeviceAuthorization
  }
}

/** Why a redemption or refresh was refused. */
export type CredentialRefusal = typeof CREDENTIAL_REFUSALS[number]

/**
 * Raised when a code, token, or family cannot be exchanged.
 *
 * One error type carries every refusal so a caller cannot accidentally handle
 * "expired" while letting "reused" fall through as a generic failure.
 */
export class CredentialRefusedError extends Error {
  constructor(readonly reason: CredentialRefusal) {
    super(`credential refused: ${reason}`)
    this.name = 'CredentialRefusedError'
  }
}

/**
 * Raised when a transaction cannot be read or confirmed.
 *
 * A confirmation page reaches this only through a link the member followed, so
 * the reason is safe to show: it tells them to start again rather than leaving
 * them on a page that will not work.
 */
export class TransactionRefusedError extends Error {
  constructor(readonly reason: 'unknown' | 'expired' | 'already-confirmed') {
    super(`transaction refused: ${reason}`)
    this.name = 'TransactionRefusedError'
  }
}

/**
 * Device binding, the credentials it produces, and the device registry it
 * fills. A provider mounts this service; consumers inject `deviceAuthorization`.
 *
 * Nothing here authorizes anything: a credential proves which device and which
 * account a request comes from, and access control decides what that principal
 * may do, against the policy revision current at the time of the request.
 */
export abstract class DeviceAuthorization extends Service {
  constructor(ctx: Context) {
    super(ctx, 'deviceAuthorization')
  }

  /**
   * Open a binding transaction. The request carries no account: a transaction
   * belongs to nobody until a member confirms it from an authenticated session,
   * so an unauthenticated caller learns nothing by opening one.
   * @param request - the device's public key, platform, PKCE challenge, and fixed callback.
   * @returns the transaction id, the pairing code to display locally, and when it lapses.
   */
  abstract start(request: StartRequest): Promise<StartedTransaction>

  /**
   * Read what a confirmation page must show before a person confirms.
   * @param id - the transaction the member's browser was sent to.
   * @returns the device facts and the pairing code to compare against the local page.
   * @throws {TransactionRefusedError} when it is unknown, lapsed, or already confirmed.
   */
  abstract describe(id: TransactionId): Promise<PendingTransaction>

  /**
   * Confirm a transaction, minting the one-time code the browser carries back.
   * @param id - the transaction being confirmed.
   * @param approval - who is confirming, from an authenticated Control Plane session.
   * @returns the plaintext code, its lifetime, and the bound callback address.
   * @throws {TransactionRefusedError} when it is unknown, lapsed, or already confirmed.
   */
  abstract confirm(id: TransactionId, approval: Approval): Promise<IssuedCode>

  /**
   * Turn an authorization code into a device and its first credential. The
   * device row is created here, because until this point no one has proved
   * possession of the private key behind the digest the member compared.
   * @param request - the code, the PKCE verifier, the device signature, and the bound callback and version.
   * @returns the device, its credential family, and the first refresh and access tokens.
   * @throws {CredentialRefusedError} when any bound fact fails to match.
   */
  abstract redeem(request: RedeemRequest): Promise<IssuedCredential>

  /**
   * Exchange a refresh token for the next one and a fresh access token.
   *
   * Presenting a refresh token that was already spent revokes the whole family:
   * either the token leaked or the Runner lost track of it, and both are
   * answered by making every credential in that family useless.
   * @param request - the family, the refresh token, and a device signature over both.
   * @returns the next credential pair.
   * @throws {CredentialRefusedError} when the token is unknown, lapsed, reused, or the device is revoked.
   */
  abstract refresh(request: RefreshRequest): Promise<IssuedCredential>

  /**
   * Resolve an access token to what it stands for.
   * @param token - the plaintext access token a Runner presented.
   * @returns the claims, or undefined when the token is unknown, lapsed, or its device is revoked.
   */
  abstract verifyAccessToken(token: string): Promise<AccessTokenClaims | undefined>

  /**
   * List an organization's devices in binding order.
   * @param orgId - the organization to list.
   * @returns every device the organization holds, revoked ones included.
   */
  abstract listDevices(orgId: OrgId): Promise<Device[]>

  /**
   * Revoke a device and every credential family it holds. Revoking one that is
   * already revoked is not an error: the caller's intent is that it be gone.
   * @param id - the device to revoke.
   */
  abstract revokeDevice(id: DeviceId): Promise<void>

  /**
   * Revoke one credential family, leaving the device able to bind again.
   * @param id - the family to revoke.
   */
  abstract revokeFamily(id: FamilyId): Promise<void>
}
