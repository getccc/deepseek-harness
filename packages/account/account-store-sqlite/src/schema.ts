/**
 * SQLite schema ownership for the account store.
 * @module @deepseek-ai/dsh-account-store-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'

/**
 * Current physical schema. Monotonic: a database written by a newer build is
 * refused rather than migrated down, because a downgrade cannot know what a
 * column it has never seen means.
 */
export const SCHEMA_VERSION = 3

/** Application id reserved for DeepSeek Harness SQLite account databases. */
export const ACCOUNT_STORE_SQLITE_APPLICATION_ID = 0x44534841

/** One organization row, as SQLite returns it. */
export interface OrganizationRow {
  readonly id: string
  readonly name: string
  readonly policy_revision: number
  readonly created_at: number
}

/** One browser-session row, as SQLite returns it. */
export interface BrowserSessionRow {
  readonly token_hash: string
  readonly user_id: string
  readonly expires_at: number
  readonly created_at: number
}

/** One department row, as SQLite returns it. */
export interface DepartmentRow {
  readonly id: string
  readonly org_id: string
  readonly parent_id: string | null
  readonly name: string
  readonly code: string
  readonly category: string
  readonly leader_id: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly sort_order: number
  readonly status: string
  readonly created_at: number
}

/** One account row, as SQLite returns it. */
export interface AccountUserRow {
  readonly id: string
  readonly org_id: string
  readonly login_name: string
  readonly display_name: string
  readonly email: string | null
  readonly phone: string | null
  readonly gender: string | null
  readonly department_id: string | null
  readonly status: string
  readonly password_hash: string | null
  readonly must_change_password: number
  readonly failed_attempts: number
  readonly locked_until: number | null
  readonly last_login_at: number | null
  readonly created_at: number
  readonly updated_at: number
}

const DDL = `
-- Sessions are keyed by the hash of the token a browser carries, so the store
-- never holds a value anyone could present. The organization is read through
-- the account rather than copied here: moving an account between organizations
-- must not leave a session naming the old one.
CREATE TABLE IF NOT EXISTS browser_session (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES account_user(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS browser_session_user ON browser_session (user_id);
CREATE TABLE IF NOT EXISTS organization (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  policy_revision INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
) STRICT;

-- The organization chart. A node's parent is another department in the same
-- organization, and a root node has none; the leader is an account rather than
-- a typed-in name, so a member who leaves takes the leadership row with them.
CREATE TABLE IF NOT EXISTS department (
  id         TEXT    PRIMARY KEY,
  org_id     TEXT    NOT NULL REFERENCES organization(id),
  parent_id  TEXT    REFERENCES department(id),
  name       TEXT    NOT NULL,
  code       TEXT    NOT NULL,
  category   TEXT    NOT NULL,
  leader_id  TEXT    REFERENCES account_user(id),
  phone      TEXT,
  email      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
-- Codes are unique per organization for the same reason login names are: the
-- code is what an administrator types to mean one department.
CREATE UNIQUE INDEX IF NOT EXISTS department_code ON department (org_id, code);
CREATE INDEX IF NOT EXISTS department_parent ON department (parent_id);

CREATE TABLE IF NOT EXISTS account_user (
  id                   TEXT    PRIMARY KEY,
  org_id               TEXT    NOT NULL REFERENCES organization(id),
  login_name           TEXT    NOT NULL,
  display_name         TEXT    NOT NULL,
  email                TEXT,
  phone                TEXT,
  gender               TEXT,
  department_id        TEXT    REFERENCES department(id),
  status               TEXT    NOT NULL,
  password_hash        TEXT,
  must_change_password INTEGER NOT NULL,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         INTEGER,
  last_login_at        INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
) STRICT;

-- Login names are unique per organization, not globally: two organizations may
-- each have an "alice", and the uniqueness that matters is what a sign-in
-- attempt resolves against.
CREATE UNIQUE INDEX IF NOT EXISTS account_user_login
  ON account_user (org_id, login_name);
`

/**
 * Account columns a build newer than schema 2 introduced.
 *
 * `CREATE TABLE IF NOT EXISTS` leaves an existing table exactly as an earlier
 * build wrote it, so a column added to the DDL never reaches a database that
 * already has the table. Each of these is nullable and carries no default,
 * which is what SQLite requires of an added column that references another
 * table.
 */
const ADDED_ACCOUNT_USER_COLUMNS: readonly (readonly [string, string])[] = [
  ['phone', 'TEXT'],
  ['gender', 'TEXT'],
  ['department_id', 'TEXT REFERENCES department(id)'],
]

/**
 * Bring a connection to {@link SCHEMA_VERSION}, refusing a database written by
 * a build that knew more than this one.
 * @param db - an open SQLite connection.
 * @throws when the file belongs to another application or a newer schema.
 */
export function applySchema(db: DatabaseSync): void {
  const appId = readPragma(db, 'application_id')
  const version = readPragma(db, 'user_version')
  if (appId !== 0 && appId !== ACCOUNT_STORE_SQLITE_APPLICATION_ID) {
    throw new Error(`account-store-sqlite: database belongs to another application (application_id ${appId})`)
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`account-store-sqlite: database schema ${version} is newer than this build's ${SCHEMA_VERSION}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)
  addMissingColumns(db, 'account_user', ADDED_ACCOUNT_USER_COLUMNS)
  db.exec(`PRAGMA application_id = ${ACCOUNT_STORE_SQLITE_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/**
 * Add the columns of {@link ADDED_ACCOUNT_USER_COLUMNS} that a table does not
 * already have.
 *
 * The forward direction only: this build adds what it knows about and never
 * drops what it does not, so a database an older build reopens keeps every row
 * it could already read.
 */
function addMissingColumns(
  db: DatabaseSync,
  table: string,
  columns: readonly (readonly [string, string])[],
): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]
  const present = new Set(rows.map(row => row.name))
  for (const [name, definition] of columns) {
    if (!present.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)
  }
}

/**
 * Read one integer pragma. A PRAGMA read of `application_id` or `user_version`
 * always answers with exactly one row holding one integer, so the cast states
 * what SQLite guarantees rather than guarding a path that cannot happen.
 */
function readPragma(db: DatabaseSync, name: string): number {
  const [value] = Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)
  return value as number
}
