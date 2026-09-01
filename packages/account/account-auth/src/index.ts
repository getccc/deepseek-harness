/**
 * The authentication seam: turn a login name and a secret into an account, or
 * into nothing. Which method verifies the secret — a password hash today, an
 * external identity provider later — is the provider's business; the stored
 * accounts, roles, and devices behind {@link AccountStore} do not change with it.
 * @module @deepseek-ai/dsh-account-auth
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'

declare module '@deepseek-ai/cordis' {
  interface Context {
    accountAuth: AccountAuth
  }
}

/**
 * What a sign-in attempt produced.
 *
 * The failure carries no reason on purpose. An unknown login name, a wrong
 * secret, a locked account, and a suspended account are one outcome here, so
 * no caller can accidentally build a probe that tells an attacker which login
 * names exist. Distinguishing them is an audit concern, not a caller's.
 */
export type AuthenticationOutcome =
  | {
    readonly ok: true
    /** The authenticated account. */
    readonly userId: UserId
    /** True while the account still owes its holder a secret of their own. */
    readonly mustChangePassword: boolean
  }
  | { readonly ok: false }

/** The kinds of character a policy can require a secret to contain. */
export const SECRET_CHARACTER_CLASSES = ['uppercase', 'lowercase', 'digit'] as const

/** One kind of character a policy can require. */
export type SecretCharacterClass = typeof SECRET_CHARACTER_CLASSES[number]

/**
 * What a secret must satisfy for {@link AccountAuth.setSecret} to accept it.
 *
 * Published as fields rather than as the sentence {@link WeakSecretError}
 * carries, so a caller can refuse a secret in its own words before sending it.
 * The provider still enforces the policy: a caller is not the authority on it.
 */
export interface SecretPolicy {
  /** Fewest characters `setSecret` accepts. */
  readonly minLength: number
  /** Classes the secret must contain at least one character of, each. */
  readonly requiredClasses: readonly SecretCharacterClass[]
}

/** Raised when a proposed secret does not satisfy the deployment's policy. */
export class WeakSecretError extends Error {
  constructor(readonly requirement: string) {
    super(`the proposed secret does not satisfy the policy: ${requirement}`)
    this.name = 'WeakSecretError'
  }
}

/**
 * Verifies who a member is. A provider mounts this service; consumers inject
 * `accountAuth`.
 */
export abstract class AccountAuth extends Service {
  constructor(ctx: Context) {
    super(ctx, 'accountAuth')
  }

  /**
   * Attempt a sign-in and record its effect on the account's sign-in state.
   *
   * Implementations take the same observable time whether or not the login
   * name exists: a caller that could time the difference could enumerate
   * accounts, which is the same leak the reasonless failure closes.
   * @param orgId - the organization the login name belongs to.
   * @param loginName - the name as typed.
   * @param secret - the secret as typed.
   * @returns the account on success, or a reasonless failure.
   */
  abstract authenticate(orgId: OrgId, loginName: string, secret: string): Promise<AuthenticationOutcome>

  /**
   * Set an account's secret, satisfying whatever the account still owed.
   * @param userId - the account whose secret is set.
   * @param secret - the new secret, in the clear; the provider stores only a derived form.
   * @throws {WeakSecretError} when the secret does not satisfy the deployment's policy.
   */
  abstract setSecret(userId: UserId, secret: string): Promise<void>

  /**
   * The policy {@link AccountAuth.setSecret} applies.
   * @returns what a secret must satisfy for this deployment to accept it.
   */
  abstract secretPolicy(): SecretPolicy
}
