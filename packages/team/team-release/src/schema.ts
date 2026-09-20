/**
 * SQLite schema ownership for published desktop releases.
 *
 * The store holds what was published and who it is offered to. It holds no
 * key: the signature it records was made on the release machine, and this
 * deployment can serve a manifest it was given but cannot produce one.
 * @module @deepseek-ai/dsh-team-release/schema
 */

import type { DatabaseSync } from 'node:sqlite'

/**
 * Current physical schema. Monotonic, and refused in both directions: a
 * database written by any other build is rejected rather than migrated, which
 * is this repository's pre-release stance on durable formats.
 */
export const SCHEMA_VERSION = 1

/** Application id reserved for DeepSeek Harness SQLite release databases. */
export const TEAM_RELEASE_APPLICATION_ID = 0x44534841 + 8

/** One release row, as SQLite returns it. */
export interface ReleaseRow {
  readonly org_id: string
  readonly version: string
  readonly manifest: string
  readonly signature: string
  readonly channel: string
  readonly published_at: number
  readonly withdrawn_at: number | null
}

/** One floor row, as SQLite returns it. */
export interface FloorRow {
  readonly org_id: string
  readonly minimum_version: string
  readonly updated_at: number
}

const DDL = `
-- One row per published release. The manifest and its signature are stored as
-- the release machine produced them, byte for byte: re-encoding the document
-- here would invalidate the signature over its canonical bytes.
--
-- Withdrawal is a timestamp rather than a deletion, so an administrator can
-- tell a release that was pulled from one that was never published.
CREATE TABLE IF NOT EXISTS team_release (
  org_id       TEXT    NOT NULL,
  version      TEXT    NOT NULL,
  manifest     TEXT    NOT NULL,
  signature    TEXT    NOT NULL,
  channel      TEXT    NOT NULL CHECK (channel IN ('staged', 'general')),
  published_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  PRIMARY KEY (org_id, version)
) STRICT;

-- At most one floor per organization: the oldest version this deployment
-- still accepts. A build below it is offered the update and refuses to work
-- until it takes one.
CREATE TABLE IF NOT EXISTS team_release_floor (
  org_id          TEXT    NOT NULL PRIMARY KEY,
  minimum_version TEXT    NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;
`

/**
 * Bring a connection to {@link SCHEMA_VERSION}, refusing a database written by
 * any other build.
 * @param db - an open SQLite connection.
 * @throws when the file belongs to another application or another schema version.
 */
export function applySchema(db: DatabaseSync): void {
  const appId = readPragma(db, 'application_id')
  const version = readPragma(db, 'user_version')
  if (appId !== 0 && appId !== TEAM_RELEASE_APPLICATION_ID) {
    throw new Error(`team-release: database belongs to another application (application_id ${appId})`)
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`team-release: database schema ${version} is newer than this build's ${SCHEMA_VERSION}`)
  }
  /* v8 ignore next 3 -- reachable only once SCHEMA_VERSION passes 1; kept so the
     first bump refuses an older file without rediscovering the rule. */
  if (version !== 0 && version < SCHEMA_VERSION) {
    throw new Error(`team-release: database schema ${version} is older than this build's ${SCHEMA_VERSION}`)
  }
  db.exec(DDL)
  db.exec(`PRAGMA application_id = ${TEAM_RELEASE_APPLICATION_ID}`)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/** Read one integer pragma; both reads answer with exactly one row holding one integer. */
function readPragma(db: DatabaseSync, name: string): number {
  const [value] = Object.values(db.prepare(`PRAGMA ${name}`).get() as Record<string, number>)
  return value as number
}
