/**
 * SQLite schema ownership for device authorization.
 *
 * Every secret is stored as a hash and every one-time value carries the column
 * that records it was spent, so replay is a lookup rather than a judgement.
 * @module @deepseek-ai/dsh-device-authorization-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { DEVICE_PLATFORMS } from '@deepseek-ai/dsh-device-authorization'

/**
 * Current physical schema. Monotonic: a database written by a newer build is
 * refused rather than migrated down.
 */
export const SCHEMA_VERSION = 2

/** Application id reserved for DeepSeek Harness SQLite device-authorization databases. */
export const DEVICE_AUTHORIZATION_SQLITE_APPLICATION_ID = 0x44534841 + 3

/** One device row, as SQLite returns it. */
export interface DeviceRow {
  readonly id: string
  readonly org_id: string
  readonly owner_id: string
  readonly platform: string
  readonly public_key: string
  readonly public_key_digest: string
  readonly runner_version: string
  readonly status: string
  readonly created_at: number
  readonly last_seen_at: number
}

/** One transaction row, as SQLite returns it. */
export interface TransactionRow {
  readonly id: string
  readonly public_key: string
  readonly public_key_digest: string
  readonly platform: string
  readonly runner_version: string
  readonly pkce_challenge: string
  readonly callback_uri: string
  readonly protocol_version: number
  readonly pairing_code: string
  readonly created_at: number
  readonly expires_at: number
  readonly state: string
  readonly org_id: string | null
  readonly owner_id: string | null
  readonly authentication_id: string | null
  readonly code_hash: string | null
  readonly code_expires_at: number | null
  readonly code_consumed_at: number | null
}

/** One credential-family row, as SQLite returns it. */
export interface FamilyRow {
  readonly id: string
  readonly device_id: string
  readonly created_at: number
  readonly revoked_at: number | null
}

/** One refresh-token row, as SQLite returns it. */
export interface RefreshRow {
  readonly id: string
  readonly family_id: string
  readonly token_hash: string
  readonly created_at: number
  readonly expires_at: number
  readonly consumed_at: number | null
}

/** One access-token row, as SQLite returns it. */
export interface AccessRow {
  readonly id: string
  readonly family_id: string
  readonly token_hash: string
  readonly issued_at: number
  readonly expires_at: number
}

/** Render a code word list as a SQL `IN` tuple. */
function words(list: readonly string[]): string {
  return `(${list.map(word => `'${word}'`).join(', ')})`
}

const DDL = `
-- A device exists only after someone proved possession of the private key
-- behind the digest a member compared, so this table is written at redemption
-- and never at transaction start.
CREATE TABLE IF NOT EXISTS device (
  id                TEXT    PRIMARY KEY,
  org_id            TEXT    NOT NULL,
  owner_id          TEXT    NOT NULL,
  platform          TEXT    NOT NULL CHECK (platform IN ${words(DEVICE_PLATFORMS)}),
  public_key        TEXT    NOT NULL,
  public_key_digest TEXT    NOT NULL,
  runner_version    TEXT    NOT NULL,
  status            TEXT    NOT NULL CHECK (status IN ('active', 'revoked')),
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL
) STRICT;
-- One computer's key binds to one device row: a Runner that starts the flow
-- again with the same key rebinds rather than accumulating identities.
CREATE UNIQUE INDEX IF NOT EXISTS device_key ON device (org_id, public_key);

-- The authorization code lives on its transaction rather than in a table of
-- its own: a transaction has at most one code, and keeping them together makes
-- that structural instead of a rule someone has to enforce.
CREATE TABLE IF NOT EXISTS device_transaction (
  id                 TEXT    PRIMARY KEY,
  public_key         TEXT    NOT NULL,
  public_key_digest  TEXT    NOT NULL,
  platform           TEXT    NOT NULL CHECK (platform IN ${words(DEVICE_PLATFORMS)}),
  runner_version     TEXT    NOT NULL,
  pkce_challenge     TEXT    NOT NULL,
  callback_uri       TEXT    NOT NULL,
  protocol_version   INTEGER NOT NULL,
  pairing_code       TEXT    NOT NULL,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  state              TEXT    NOT NULL CHECK (state IN ('pending', 'confirmed', 'redeemed')),
  org_id             TEXT,
  owner_id           TEXT,
  authentication_id  TEXT,
  code_hash          TEXT,
  code_expires_at    INTEGER,
  code_consumed_at   INTEGER,
  -- A pending transaction belongs to nobody; a confirmed one names exactly who
  -- confirmed it. Neither half can drift without the other.
  CHECK ((state = 'pending') = (org_id IS NULL))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS device_transaction_code ON device_transaction (code_hash);

CREATE TABLE IF NOT EXISTS credential_family (
  id         TEXT    PRIMARY KEY,
  device_id  TEXT    NOT NULL REFERENCES device(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS refresh_token (
  id          TEXT    PRIMARY KEY,
  family_id   TEXT    NOT NULL REFERENCES credential_family(id),
  token_hash  TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
) STRICT;
-- Spent tokens are kept, not deleted: reuse detection is a lookup that finds a
-- consumed row, and deleting it would make a replay indistinguishable from a
-- token that never existed.
CREATE UNIQUE INDEX IF NOT EXISTS refresh_token_hash ON refresh_token (token_hash);

CREATE TABLE IF NOT EXISTS access_token (
  id         TEXT    PRIMARY KEY,
  family_id  TEXT    NOT NULL REFERENCES credential_family(id),
  token_hash TEXT    NOT NULL,
  issued_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS access_token_hash ON access_token (token_hash);
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
  if (appId !== 0 && appId !== DEVICE_AUTHORIZATION_SQLITE_APPLICATION_ID) {
    throw new Error(`device-authorization-sqlite: database belongs to another application (application_id ${appId})`)
  }
  if (version !== 0 && version !== SCHEMA_VERSION) {
    throw new Error(`device-authorization-sqlite: database schema ${version} is not supported by this build's ${SCHEMA_VERSION}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)
  db.exec(`PRAGMA application_id = ${DEVICE_AUTHORIZATION_SQLITE_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
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
