/**
 * The account store seam: durable organizations and member accounts, behind one
 * backend-neutral service. The store keeps identity and sign-in state; it never
 * interprets authentication material, decides an authorization outcome, or
 * enforces a lockout policy — those belong to the authentication provider and
 * the access-control service, which read and write through it.
 * @module @deepseek-ai/dsh-account-store
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from './brand.ts'

export { OrgId, UserId } from './brand.ts'
export type {
  AccountUser,
  AccountUserStatus,
  CreateAccountUser,
  Organization,
} from './types.ts'

import type {
  AccountUser,
  AccountUserStatus,
  CreateAccountUser,
  Organization,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    accountStore: AccountStore
  }
}

/** Raised when a login name is already taken inside its organization. */
export class DuplicateLoginNameError extends Error {
  constructor(readonly orgId: OrgId, readonly loginName: string) {
    super(`login name ${JSON.stringify(loginName)} already exists in organization ${orgId}`)
    this.name = 'DuplicateLoginNameError'
  }
}

/** Raised when an operation names an organization the store does not hold. */
export class UnknownOrganizationError extends Error {
  constructor(readonly orgId: OrgId) {
    super(`unknown organization ${orgId}`)
    this.name = 'UnknownOrganizationError'
  }
}

/** Raised when an operation names an account the store does not hold. */
export class UnknownAccountUserError extends Error {
  constructor(readonly userId: UserId) {
    super(`unknown account user ${userId}`)
    this.name = 'UnknownAccountUserError'
  }
}

/**
 * Durable organizations and member accounts. Every method is a repository
 * operation: it stores or returns records and reports conflicts, and it makes
 * no policy decision of its own. A provider mounts this service; consumers
 * inject `accountStore`.
 */
export abstract class AccountStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'accountStore')
  }

  /**
   * Create the organization every other record hangs from.
   * @param name - human-readable organization name.
   * @returns the stored organization, at policy revision zero.
   */
  abstract createOrganization(name: string): Promise<Organization>

  /**
   * Read one organization.
   * @param id - the organization to read.
   * @returns the organization, or undefined when the store holds none.
   */
  abstract getOrganization(id: OrgId): Promise<Organization | undefined>

  /**
   * Advance an organization's policy revision, the value authorization caches
   * are keyed by. Callers increment it in the same transaction as the change
   * that invalidated them.
   * @param id - the organization whose revision advances.
   * @returns the revision after the increment.
   * @throws {UnknownOrganizationError} when the store holds no such organization.
   */
  abstract bumpPolicyRevision(id: OrgId): Promise<bigint>

  /**
   * Issue an account. The account starts active, with no password material and
   * `mustChangePassword` set, so an administrator cannot create a usable
   * account without the member choosing their own secret.
   * @param input - the identity fields an administrator supplies.
   * @returns the stored account.
   * @throws {DuplicateLoginNameError} when the login name is taken in that organization.
   */
  abstract createUser(input: CreateAccountUser): Promise<AccountUser>

  /**
   * Read one account by id.
   * @param id - the account to read.
   * @returns the account, or undefined when the store holds none.
   */
  abstract getUser(id: UserId): Promise<AccountUser | undefined>

  /**
   * Resolve a sign-in attempt's login name to an account.
   * @param orgId - the organization the login name belongs to.
   * @param loginName - the name as typed, compared exactly.
   * @returns the account, or undefined when no account carries that name.
   */
  abstract findUserByLogin(orgId: OrgId, loginName: string): Promise<AccountUser | undefined>

  /**
   * List an organization's accounts in creation order, oldest first.
   * @param orgId - the organization to list.
   * @returns every account the organization holds.
   */
  abstract listUsers(orgId: OrgId): Promise<AccountUser[]>

  /**
   * Set whether an account may authenticate.
   * @param id - the account to change.
   * @param status - the status to store.
   * @throws {UnknownAccountUserError} when the store holds no such account.
   */
  abstract setUserStatus(id: UserId, status: AccountUserStatus): Promise<void>

  /**
   * Read the authentication material an account carries, if any.
   *
   * Only the authentication provider calls this. The store treats the value as
   * opaque bytes: it never parses, compares, or derives anything from it, which
   * is what lets a different authentication provider replace the format without
   * touching stored identity.
   * @param id - the account whose material is read.
   * @returns the stored encoded hash, or undefined when the account has none.
   */
  abstract getPasswordHash(id: UserId): Promise<string | undefined>

  /**
   * Store the authentication material for an account and clear
   * `mustChangePassword`, because choosing a secret is what satisfies it.
   * @param id - the account to change.
   * @param encodedHash - the provider's own encoded hash, stored verbatim.
   * @throws {UnknownAccountUserError} when the store holds no such account.
   */
  abstract setPasswordHash(id: UserId, encodedHash: string): Promise<void>

  /**
   * Record one failed sign-in and return the resulting consecutive count. The
   * store counts; the authentication provider decides what a count means.
   * @param id - the account that failed to sign in.
   * @returns consecutive failures including this one.
   * @throws {UnknownAccountUserError} when the store holds no such account.
   */
  abstract recordFailedLogin(id: UserId): Promise<number>

  /**
   * Refuse sign-in until a moment in time, and reset the failure count so the
   * next lockout needs a fresh run of failures.
   * @param id - the account to lock.
   * @param until - epoch milliseconds after which sign-in may be attempted again.
   * @throws {UnknownAccountUserError} when the store holds no such account.
   */
  abstract lockUser(id: UserId, until: number): Promise<void>

  /**
   * Record a successful sign-in: clear the failure count and any lock, and
   * stamp the moment.
   * @param id - the account that signed in.
   * @param at - epoch milliseconds of the sign-in.
   * @throws {UnknownAccountUserError} when the store holds no such account.
   */
  abstract recordSuccessfulLogin(id: UserId, at: number): Promise<void>
}
