/**
 * SQLite schema ownership for the console-menu store.
 * @module @deepseek-ai/dsh-team-console-menu-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'

/**
 * Current physical schema. Monotonic: a database written by a newer build is
 * refused rather than migrated down, because a downgrade cannot know what a
 * column it has never seen means.
 */
export const SCHEMA_VERSION = 1

/** Application id reserved for DeepSeek Harness SQLite console-menu databases. */
export const CONSOLE_MENU_SQLITE_APPLICATION_ID = 0x44534841 + 2

/** One console-menu row, as SQLite returns it. */
export interface ConsoleMenuRow {
  readonly id: string
  readonly org_id: string
  readonly parent_id: string | null
  readonly name: string
  readonly label_key: string | null
  readonly kind: string
  readonly route_path: string | null
  readonly component_path: string | null
  readonly permission: string | null
  readonly icon: string | null
  readonly sort_order: number
  readonly status: string
  readonly visible: number
  readonly seed_key: string | null
  readonly created_at: number
}

const DDL = `
-- The organization is named by id and not joined to: accounts live in the
-- account store's own database, and a navigation entry outliving nothing there
-- is exactly the relation this file cannot enforce.
CREATE TABLE IF NOT EXISTS console_menu (
  id             TEXT    PRIMARY KEY,
  org_id         TEXT    NOT NULL,
  parent_id      TEXT    REFERENCES console_menu(id),
  name           TEXT    NOT NULL,
  label_key      TEXT,
  kind           TEXT    NOT NULL,
  route_path     TEXT,
  component_path TEXT,
  permission     TEXT,
  icon           TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL,
  visible        INTEGER NOT NULL DEFAULT 1,
  seed_key       TEXT,
  created_at     INTEGER NOT NULL
) STRICT;
-- One row per shipped entry per organization, which is what makes re-seeding a
-- restart safe: the insert conflicts rather than duplicating the tree.
CREATE UNIQUE INDEX IF NOT EXISTS console_menu_seed ON console_menu (org_id, seed_key);
CREATE INDEX IF NOT EXISTS console_menu_org ON console_menu (org_id);
CREATE INDEX IF NOT EXISTS console_menu_parent ON console_menu (parent_id);
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
  if (appId !== 0 && appId !== CONSOLE_MENU_SQLITE_APPLICATION_ID) {
    throw new Error(`team-console-menu-sqlite: database belongs to another application (application_id ${appId})`)
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`team-console-menu-sqlite: database schema ${version} is newer than this build's ${SCHEMA_VERSION}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)
  db.exec(`PRAGMA application_id = ${CONSOLE_MENU_SQLITE_APPLICATION_ID}`)
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
