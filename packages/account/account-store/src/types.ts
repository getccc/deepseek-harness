/**
 * Account vocabulary shared by every store provider and consumer.
 * @module @deepseek-ai/dsh-account-store/types
 */

import type { OrgId, UserId } from './brand.ts'

/**
 * Whether an account may authenticate. A suspended account keeps every record
 * it owns — roles, devices, audit history — and only loses the ability to sign
 * in, so suspension is reversible without reconstructing anything.
 */
export type AccountUserStatus = 'active' | 'suspended'

/** One organization: the tenancy every other record hangs from. */
export interface Organization {
  readonly id: OrgId
  readonly name: string
  /** Monotonic counter every authorization-affecting change increments. */
  readonly policyRevision: bigint
  readonly createdAt: number
}

/**
 * One member account. Identity only: authentication material belongs to the
 * authentication provider, which reaches it through the store's narrow
 * password-hash accessors rather than through this record.
 */
export interface AccountUser {
  readonly id: UserId
  readonly orgId: OrgId
  /** Unique within the organization, compared case-sensitively as stored. */
  readonly loginName: string
  readonly displayName: string
  readonly email: string | undefined
  readonly status: AccountUserStatus
  /** Set when an administrator issued the account and the member has not chosen a password. */
  readonly mustChangePassword: boolean
  /** Consecutive failed sign-in attempts since the last success. */
  readonly failedAttempts: number
  /** Epoch milliseconds until which sign-in is refused, or undefined when not locked. */
  readonly lockedUntil: number | undefined
  readonly lastLoginAt: number | undefined
  readonly createdAt: number
  readonly updatedAt: number
}

/** The fields an administrator supplies when issuing an account. */
export interface CreateAccountUser {
  readonly orgId: OrgId
  readonly loginName: string
  readonly displayName: string
  readonly email?: string
}
