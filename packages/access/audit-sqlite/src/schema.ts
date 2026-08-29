/**
 * SQLite schema ownership for the audit trail.
 *
 * The schema is where the privacy claim stops being a convention. Every text
 * column either references a seeded catalog or carries a CHECK that admits only
 * a short token, and both tables refuse UPDATE and DELETE outright. A caller
 * who opened this file directly, bypassing the service, still cannot store a
 * prompt or rewrite what was already stored.
 * @module @deepseek-ai/dsh-audit-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_REASONS, METADATA_KEYS } from '@deepseek-ai/dsh-audit'

/**
 * Current physical schema. Monotonic: a database written by a newer build is
 * refused rather than migrated down.
 */
export const SCHEMA_VERSION = 1

/** Application id reserved for DeepSeek Harness SQLite audit databases. */
export const AUDIT_SQLITE_APPLICATION_ID = 0x44534841 + 2

/** One audit event row, as SQLite returns it. */
export interface AuditEventRow {
  readonly seq: number
  readonly at: number
  readonly org_id: string
  readonly action: string
  readonly outcome: string
  readonly principal_id: string | null
  readonly resource_id: string | null
  readonly device_id: string | null
  readonly correlation_id: string | null
  readonly reason: string | null
  readonly policy_revision: number | null
}

/** One metadata row, as SQLite returns it. */
export interface AuditMetadataRow {
  readonly seq: number
  readonly key: string
  readonly value_int: number | null
  readonly value_text: string | null
}

/**
 * The SQL a token column must satisfy: one to 64 characters, none of them
 * outside the token alphabet. The negated GLOB class is what rejects a space,
 * so prose fails before length ever matters.
 *
 * The NULL arm makes one expression serve both optional and NOT NULL columns;
 * on a NOT NULL column the column's own declaration has already refused NULL.
 * @param column - the column to constrain.
 * @returns a CHECK expression that admits NULL and rejects anything longer or richer than a token.
 */
function tokenCheck(column: string): string {
  return `${column} IS NULL OR (length(${column}) BETWEEN 1 AND 64 AND ${column} NOT GLOB '*[^A-Za-z0-9._:@-]*')`
}

/** Render a code word list as a SQL `IN` tuple. */
function words(list: readonly string[]): string {
  return `(${list.map(word => `'${word}'`).join(', ')})`
}

const DDL = `
CREATE TABLE IF NOT EXISTS audit_action_catalog (
  action        TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS audit_metadata_catalog (
  key TEXT PRIMARY KEY
) STRICT;

-- There is no resource_type column: it is fixed by the action, so the catalog
-- holds it once and a query that filters on it joins. A denormalized copy would
-- be a text column nothing constrains.
--
-- AUTOINCREMENT, not a plain rowid alias: a deleted maximum must never be
-- handed out again, or two events would share a sequence number across the
-- lifetime of the trail.
CREATE TABLE IF NOT EXISTS audit_event (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,
  at              INTEGER NOT NULL,
  org_id          TEXT    NOT NULL CHECK (${tokenCheck('org_id')}),
  action          TEXT    NOT NULL REFERENCES audit_action_catalog(action),
  outcome         TEXT    NOT NULL CHECK (outcome IN ${words(AUDIT_OUTCOMES)}),
  principal_id    TEXT    CHECK (${tokenCheck('principal_id')}),
  resource_id     TEXT    CHECK (${tokenCheck('resource_id')}),
  device_id       TEXT    CHECK (${tokenCheck('device_id')}),
  correlation_id  TEXT    CHECK (${tokenCheck('correlation_id')}),
  reason          TEXT    CHECK (reason IS NULL OR reason IN ${words(AUDIT_REASONS)}),
  policy_revision INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS audit_event_org ON audit_event (org_id, seq);

CREATE TABLE IF NOT EXISTS audit_event_metadata (
  seq        INTEGER NOT NULL REFERENCES audit_event(seq),
  key        TEXT    NOT NULL REFERENCES audit_metadata_catalog(key),
  value_int  INTEGER,
  value_text TEXT    CHECK (${tokenCheck('value_text')}),
  PRIMARY KEY (seq, key),
  -- One column holds the value and the other is empty, so a reader never has
  -- to decide which of two present values the key meant.
  CHECK ((value_int IS NULL) <> (value_text IS NULL))
) STRICT;

CREATE TRIGGER IF NOT EXISTS audit_event_immutable BEFORE UPDATE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_permanent BEFORE DELETE ON audit_event
  BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_metadata_immutable BEFORE UPDATE ON audit_event_metadata
  BEGIN SELECT RAISE(ABORT, 'audit_event_metadata is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_metadata_permanent BEFORE DELETE ON audit_event_metadata
  BEGIN SELECT RAISE(ABORT, 'audit_event_metadata is append-only'); END;
`

/**
 * Bring a connection to {@link SCHEMA_VERSION} and seed the action and metadata
 * catalogs from code, refusing a database written by a build that knew more
 * than this one.
 * @param db - an open SQLite connection.
 * @throws when the file belongs to another application or a newer schema.
 */
export function applySchema(db: DatabaseSync): void {
  const appId = readPragma(db, 'application_id')
  const version = readPragma(db, 'user_version')
  if (appId !== 0 && appId !== AUDIT_SQLITE_APPLICATION_ID) {
    throw new Error(`audit-sqlite: database belongs to another application (application_id ${appId})`)
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`audit-sqlite: database schema ${version} is newer than this build's ${SCHEMA_VERSION}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)
  seedCatalogs(db)
  db.exec(`PRAGMA application_id = ${AUDIT_SQLITE_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/**
 * Write the code catalogs into the database.
 *
 * Only inserts, and the resource type of a known action is refreshed in place:
 * an action this build no longer audits stays in the table so the events
 * referencing it keep their foreign key, and the service's own check — which
 * reads the code catalog, not this table — stops it being recorded again.
 */
function seedCatalogs(db: DatabaseSync): void {
  const action = db.prepare(
    `INSERT INTO audit_action_catalog (action, resource_type) VALUES (?, ?)
     ON CONFLICT (action) DO UPDATE SET resource_type = excluded.resource_type`,
  )
  for (const [name, spec] of Object.entries(AUDIT_ACTIONS)) action.run(name, spec.resourceType)
  const key = db.prepare('INSERT INTO audit_metadata_catalog (key) VALUES (?) ON CONFLICT DO NOTHING')
  for (const name of Object.keys(METADATA_KEYS)) key.run(name)
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
