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
export const SCHEMA_VERSION = 1

/** Application id reserved for DeepSeek Harness SQLite account databases. */
export const ACCOUNT_STORE_SQLITE_APPLICATION_ID = 0x44534841

/** One organization row, as SQLite returns it. */
export interface OrganizationRow {
  readonly id: string
  readonly name: string
  readonly policy_revision: number
  readonly created_at: number
}

/** One account row, as SQLite returns it. */
export interface AccountUserRow {
  readonly id: string
  readonly org_id: string
  readonly login_name: string
  readonly display_name: string
  readonly email: string | null
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
CREATE TABLE IF NOT EXISTS organization (
  id              TEXT    PRIMARY KEY,
  name            TEXT    NOT NULL,
  policy_revision INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS account_user (
  id                   TEXT    PRIMARY KEY,
  org_id               TEXT    NOT NULL REFERENCES organization(id),
  login_name           TEXT    NOT NULL,
  display_name         TEXT    NOT NULL,
  email                TEXT,
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
  db.exec(`PRAGMA application_id = ${ACCOUNT_STORE_SQLITE_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/** Read one integer pragma. */
function readPragma(db: DatabaseSync, name: string): number {
  const row = db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined
  const value = row === undefined ? undefined : Object.values(row)[0]
  return typeof value === 'number' ? value : 0
}
