/**
 * Device-authorization vocabulary shared by every provider and consumer.
 * @module @deepseek-ai/dsh-device-authorization/types
 */

import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { DeviceId, FamilyId, TransactionId } from './brand.ts'
import type { DEVICE_PLATFORMS } from './vocabulary.ts'

/** The operating system family a Runner reports when it binds. */
export type DevicePlatform = typeof DEVICE_PLATFORMS[number]

/** Whether a device may still obtain credentials. */
export type DeviceStatus = 'active' | 'revoked'

/** How far a transaction has travelled through the binding flow. */
export type TransactionState = 'pending' | 'confirmed' | 'redeemed'

/** One device bound to one account, on one computer. */
export interface Device {
  readonly id: DeviceId
  readonly orgId: OrgId
  /** The account that confirmed the binding. */
  readonly ownerId: UserId
  readonly platform: DevicePlatform
  /** Base64url DER SPKI encoding of the device's Ed25519 public key. */
  readonly publicKey: string
  /** What a person compares between the pairing page and the confirmation page. */
  readonly publicKeyDigest: string
  readonly runnerVersion: string
  readonly status: DeviceStatus
  readonly createdAt: number
  /** When this device last obtained a credential, in epoch milliseconds. */
  readonly lastSeenAt: number
}

/** What a Runner sends to open a binding transaction. */
export interface StartRequest {
  /** Base64url DER SPKI encoding of the freshly generated Ed25519 public key. */
  readonly publicKey: string
  readonly platform: DevicePlatform
  readonly runnerVersion: string
  /** RFC 7636 `S256` challenge for a verifier the Runner keeps until redemption. */
  readonly pkceChallenge: string
  /** The fixed loopback address the Control Plane will send the browser back to. */
  readonly callbackUri: string
  /** The binding protocol version this Runner speaks. */
  readonly protocolVersion: number
}

/** What a Runner gets back, and shows on its local pairing page. */
export interface StartedTransaction {
  readonly transactionId: TransactionId
  /** Displayed locally for the member to compare with the Control Plane page. */
  readonly pairingCode: string
  readonly expiresAt: number
}

/** What the Control Plane confirmation page shows a person before they confirm. */
export interface PendingTransaction {
  readonly transactionId: TransactionId
  readonly platform: DevicePlatform
  readonly runnerVersion: string
  readonly publicKeyDigest: string
  readonly pairingCode: string
  readonly expiresAt: number
}

/** Who approved a transaction, with the authentication event that established it. */
export interface Approval {
  readonly orgId: OrgId
  readonly userId: UserId
  /** Opaque reference to the successful authentication event. */
  readonly authenticationId: string
}

/** The one-time code the Control Plane hands the browser to carry back. */
export interface IssuedCode {
  /** Plaintext, returned once; the store keeps only its hash. */
  readonly code: string
  readonly expiresAt: number
  /** Where the browser is sent, echoed so a caller redirects to the bound address. */
  readonly callbackUri: string
}

/** What a Runner sends to turn an authorization code into a credential. */
export interface RedeemRequest {
  readonly transactionId: TransactionId
  readonly code: string
  /** The verifier whose challenge opened the transaction. */
  readonly pkceVerifier: string
  /** Signature over {@link redeemSigningInput}, proving possession of the device key. */
  readonly deviceSignature: string
  readonly callbackUri: string
  readonly protocolVersion: number
}

/** What a Runner sends to exchange a refresh token for the next one. */
export interface RefreshRequest {
  readonly familyId: FamilyId
  readonly refreshToken: string
  /** Signature over {@link refreshSigningInput}, proving the device still holds its key. */
  readonly deviceSignature: string
}

/** A credential pair: the long-lived family member and the short-lived token. */
export interface IssuedCredential {
  readonly deviceId: DeviceId
  readonly familyId: FamilyId
  /** Plaintext, returned once; the store keeps only its hash. */
  readonly refreshToken: string
  readonly refreshExpiresAt: number
  /** Plaintext, returned once; the store keeps only its hash. */
  readonly accessToken: string
  readonly accessExpiresAt: number
}

/** What an access token stands for, as a gateway reads it. */
export interface AccessTokenClaims {
  readonly orgId: OrgId
  readonly principalId: UserId
  readonly deviceId: DeviceId
  readonly issuedAt: number
  readonly expiresAt: number
}
