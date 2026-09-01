/**
 * Password authentication over the account store: derive, verify, and enforce
 * the lockout the store's counters feed.
 * @module @deepseek-ai/dsh-account-auth-password
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AccountAuth,
  SECRET_CHARACTER_CLASSES,
  WeakSecretError,
  type AuthenticationOutcome,
  type SecretCharacterClass,
  type SecretPolicy,
} from '@deepseek-ai/dsh-account-auth'
import type { AccountUser, OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import { hashSecret, needsRehash, verifySecret } from './hash.ts'

export { needsRehash, parse, verifySecret } from './hash.ts'

/** Plugin config: the deployment's password policy and derivation cost. */
export interface Config {
  /** Shortest secret accepted by {@link PasswordAccountAuth.setSecret}. */
  minSecretLength: number
  /** Character classes a secret must contain at least one of, each. */
  requiredClasses: SecretCharacterClass[]
  /** Consecutive failures that trigger a lock. */
  maxFailedAttempts: number
  /** How long a lock refuses sign-in, in milliseconds. */
  lockDurationMs: number
  /** scrypt CPU/memory cost, a power of two. */
  cost: number
  /** scrypt block size. */
  blockSize: number
  /** scrypt parallelization. */
  parallelization: number
}

/**
 * A secret no account can hold, derived once per process and used to spend the
 * same work on an unknown login name as on a real one. Without it, a caller
 * could time the difference and learn which login names exist — the same leak
 * the reasonless failure outcome closes.
 */
const ABSENT_ACCOUNT_SECRET = 'dsh-account-auth-password: no such account'

/** What each character class looks for. */
const CLASS_PATTERNS: Record<SecretCharacterClass, RegExp> = {
  uppercase: /\p{Lu}/u,
  lowercase: /\p{Ll}/u,
  digit: /\p{Nd}/u,
}

/** How {@link WeakSecretError} names each class in its English requirement. */
const CLASS_WORDS: Record<SecretCharacterClass, string> = {
  uppercase: 'an uppercase letter',
  lowercase: 'a lowercase letter',
  digit: 'a digit',
}

/**
 * Password authentication. Sign-in state lives in the account store; this
 * provider owns the policy that reads it — how many failures are too many and
 * how long a lock lasts.
 */
export class PasswordAccountAuth extends AccountAuth {
  static inject = ['accountStore']

  static Config: z<Config> = z.object({
    minSecretLength: z.natural().min(1).default(8),
    requiredClasses: z.array(z.union(SECRET_CHARACTER_CLASSES))
      .default([...SECRET_CHARACTER_CLASSES]),
    maxFailedAttempts: z.natural().min(1).default(5),
    lockDurationMs: z.natural().min(1).default(15 * 60 * 1000),
    cost: z.natural().min(2).default(1 << 15),
    blockSize: z.natural().min(1).default(8),
    parallelization: z.natural().min(1).default(1),
  })

  /** Derivation cost applied to new hashes, and the floor an old hash is measured against. */
  private readonly work: { readonly N: number; readonly r: number; readonly p: number }
  /** Derived lazily, then reused: its only purpose is to consume the same time as a real verify. */
  private decoy: Promise<string> | undefined

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.work = { N: config.cost, r: config.blockSize, p: config.parallelization }
  }

  async authenticate(orgId: OrgId, loginName: string, secret: string): Promise<AuthenticationOutcome> {
    const user = await this.ctx.accountStore.findUserByLogin(orgId, loginName)
    if (user === undefined) {
      // Spend the work a real attempt would, then fail: an unknown login name
      // must not answer faster than a wrong secret.
      await verifySecret(secret, await this.decoyHash())
      return { ok: false }
    }
    if (!this.usable(user)) {
      await verifySecret(secret, await this.decoyHash())
      return { ok: false }
    }
    const stored = await this.ctx.accountStore.getPasswordHash(user.id)
    if (stored === undefined) {
      // Issued but never claimed: there is nothing to verify against, and the
      // attempt still costs what a real one costs.
      await verifySecret(secret, await this.decoyHash())
      return { ok: false }
    }
    if (!await verifySecret(secret, stored)) {
      await this.registerFailure(user.id)
      return { ok: false }
    }
    if (needsRehash(stored, this.work)) {
      // Carry the account onto the current cost without asking its holder to
      // do anything; this is also how a future algorithm would arrive.
      await this.ctx.accountStore.setPasswordHash(user.id, await hashSecret(secret, this.work))
    }
    await this.ctx.accountStore.recordSuccessfulLogin(user.id, Date.now())
    return { ok: true, userId: user.id, mustChangePassword: user.mustChangePassword }
  }

  async setSecret(userId: UserId, secret: string): Promise<void> {
    const unmet = this.unmet(secret)
    if (unmet !== undefined) throw new WeakSecretError(unmet)
    await this.ctx.accountStore.setPasswordHash(userId, await hashSecret(secret, this.work))
  }

  secretPolicy(): SecretPolicy {
    return { minLength: this.config.minSecretLength, requiredClasses: this.config.requiredClasses }
  }

  /**
   * What the policy wanted and this secret does not have.
   * @param secret - the proposed secret.
   * @returns the unmet requirement in English, or undefined when the secret satisfies the policy.
   */
  private unmet(secret: string): string | undefined {
    if (secret.length < this.config.minSecretLength) {
      return `at least ${String(this.config.minSecretLength)} characters`
    }
    const missing = this.config.requiredClasses.filter(name => !CLASS_PATTERNS[name].test(secret))
    if (missing.length === 0) return undefined
    return `at least one of each: ${missing.map(name => CLASS_WORDS[name]).join(', ')}`
  }

  /** Whether an account is in a state that could sign in at all. */
  private usable(user: AccountUser): boolean {
    if (user.status !== 'active') return false
    return user.lockedUntil === undefined || user.lockedUntil <= Date.now()
  }

  /** Count one failure, and lock once the deployment's threshold is reached. */
  private async registerFailure(userId: UserId): Promise<void> {
    const failures = await this.ctx.accountStore.recordFailedLogin(userId)
    if (failures >= this.config.maxFailedAttempts) {
      await this.ctx.accountStore.lockUser(userId, Date.now() + this.config.lockDurationMs)
    }
  }

  /** The decoy hash, derived once per process at the current cost. */
  private decoyHash(): Promise<string> {
    this.decoy ??= hashSecret(ABSENT_ACCOUNT_SECRET, this.work)
    return this.decoy
  }
}

export default PasswordAccountAuth
