/**
 * SQLite schema ownership for the governed knowledge catalog.
 *
 * The catalog records what a knowledge base *is* — its identity, its display
 * metadata, and whether it is still upstream — and nothing about what anyone
 * asked it. There is no column for a query, a passage, a filename, or a
 * credential, so reading this database yields an inventory rather than a record
 * of members' work.
 *
 * Authorization is not here either. The access-control database stays
 * authoritative for roles, grants, and resources; this one cannot assert that a
 * principal is allowed anything.
 * @module @deepseek-ai/dsh-knowledge-gateway-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { applyCatalogSchema } from '@deepseek-ai/dsh-governed-catalog-sqlite'

/**
 * Current physical schema. Monotonic, and refused in both directions: a
 * database written by any other build is rejected rather than migrated, which
 * is this repository's pre-release stance on durable formats.
 */
export const SCHEMA_VERSION = 4

/** Application id reserved for DeepSeek Harness SQLite knowledge-catalog databases. */
export const KNOWLEDGE_GATEWAY_SQLITE_APPLICATION_ID = 0x44534841 + 6

/** One knowledge-base row, as SQLite returns it. */
export interface KnowledgeBaseRow {
  readonly org_id: string
  readonly knowledge_ref: string
  readonly source_code: string
  readonly upstream_id: string
  readonly display_name: string
  readonly description: string
  readonly kind: string
  readonly document_count: number
  readonly processing_count: number
  readonly embedding_model_id: string
  readonly admin_enabled: number
  readonly last_discovered_at: number
  readonly upstream_updated_at: number | null
  readonly upstream_created_at: number | null
}

const DDL = `
-- One row per configured source. It holds how the last listing went so an
-- administrator can tell "nothing is governed yet" from "the source stopped
-- answering", which look identical in the knowledge_base table alone.
CREATE TABLE IF NOT EXISTS knowledge_source (
  org_id          TEXT    NOT NULL,
  source_code     TEXT    NOT NULL,
  provider_kind   TEXT    NOT NULL,
  last_attempt_at INTEGER NOT NULL,
  last_success_at INTEGER,
  last_failure    TEXT,
  PRIMARY KEY (org_id, source_code)
) STRICT;

-- The stable reference is the identity, so an upstream rename changes
-- display_name here without disturbing any grant that names the knowledge base.
-- The upstream id lives beside it and only the source provider reads it.
--
-- A row exists exactly while the source lists it: a successful listing that no
-- longer names one takes the row and its governed resource away, grants
-- included, so this catalog says what the source says.
CREATE TABLE IF NOT EXISTS knowledge_base (
  org_id             TEXT    NOT NULL,
  knowledge_ref      TEXT    NOT NULL,
  source_code        TEXT    NOT NULL,
  upstream_id        TEXT    NOT NULL,
  display_name       TEXT    NOT NULL,
  description        TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('document', 'faq')),
  document_count     INTEGER NOT NULL CHECK (document_count >= 0),
  processing_count   INTEGER NOT NULL CHECK (processing_count >= 0),
  embedding_model_id TEXT    NOT NULL,
  admin_enabled      INTEGER NOT NULL CHECK (admin_enabled IN (0, 1)),
  last_discovered_at INTEGER NOT NULL,
  upstream_updated_at INTEGER,
  upstream_created_at INTEGER,
  PRIMARY KEY (org_id, knowledge_ref)
) STRICT;

-- One upstream id maps to one reference within a source: a second row for the
-- same upstream base would give one knowledge base two governed identities and
-- two independent sets of grants.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_base_upstream
  ON knowledge_base (org_id, source_code, upstream_id);
`

/**
 * Bring a connection to {@link SCHEMA_VERSION}, refusing a database written by
 * any other build.
 * @param db - an open SQLite connection.
 * @throws when the file belongs to another application or another schema version.
 */
export function applySchema(db: DatabaseSync): void {
  applyCatalogSchema(db, {
    name: 'knowledge-gateway-sqlite',
    applicationId: KNOWLEDGE_GATEWAY_SQLITE_APPLICATION_ID,
    version: SCHEMA_VERSION,
    ddl: DDL,
  })
}
