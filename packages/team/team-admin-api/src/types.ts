/**
 * What the administration console receives over the wire.
 *
 * These are the browser's view of records the Control Plane's services own,
 * narrowed on the way out: an account's failed-attempt count and lock deadline
 * are the authentication provider's business, not an administrator's table,
 * and a `bigint` policy revision is sent as a decimal string because JSON has
 * no such number.
 * @module @deepseek-ai/dsh-team-admin-api/types
 */

import type { SecretCharacterClass } from '@deepseek-ai/dsh-account-auth'

export type { SecretCharacterClass } from '@deepseek-ai/dsh-account-auth'
import type {
  AccountUserStatus,
  DepartmentCategory,
  DepartmentStatus,
  MemberGender,
} from '@deepseek-ai/dsh-account-store'
import type { RoleKind } from '@deepseek-ai/dsh-access-control'
import type { ConsoleMenuKind, ConsoleMenuStatus } from '@deepseek-ai/dsh-team-console-menu'
import type { ModelStatus } from '@deepseek-ai/dsh-model-gateway'

/**
 * The organization one Control Plane serves, and the company row at the root
 * of its department tree.
 */
export interface WireOrganization {
  readonly id: string
  readonly name: string
  readonly code?: string
  readonly leaderId?: string
  /** That account's display name, so the row needs no second request to show it. */
  readonly leaderName?: string
  readonly phone?: string
  readonly email?: string
  /** Decimal string: the counter is a `bigint`, and JSON has no such number. */
  readonly policyRevision: string
  readonly createdAt: number
}

/** A role as it is named against a member, without its grants. */
export interface WireRoleRef {
  readonly id: string
  readonly name: string
}

/** One member of the organization, with the roles this console could unbind. */
export interface WireMember {
  readonly id: string
  readonly loginName: string
  readonly displayName: string
  readonly email?: string
  readonly phone?: string
  readonly gender?: MemberGender
  readonly status: AccountUserStatus
  /** The department this account sits in, absent while it sits in none. */
  readonly departmentId?: string
  /** That department's name, so a table row needs no second request to show it. */
  readonly departmentName?: string
  readonly createdAt: number
  readonly lastLoginAt?: number
  /** Roles from this organization only; a binding to another organization's role is not shown. */
  readonly roles: readonly WireRoleRef[]
}

/**
 * One department, with the two facts about its people a directory row shows.
 *
 * `leaderName` and `memberNames` are resolved here rather than left to the
 * console, because a member who may read the organization chart does not
 * necessarily hold `member.read`, and a column of raw account ids is not a
 * column anyone can read.
 */
export interface WireDepartment {
  readonly id: string
  readonly parentId?: string
  readonly name: string
  readonly code: string
  readonly category: DepartmentCategory
  readonly leaderId?: string
  readonly leaderName?: string
  readonly phone?: string
  readonly email?: string
  readonly sortOrder: number
  readonly status: DepartmentStatus
  readonly createdAt: number
  readonly memberCount: number
  /** Display names of the accounts in it, in the order the store lists them. */
  readonly memberNames: readonly string[]
}

/**
 * One navigation entry.
 *
 * `labelKey` is the console's own copy key for an entry this build ships;
 * `shipped` says whether the product put the entry there, which is what the
 * console uses to explain that deleting it only lasts until the next start.
 */
export interface WireMenu {
  readonly id: string
  readonly parentId?: string
  readonly name: string
  readonly labelKey?: string
  readonly kind: ConsoleMenuKind
  readonly routePath?: string
  readonly componentPath?: string
  /** The permission it needs, as `resourceType|action`, when it needs one. */
  readonly permission?: string
  readonly icon?: string
  readonly sortOrder: number
  readonly status: ConsoleMenuStatus
  readonly visible: boolean
  readonly shipped: boolean
  readonly createdAt: number
}

/**
 * One grant inside a role.
 *
 * `scope` says what the grant covers: `type` admits every resource of the type,
 * `resource` admits the one named, and only that second kind carries a display
 * name to show it by.
 */
export interface WireGrant {
  readonly id: string
  readonly scope: 'type' | 'resource'
  readonly resourceType: string
  readonly action: string
  readonly resourceId?: string
  readonly resourceDisplayName?: string
}

/** One role and the grants composing it. */
export interface WireRole {
  readonly id: string
  readonly name: string
  /** The stable identifier a deployment's own configuration names it by. */
  readonly code: string
  readonly description: string
  readonly kind: RoleKind
  /**
   * Whether the role holds every permission this build governs, and is brought
   * up to the catalog as the Control Plane starts.
   */
  readonly coversCatalog: boolean
  /** Absent for a role stored by a build that did not record the moment. */
  readonly createdAt?: number
  readonly grants: readonly WireGrant[]
  readonly memberCount: number
  /** Display names of the accounts holding it, in the order the store lists them. */
  readonly memberNames: readonly string[]
}

