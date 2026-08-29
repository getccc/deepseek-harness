/**
 * What the Runner keeps about its team account.
 * @module @deepseek-ai/dsh-team-account-client/types
 */

import type { DeviceId, FamilyId, TransactionId } from '@deepseek-ai/dsh-device-authorization'

/** What the local pairing page shows while a member confirms on the Control Plane. */
export interface BindingHandle {
  readonly transactionId: TransactionId
  /** Displayed locally for the member to compare with the Control Plane page. */
  readonly pairingCode: string
  readonly expiresAt: number
  /** Where the member's browser goes to confirm this transaction. */
  readonly confirmUrl: string
}

/** The credential this installation holds, as it is written to local storage. */
export interface StoredCredential {
  readonly deviceId: DeviceId
  readonly familyId: FamilyId
  readonly refreshToken: string
  readonly refreshExpiresAt: number
  readonly accessToken: string
  readonly accessExpiresAt: number
}

/** Whether this computer is bound, and to what. */
export interface TeamAccountState {
  readonly bound: boolean
  readonly deviceId?: DeviceId
  readonly familyId?: FamilyId
}
