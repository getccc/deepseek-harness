/**
 * SQLite-backed account store: one database file holding an organization and
 * its member accounts.
 * @module @deepseek-ai/dsh-account-store-sqlite
 */

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AccountStore,
  DuplicateLoginNameError,
  OrgId,
  UnknownAccountUserError,
  UnknownOrganizationError,
  UserId,
  type AccountUser,
  type AccountUserStatus,
  type BrowserSessionRecord,
  type CreateAccountUser,
  type Organization,
} from '@deepseek-ai/dsh-account-store'
import { applySchema, type AccountUserRow, type BrowserSessionRow, type OrganizationRow } from './schema.ts'

export { ACCOUNT_STORE_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from './schema.ts'

/** Plugin config: where the database lives. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
}

/** SQLite's uniqueness failure for the `(org_id, login_name)` index. */
const UNIQUE_VIOLATION = /UNIQUE constraint failed: account_user\.org_id, account_user\.login_name/u

function toOrganization(row: OrganizationRow): Organization {
  return {
    id: OrgId(row.id),
    name: row.name,
    // Stored as a SQLite INTEGER (64-bit) and surfaced as bigint, the type
    // authorization caches key on; the value only ever increments.
    policyRevision: BigInt(row.policy_revision),
    createdAt: row.created_at,
  }
}

function toAccountUser(row: AccountUserRow): AccountUser {
  return {
    id: UserId(row.id),
    orgId: OrgId(row.org_id),
    loginName: row.login_name,
    displayName: row.display_name,
    email: row.email ?? undefined,
    status: row.status as AccountUserStatus,
    mustChangePassword: row.must_change_password !== 0,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until ?? undefined,
    lastLoginAt: row.last_login_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * The account store over one SQLite database. Every write is a single
 * statement, so each is already atomic; nothing here spans two tables.
 */
export class SqliteAccountStore extends AccountStore {
  static Config: z<Config> = z.object({
    path: z.string().required(),
  })

  private db!: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  /** Open and bring the database to the current schema before serving reads. */
  protected async [Service.init](): Promise<void> {
    const db = new DatabaseSync(this.config.path)
    applySchema(db)
    this.db = db
    this.ctx.effect(() => () => { db.close() }, 'account-store-sqlite.close')
    await Promise.resolve()
  }

  createOrganization(name: string): Promise<Organization> {
    const row: OrganizationRow = {
      id: randomUUID(),
      name,
      policy_revision: 0,
      created_at: Date.now(),
    }
    this.db.prepare(
      'INSERT INTO organization (id, name, policy_revision, created_at) VALUES (?, ?, ?, ?)',
    ).run(row.id, row.name, row.policy_revision, row.created_at)
    return Promise.resolve(toOrganization(row))
  }

  getOrganization(id: OrgId): Promise<Organization | undefined> {
    const row = this.db.prepare('SELECT * FROM organization WHERE id = ?').get(id) as
      OrganizationRow | undefined
    return Promise.resolve(row === undefined ? undefined : toOrganization(row))
  }

  bumpPolicyRevision(id: OrgId): Promise<bigint> {
    const row = this.db.prepare(
      'UPDATE organization SET policy_revision = policy_revision + 1 WHERE id = ? RETURNING policy_revision',
    ).get(id) as Pick<OrganizationRow, 'policy_revision'> | undefined
    return row === undefined
      ? Promise.reject(new UnknownOrganizationError(id))
      : Promise.resolve(BigInt(row.policy_revision))
  }

  createUser(input: CreateAccountUser): Promise<AccountUser> {
    const now = Date.now()
    const row: AccountUserRow = {
      id: randomUUID(),
      org_id: input.orgId,
      login_name: input.loginName,
      display_name: input.displayName,
      email: input.email ?? null,
      status: 'active',
      password_hash: null,
      // An administrator issues identity, never a usable secret: the account
      // cannot authenticate until the member sets one.
      must_change_password: 1,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
      created_at: now,
      updated_at: now,
    }
    try {
      this.db.prepare(`INSERT INTO account_user
        (id, org_id, login_name, display_name, email, status, password_hash,
         must_change_password, failed_attempts, locked_until, last_login_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        row.id, row.org_id, row.login_name, row.display_name, row.email, row.status,
        row.password_hash, row.must_change_password, row.failed_attempts,
        row.locked_until, row.last_login_at, row.created_at, row.updated_at,
      )
    } catch (error) {
      /* v8 ignore next -- node:sqlite rejects with Error; the guard is for the type, not a reachable path */
      if (!(error instanceof Error)) return Promise.reject(new Error(String(error)))
      // Only the login-name index becomes a seam error. Anything else — a
      // missing organization, a disk failure — is the backend's own and
      // travels unchanged, so a caller is never told the wrong cause.
      return Promise.reject(UNIQUE_VIOLATION.test(error.message)
        ? new DuplicateLoginNameError(input.orgId, input.loginName)
        : error)
    }
    return Promise.resolve(toAccountUser(row))
  }

  getUser(id: UserId): Promise<AccountUser | undefined> {
    const row = this.db.prepare('SELECT * FROM account_user WHERE id = ?').get(id) as
      AccountUserRow | undefined
    return Promise.resolve(row === undefined ? undefined : toAccountUser(row))
  }

  findUserByLogin(orgId: OrgId, loginName: string): Promise<AccountUser | undefined> {
    const row = this.db.prepare(
      'SELECT * FROM account_user WHERE org_id = ? AND login_name = ?',
    ).get(orgId, loginName) as AccountUserRow | undefined
    return Promise.resolve(row === undefined ? undefined : toAccountUser(row))
  }

  listUsers(orgId: OrgId): Promise<AccountUser[]> {
    const rows = this.db.prepare(
      // Insertion order, not `created_at`: two accounts issued in the same
      // millisecond share a timestamp, and a backward clock step would order
      // them wrongly. SQLite's implicit rowid is monotonic per insert, so it
      // is creation order by construction.
      'SELECT * FROM account_user WHERE org_id = ? ORDER BY rowid',
    ).all(orgId) as unknown as AccountUserRow[]
    return Promise.resolve(rows.map(toAccountUser))
  }

  setUserStatus(id: UserId, status: AccountUserStatus): Promise<void> {
    return this.mutate(id, 'UPDATE account_user SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id])
  }

  getPasswordHash(id: UserId): Promise<string | undefined> {
    const row = this.db.prepare('SELECT password_hash FROM account_user WHERE id = ?').get(id) as
      Pick<AccountUserRow, 'password_hash'> | undefined
    return Promise.resolve(row?.password_hash ?? undefined)
  }

  setPasswordHash(id: UserId, encodedHash: string): Promise<void> {
    return this.mutate(
      id,
      'UPDATE account_user SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?',
      [encodedHash, Date.now(), id],
    )
  }

  recordFailedLogin(id: UserId): Promise<number> {
    const row = this.db.prepare(
      'UPDATE account_user SET failed_attempts = failed_attempts + 1, updated_at = ? WHERE id = ? RETURNING failed_attempts',
    ).get(Date.now(), id) as Pick<AccountUserRow, 'failed_attempts'> | undefined
    return row === undefined
      ? Promise.reject(new UnknownAccountUserError(id))
      : Promise.resolve(row.failed_attempts)
  }

  lockUser(id: UserId, until: number): Promise<void> {
    return this.mutate(
      id,
      'UPDATE account_user SET locked_until = ?, failed_attempts = 0, updated_at = ? WHERE id = ?',
      [until, Date.now(), id],
    )
  }

  recordSuccessfulLogin(id: UserId, at: number): Promise<void> {
    return this.mutate(
      id,
      'UPDATE account_user SET last_login_at = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      [at, Date.now(), id],
    )
  }

  createBrowserSession(userId: UserId, tokenHash: string, expiresAt: number): Promise<void> {
    this.db.prepare(
      'INSERT INTO browser_session (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).run(tokenHash, userId, expiresAt, Date.now())
    return Promise.resolve()
  }

  resolveBrowserSession(tokenHash: string): Promise<BrowserSessionRecord | undefined> {
    const row = this.db.prepare(
      `SELECT s.*, u.org_id AS org_id, u.status AS status FROM browser_session s
         JOIN account_user u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    ).get(tokenHash) as (BrowserSessionRow & { org_id: string; status: string }) | undefined
    if (row === undefined || Date.now() >= row.expires_at) return Promise.resolve(undefined)
    // A suspended account holds no session, so suspending one takes effect on
    // the next request rather than when its sessions happen to lapse.
    if (row.status !== 'active') return Promise.resolve(undefined)
    return Promise.resolve({
      userId: UserId(row.user_id),
      orgId: OrgId(row.org_id),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })
  }

  revokeBrowserSession(tokenHash: string): Promise<void> {
    this.db.prepare('DELETE FROM browser_session WHERE token_hash = ?').run(tokenHash)
    return Promise.resolve()
  }


  /**
   * Run one account update. "Changed nothing" means the account is not there,
   * which is the seam's unknown-account failure — returned as a rejection
   * because every store method's contract is a promise, and a caller's
   * `.catch` cannot see a synchronous throw.
   */
  private mutate(id: UserId, statement: string, params: (string | number)[]): Promise<void> {
    const result = this.db.prepare(statement).run(...params)
    return result.changes === 0
      ? Promise.reject(new UnknownAccountUserError(id))
      : Promise.resolve()
  }
}

export default SqliteAccountStore