/** One computer bound to a member's account. */
export interface WireDevice {
  readonly id: string
  readonly ownerId: string
  readonly platform: string
  readonly runnerVersion: string
  /** What a member compares between the pairing page and the confirmation page. */
  readonly publicKeyDigest: string
  readonly status: string
  readonly createdAt: number
  readonly lastSeenAt: number
}

/** One company model, as the catalog holds it. */
export interface WireModel {
  /** Access-control resource id used when a role is granted this exact model. */
  readonly resourceId: string
  readonly modelRef: string
  readonly displayName: string
  readonly providerRef: string
  readonly upstreamModel: string
  readonly endpoint: string
  /** A credential reference, never secret material. */
  readonly credentialRef: string
  readonly maxOutputTokens: number
  readonly status: ModelStatus
}

/** One `(resourceType, action)` pair a grant may name. */
export interface WirePermission {
  readonly resourceType: string
  readonly action: string
}

/** Counts on the overview. */
export interface WireOverview {
  readonly members: number
  readonly activeMembers: number
  readonly roles: number
  readonly devices: number
  readonly activeDevices: number
  readonly models: number
  readonly activeModels: number
}

/**
 * Who is signed in, and what this console may offer them.
 *
 * `permissions` lets the console leave out a control nobody could use; it is
 * not what enforces anything. Every route asks access control again, so a
 * console that showed a button it should not have still gets a refusal.
 */
export interface WireSession {
  readonly member: {
    readonly id: string
    readonly loginName: string
    readonly displayName: string
  }
  readonly organization: WireOrganization
  /** Held permissions as `resourceType|action`, for hiding controls only. */
  readonly permissions: readonly string[]
  /** What a password this console sets must satisfy, for checking a form as it is typed. */
  readonly secretPolicy: WireSecretPolicy
  /** The value every write must echo in the CSRF header. */
  readonly csrf: string
}

/**
 * The deployment's password policy, as the console receives it.
 *
 * The console checks a new password against this before sending it, so an
 * administrator reads what is wanted in their own language beside the box
 * rather than a refusal after the fact. The Control Plane still enforces it.
 */
export interface WireSecretPolicy {
  /** Fewest characters a password may have. */
  readonly minLength: number
  /** Character classes the password must contain at least one of, each. */
  readonly requiredClasses: readonly SecretCharacterClass[]
}

/**
 * What a request was refused for, when the console can say something better
 * than "that was malformed".
 *
 * A closed vocabulary rather than a sentence, because the console renders in
 * more than one language and the copy a member reads has to be the console's
 * own. `detail` says the same thing in English for a caller that is not the
 * console — a script, a log, a person reading a response body.
 */
export type WireRefusalReason =
  /** The request body was not a JSON object. */
  | 'body'
  /** A field the route cannot proceed without was absent or empty. */
  | 'fields'
  /** Another account in this organization already has that login name. */
  | 'login-taken'
  /** The password does not satisfy this deployment's password policy. */
  | 'weak-secret'
  /** Another record in this organization already has that code. */
  | 'code-taken'
  /** Another role in this organization already has that name. */
  | 'name-taken'
  /** Departments or accounts still hang from the department that was to be deleted. */
  | 'department-not-empty'
  /** Entries still sit under the navigation entry that was to be deleted. */
  | 'menu-not-empty'
  /** The role ships with the product and cannot be deleted. */
  | 'system-role'
  /** The request would delete the account it was made from. */
  | 'self-delete'
  /** Departments do not have the status that was asked for. */
  | 'department-status'
  /** Navigation entries do not have the status that was asked for. */
  | 'menu-status'
  /** The request named a navigation entry kind this build does not have. */
  | 'menu-kind'
  /** The request named a gender this build does not record. */
  | 'gender'
  /** Accounts do not have the status that was asked for. */
  | 'member-status'
  /** The catalog does not name that `(resourceType, action)` pair. */
  | 'permission'
  /** The provider endpoint was not an absolute URL. */
  | 'endpoint'
  /** The endpoint was not HTTPS, or the token ceiling was not a positive whole number. */
  | 'endpoint-security'
  /** The credential field held something that is not a credential reference. */
  | 'credential'
  /** The catalog does not have the model status that was asked for. */
  | 'model-status'

/**
 * Why a request was not carried out.
 *
 * `error` is the word the console switches on, `reason` narrows it where the
 * console has its own copy for the case, and `detail` is the English sentence
 * for a caller that is not the console. None of the three is ever the only
 * thing that distinguishes two outcomes.
 */
export interface WireRefusal {
  readonly error:
    | 'unauthenticated'
    | 'forbidden'
    | 'malformed'
    | 'conflict'
    | 'not-found'
    | 'too-large'
    | 'unavailable'
  readonly reason?: WireRefusalReason
  readonly detail?: string
}
