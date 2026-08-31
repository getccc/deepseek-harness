/**
 * SQLite schema ownership for access control.
 * @module @deepseek-ai/dsh-access-control-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { PERMISSION_CATALOG } from '@deepseek-ai/dsh-access-control'

/**
 * Current physical schema. Monotonic: a database written by a newer build is
 * refused rather than migrated down.
 */
export const SCHEMA_VERSION = 2

/** Application id reserved for DeepSeek Harness SQLite access-control databases. */
export const ACCESS_CONTROL_SQLITE_APPLICATION_ID = 0x44534841 + 1

/** One role row, as SQLite returns it. */
export interface RoleRow {
  readonly id: string
  readonly org_id: string
  readonly name: string
  readonly code: string
  readonly description: string
  readonly kind: string
  readonly created_at: number | null
}

/** One governed-resource row, as SQLite returns it. */
export interface ResourceRow {
  readonly id: string
  readonly org_id: string
  readonly type: string
  readonly external_ref: string
  readonly display_name: string
  readonly enabled: number
}

/** One group row, as SQLite returns it. */
export interface GroupRow {
  readonly id: string
  readonly org_id: string
  readonly name: string
}

const DDL = `
CREATE TABLE IF NOT EXISTS permission_catalog (
  resource_type TEXT NOT NULL,
  action        TEXT NOT NULL,
  PRIMARY KEY (resource_type, action)
) STRICT;

CREATE TABLE IF NOT EXISTS role (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,
  name        TEXT NOT NULL,
  code        TEXT,
  description TEXT NOT NULL,
  kind        TEXT NOT NULL,
  created_at  INTEGER
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS role_name ON role (org_id, name);

CREATE TABLE IF NOT EXISTS user_group (
  id     TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name   TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS user_group_name ON user_group (org_id, name);

CREATE TABLE IF NOT EXISTS group_member (
  group_id TEXT NOT NULL REFERENCES user_group(id),
  user_id  TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id)
) STRICT;

CREATE TABLE IF NOT EXISTS user_role_binding (
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES role(id),
  PRIMARY KEY (user_id, role_id)
) STRICT;

CREATE TABLE IF NOT EXISTS group_role_binding (
  group_id TEXT NOT NULL REFERENCES user_group(id),
  role_id  TEXT NOT NULL REFERENCES role(id),
  PRIMARY KEY (group_id, role_id)
) STRICT;

CREATE TABLE IF NOT EXISTS resource (
  id           TEXT    PRIMARY KEY,
  org_id       TEXT    NOT NULL,
  type         TEXT    NOT NULL,
  external_ref TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1
) STRICT;
-- What a request names is (organization, type, external ref); the surrogate id
-- exists so a grant can point at a row that keeps its identity when a display
-- name changes.
CREATE UNIQUE INDEX IF NOT EXISTS resource_ref ON resource (org_id, type, external_ref);

-- Both grant tables reference the permission catalog, so a grant naming a pair
-- this build does not govern cannot be stored even if a caller reached the
-- store without passing the service's own check.
CREATE TABLE IF NOT EXISTS role_type_grant (
  id            TEXT PRIMARY KEY,
  role_id       TEXT NOT NULL REFERENCES role(id),
  resource_type TEXT NOT NULL,
  action        TEXT NOT NULL,
  FOREIGN KEY (resource_type, action) REFERENCES permission_catalog(resource_type, action)
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS role_type_grant_unique
  ON role_type_grant (role_id, resource_type, action);

CREATE TABLE IF NOT EXISTS role_resource_grant (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL REFERENCES role(id),
  resource_id TEXT NOT NULL REFERENCES resource(id),
  action      TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS role_resource_grant_unique
  ON role_resource_grant (role_id, resource_id, action);
`

/**
 * Statements that need a column this build added to a table an earlier one
 * wrote, so they run after {@link backfillRoleCodes} rather than inside the DDL.
 */
const LATE_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS role_code ON role (org_id, code);
`

/**
 * Bring a connection to {@link SCHEMA_VERSION} and seed the permission catalog
 * from code, refusing a database written by a build that knew more than this one.
 * @param db - an open SQLite connection.
 * @throws when the file belongs to another application or a newer schema.
 */
export function applySchema(db: DatabaseSync): void {
  const appId = readPragma(db, 'application_id')
  const version = readPragma(db, 'user_version')
  if (appId !== 0 && appId !== ACCESS_CONTROL_SQLITE_APPLICATION_ID) {
    throw new Error(`access-control-sqlite: database belongs to another application (application_id ${appId})`)
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`access-control-sqlite: database schema ${version} is newer than this build's ${SCHEMA_VERSION}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)
  backfillRoleCodes(db)
  db.exec(LATE_DDL)
  seedPermissions(db)
  db.exec(`PRAGMA application_id = ${ACCESS_CONTROL_SQLITE_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/**
 * Give every role a code.
 *
 * Schema 1 had no `code` column, and `CREATE TABLE IF NOT EXISTS` leaves an
 * existing table as it was, so the column is added here and the roles already
 * stored take their own id as a starting code. An id is unique by construction,
 * which is what the code index needs; an administrator renames it afterwards.
 */
function backfillRoleCodes(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(role)').all() as unknown as { name: string }[]
  const present = new Set(columns.map(column => column.name))
  if (!present.has('code')) db.exec('ALTER TABLE role ADD COLUMN code TEXT')
  // Schema 1 recorded no creation moment either. It stays NULL for the roles
  // already stored: a made-up timestamp reads exactly like a real one, and a
  // reader has no way to tell it was invented.
  if (!present.has('created_at')) db.exec('ALTER TABLE role ADD COLUMN created_at INTEGER')
  db.exec('UPDATE role SET code = id WHERE code IS NULL')
}

/**
 * Write the code catalog into the database.
 *
 * Only inserts: a pair this build no longer governs stays in the table so the
 * grants referencing it keep their foreign key, and the service's own check —
 * which reads the code catalog, not this table — stops it being granted again.
 * Deleting rows here would break stored grants instead of retiring them.
 */
function seedPermissions(db: DatabaseSync): void {
  const insert = db.prepare(
    'INSERT INTO permission_catalog (resource_type, action) VALUES (?, ?) ON CONFLICT DO NOTHING',
  )
  for (const permission of PERMISSION_CATALOG) insert.run(permission.resourceType, permission.action)
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
