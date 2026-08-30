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

import type { AccountUserStatus } from '@deepseek-ai/dsh-account-store'
import type { RoleKind } from '@deepseek-ai/dsh-access-control'
import type { ModelStatus } from '@deepseek-ai/dsh-model-gateway'

/** The organization one Control Plane serves. */
export interface WireOrganization {
  readonly id: string
  readonly name: string
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
  readonly status: AccountUserStatus
  readonly createdAt: number
  readonly lastLoginAt?: number
  /** Roles from this organization only; a binding to another organization's role is not shown. */
  readonly roles: readonly WireRoleRef[]
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
  readonly resourceDisplayName?: string
}

/** One role and the grants composing it. */
export interface WireRole {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly kind: RoleKind
  readonly grants: readonly WireGrant[]
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
  /** The value every write must echo in the CSRF header. */
  readonly csrf: string
}

/**
 * Why a request was not carried out.
 *
 * `error` is the word the console switches on; `detail` is for a person and is
 * never the only thing that distinguishes two outcomes.
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
  readonly detail?: string
}
