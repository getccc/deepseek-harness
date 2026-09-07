/**
 * SQLite schema ownership for the company model catalog.
 *
 * The table holds a credential *reference* and never a credential, so reading
 * this database yields nothing anyone could spend upstream.
 * @module @deepseek-ai/dsh-model-gateway-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import { MODEL_STATUSES } from '@deepseek-ai/dsh-model-gateway'

/**
 * Current physical schema. Monotonic, and refused in both directions: a
 * database written by another version is neither migrated up nor read down.
 * Version 2 added `input_modalities`.
 */
export const SCHEMA_VERSION = 2

/** Application id reserved for DeepSeek Harness SQLite model-catalog databases. */
export const MODEL_GATEWAY_SQLITE_APPLICATION_ID = 0x44534841 + 5

/** One catalog row, as SQLite returns it. */
export interface ModelRow {
  readonly org_id: string
  readonly model_ref: string
  readonly display_name: string
  readonly provider_ref: string
  readonly upstream_model: string
  readonly endpoint: string
  readonly credential_ref: string
  readonly max_output_tokens: number
  /** JSON array of input modality words; the catalog entry's `inputModalities`. */
  readonly input_modalities: string
  readonly status: string
}

/** Render a code word list as a SQL `IN` tuple. */
function words(list: readonly string[]): string {
  return `(${list.map(word => `'${word}'`).join(', ')})`
}

const DDL = `
-- The stable ref is the identity, so a provider renaming its model upstream or
-- a credential rotating changes a column here without disturbing any grant that
-- names the model.
CREATE TABLE IF NOT EXISTS model (
  org_id            TEXT    NOT NULL,
  model_ref         TEXT    NOT NULL,
  display_name      TEXT    NOT NULL,
  provider_ref      TEXT    NOT NULL,
  upstream_model    TEXT    NOT NULL,
  endpoint          TEXT    NOT NULL,
  credential_ref    TEXT    NOT NULL,
  max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens > 0),
  -- A JSON array of modality words. Never empty: a model that accepts nothing
  -- is not a model, and an adapter reading an empty list would refuse text.
  input_modalities  TEXT    NOT NULL CHECK (json_valid(input_modalities) AND json_array_length(input_modalities) > 0),
  status            TEXT    NOT NULL CHECK (status IN ${words(MODEL_STATUSES)}),
  PRIMARY KEY (org_id, model_ref)
) STRICT;
`

/**
 * Bring a fresh connection to {@link SCHEMA_VERSION}, refusing a database
 * written at any other version.
 * @param db - an open SQLite connection.
 * @throws when the file belongs to another application or another schema version.
 */
export function applySchema(db: DatabaseSync): void {
  const appId = readPragma(db, 'application_id')
  const version = readPragma(db, 'user_version')
  if (appId !== 0 && appId !== MODEL_GATEWAY_SQLITE_APPLICATION_ID) {
    throw new Error(`model-gateway-sqlite: database belongs to another application (application_id ${appId})`)
  }
  if (version !== 0 && version !== SCHEMA_VERSION) {
    throw new Error(`model-gateway-sqlite: database schema ${version} is not supported by this build's ${SCHEMA_VERSION}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(DDL)
  db.exec(`PRAGMA application_id = ${MODEL_GATEWAY_SQLITE_APPLICATION_ID}`)
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
