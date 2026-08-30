/**
 * SQLite schema ownership for the quota ledger.
 *
 * Two tables and one rule between them: a reservation holds a claim, and at
 * most one settlement ever answers it. The uniqueness of that answer is
 * declared to SQLite rather than checked in code, so a second settlement
 * cannot change a balance even if a caller reached the database directly.
 * @module @deepseek-ai/dsh-quota-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { SETTLEMENT_KINDS } from '@deepseek-ai/dsh-quota'

/**
 * Current physical schema. Monotonic: a database written by a newer build is
 * refused rather than migrated down.
 */
export const SCHEMA_VERSION = 1

/** Application id reserved for DeepSeek Harness SQLite quota databases. */
export const QUOTA_SQLITE_APPLICATION_ID = 0x44534841 + 4

/** One budget row, as SQLite returns it. */
export interface BudgetRow {
  readonly org_id: string
  readonly period: string
  readonly limit_tokens: number
}

/** One reservation row, as SQLite returns it. */
export interface ReservationRow {
  readonly id: string
  readonly org_id: string
  readonly period: string
  readonly principal_id: string
  readonly device_id: string | null
  readonly model_ref: string
  readonly reserved_tokens: number
  readonly correlation_id: string | null
  readonly created_at: number
  readonly expires_at: number
}

/** One settlement row, as SQLite returns it. */
export interface SettlementRow {
  readonly reservation_id: string
  readonly kind: string
  readonly input_tokens: number
  readonly output_tokens: number
  readonly charged_tokens: number
  readonly settled_at: number
  readonly reconciled: number
}

/** Render a code word list as a SQL `IN` tuple. */
function words(list: readonly string[]): string {
  return `(${list.map(word => `'${word}'`).join(', ')})`
}

const DDL = `
CREATE TABLE IF NOT EXISTS budget (
  org_id       TEXT    NOT NULL,
  period       TEXT    NOT NULL,
  limit_tokens INTEGER NOT NULL,
  PRIMARY KEY (org_id, period)
) STRICT;

CREATE TABLE IF NOT EXISTS reservation (
  id              TEXT    PRIMARY KEY,
  org_id          TEXT    NOT NULL,
  period          TEXT    NOT NULL,
  principal_id    TEXT    NOT NULL,
  device_id       TEXT,
  model_ref       TEXT    NOT NULL,
  reserved_tokens INTEGER NOT NULL CHECK (reserved_tokens > 0),
  correlation_id  TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL
) STRICT;
-- Open reservations are read on every reserve, and expired ones on every
-- reconcile; both scan by these columns.
CREATE INDEX IF NOT EXISTS reservation_period ON reservation (org_id, period);
CREATE INDEX IF NOT EXISTS reservation_expiry ON reservation (expires_at);

-- The primary key is the reservation, which is what makes settlement
-- idempotent: a second settlement for the same reservation cannot be inserted,
-- so no caller and no reconciler can charge one request twice.
CREATE TABLE IF NOT EXISTS settlement (
  reservation_id TEXT    PRIMARY KEY REFERENCES reservation(id),
  kind           TEXT    NOT NULL CHECK (kind IN ${words(SETTLEMENT_KINDS)}),
  input_tokens   INTEGER NOT NULL CHECK (input_tokens >= 0),
  output_tokens  INTEGER NOT NULL CHECK (output_tokens >= 0),
  charged_tokens INTEGER NOT NULL CHECK (charged_tokens >= 0),
  settled_at     INTEGER NOT NULL,
  reconciled     INTEGER NOT NULL
) STRICT;
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
  if (appId !== 0 && appId !== QUOTA_SQLITE_APPLICATION_ID) {
    throw new Error(`quota-sqlite: database belongs to another application (application_id ${appId})`)
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`quota-sqlite: database schema ${version} is newer than this build's ${SCHEMA_VERSION}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)
  db.exec(`PRAGMA application_id = ${QUOTA_SQLITE_APPLICATION_ID}`)
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
