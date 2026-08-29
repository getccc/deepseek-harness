/**
 * Branded device-authorization identities: the types and their brand functions
 * together, so a consumer imports one name for both.
 * @module @deepseek-ai/dsh-device-authorization/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one bound device. */
export type DeviceId = Branded<'DeviceId'>
/** Identifies one device authorization transaction. */
export type TransactionId = Branded<'DeviceTransactionId'>
/** Identifies one refresh-token family, the unit reuse detection revokes. */
export type FamilyId = Branded<'CredentialFamilyId'>

/**
 * Brand a string as a {@link DeviceId}.
 * @param id - the raw device id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function DeviceId(id: string): DeviceId {
  return id as DeviceId
}

/**
 * Brand a string as a {@link TransactionId}.
 * @param id - the raw transaction id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function TransactionId(id: string): TransactionId {
  return id as TransactionId
}

/**
 * Brand a string as a {@link FamilyId}.
 * @param id - the raw family id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function FamilyId(id: string): FamilyId {
  return id as FamilyId
}
