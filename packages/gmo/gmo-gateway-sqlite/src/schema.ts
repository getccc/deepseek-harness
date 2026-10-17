/**
 * SQLite schema ownership for the governed GMO category catalog.
 *
 * The catalog records what a category *is*, its identity, its display name,
 * and whether an administrator switched it on, and nothing about what anyone
 * asked it. There is no column for a result, a figure, a filter, or a
 * credential, so reading this database yields an inventory rather than a
 * record of members' work.
 *
 * Authorization is not here either. The access-control database stays
 * authoritative for roles, grants, and resources; this one cannot assert that
 * a principal is allowed anything.
 * @module @deepseek-ai/dsh-gmo-gateway-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { applyCatalogSchema } from '@deepseek-ai/dsh-governed-catalog-sqlite'

/**
 * Current physical schema. Monotonic, and refused in both directions: a
 * database written by any other build is rejected rather than migrated, which
 * is this repository's pre-release stance on durable formats.
 */
export const SCHEMA_VERSION = 1

/** Application id reserved for DeepSeek Harness SQLite GMO-catalog databases. */
export const GMO_GATEWAY_SQLITE_APPLICATION_ID = 0x44534841 + 9

/** One category row, as SQLite returns it; a type alias so it is comparable to SQLite's row record. */
export type CategoryRow = {
  readonly org_id: string
  readonly category_ref: string
  readonly source_code: string
  readonly upstream_id: string
  readonly display_name: string
  readonly result_count: number | null
  readonly admin_enabled: number
  readonly last_discovered_at: number
}

const DDL = `
-- One row per configured source. It holds how the last listing went so an
-- administrator can tell "nothing is governed yet" from "the source stopped
-- answering", which look identical in the gmo_category table alone.
CREATE TABLE IF NOT EXISTS gmo_source (
  org_id          TEXT    NOT NULL,
  source_code     TEXT    NOT NULL,
  provider_kind   TEXT    NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_failure    TEXT,
  PRIMARY KEY (org_id, source_code)
) STRICT;

-- The stable reference is the identity, so an upstream rename changes
-- display_name here without disturbing any grant that names the category. The
-- upstream id lives beside it and only the source provider reads it.
--
-- A row exists exactly while the source lists it: a successful listing that no
-- longer names one takes the row and its governed resource away, grants
-- included, so this catalog says what the source says.
--
-- A new row starts with admin_enabled = 0. An administrator switches a
-- business line on once its data is ready to be asked about, and
-- reconciliation never touches the bit afterwards.
CREATE TABLE IF NOT EXISTS gmo_category (
  org_id             TEXT    NOT NULL,
  category_ref       TEXT    NOT NULL,
  source_code        TEXT    NOT NULL,
  upstream_id        TEXT    NOT NULL,
  display_name       TEXT    NOT NULL,
  result_count       INTEGER,
  admin_enabled      INTEGER NOT NULL CHECK (admin_enabled IN (0, 1)),
  last_discovered_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, category_ref)
) STRICT;

-- One upstream id maps to one reference within a source: a second row for the
-- same upstream category would give one category two governed identities and
-- two independent sets of grants.
CREATE UNIQUE INDEX IF NOT EXISTS gmo_category_upstream
  ON gmo_category (org_id, source_code, upstream_id);
`

/**
 * Bring a connection to {@link SCHEMA_VERSION}, refusing a database written by
 * any other build.
 * @param db - an open SQLite connection.
 * @throws when the file belongs to another application or another schema version.
 */
export function applySchema(db: DatabaseSync): void {
  applyCatalogSchema(db, {
    name: 'gmo-gateway-sqlite',
    applicationId: GMO_GATEWAY_SQLITE_APPLICATION_ID,
    version: SCHEMA_VERSION,
    ddl: DDL,
  })
}
