/**
 * Account vocabulary shared by every store provider and consumer.
 * @module @deepseek-ai/dsh-account-store/types
 */

import type { DeptId, OrgId, UserId } from './brand.ts'

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
 * How a member records their gender, when they record one at all.
 *
 * A closed list rather than free text: the value is shown in a directory column
 * and filtered on, and neither use has anything to do with a sentence. An
 * account that has not stated one carries `undefined`, which is not the same as
 * having chosen `unspecified`.
 */
export type MemberGender = 'male' | 'female' | 'unspecified'

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
  /** A contact number as an administrator typed it; the store never parses it. */
  readonly phone: string | undefined
  readonly gender: MemberGender | undefined
  /** The department this account sits in, or undefined while it sits in none. */
  readonly departmentId: DeptId | undefined
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
  readonly phone?: string
  readonly gender?: MemberGender
  readonly departmentId?: DeptId
}

/**
 * The account fields an administrator may change after issuing it.
 *
 * The login name is not among them: it is what a sign-in attempt resolves
 * against and what audit records name, so changing it would rewrite the
 * identity rather than edit the profile. An absent field is left as stored; a
 * field set to `null` is cleared.
 */
export interface UpdateAccountUser {
  readonly displayName?: string
  readonly email?: string | null
  readonly phone?: string | null
  readonly gender?: MemberGender | null
  readonly departmentId?: DeptId | null
}

/**
 * Whether a node of the department tree stands for the whole company or one
 * department inside it. The distinction is the organization chart's own: a
 * company node is the root a department hangs from.
 */
export type DepartmentCategory = 'company' | 'department'

/**
 * Whether a department is in service. A suspended department keeps its members
 * and its place in the tree; it stops being offered as somewhere to put an
 * account.
 */
export type DepartmentStatus = 'active' | 'suspended'

/** One node of an organization's department tree. */
export interface Department {
  readonly id: DeptId
  readonly orgId: OrgId
  /** The department this one sits under, or undefined for a root node. */
  readonly parentId: DeptId | undefined
  readonly name: string
  /** A stable identifier an administrator chooses; unique within the organization. */
  readonly code: string
  readonly category: DepartmentCategory
  /** The account that leads it, when one is named. */
  readonly leaderId: UserId | undefined
  readonly phone: string | undefined
  readonly email: string | undefined
  /** Where it sits among its siblings, ascending; ties fall back to creation order. */
  readonly sortOrder: number
  readonly status: DepartmentStatus
  readonly createdAt: number
}

/** The fields an administrator supplies when creating a department. */
export interface CreateDepartment {
  readonly orgId: OrgId
  readonly name: string
  readonly code: string
  readonly parentId?: DeptId
  readonly category?: DepartmentCategory
  readonly leaderId?: UserId
  readonly phone?: string
  readonly email?: string
  readonly sortOrder?: number
}

/**
 * The department fields an administrator may change.
 *
 * An absent field is left as stored; a field set to `null` is cleared. The
 * parent is not among them: moving a subtree is a different operation from
 * editing a node, and this store does not offer it.
 */
export interface UpdateDepartment {
  readonly name?: string
  readonly code?: string
  readonly category?: DepartmentCategory
  readonly leaderId?: UserId | null
  readonly phone?: string | null
  readonly email?: string | null
  readonly sortOrder?: number
  readonly status?: DepartmentStatus
}

/**
 * One Control Plane browser session, as the store holds it.
 *
 * The token itself is never stored: a caller presents a token, hashes it, and
 * asks the store what that hash stands for. Reading the database therefore
 * yields no usable session.
 */
export interface BrowserSessionRecord {
  readonly userId: UserId
  readonly orgId: OrgId
  /** When the session stops being honoured, in epoch milliseconds. */
  readonly expiresAt: number
  readonly createdAt: number
}
