/**
 * The schema check every governed catalog database runs when it opens.
 * @module @deepseek-ai/dsh-governed-catalog-sqlite/schema
 */

import type { DatabaseSync } from 'node:sqlite'
import type { CatalogSchema } from './types.ts'

/**
 * Bring a connection to a capability's schema version, refusing a database
 * written by any other build.
 *
 * The version is monotonic and refused in both directions: the DDL only
 * creates tables it does not find, so a column an older build wrote and this
 * build no longer writes would still be there and still be `NOT NULL`.
 * Rebuilding a catalog costs one synchronization and the administrator's
 * enablement choices; nothing in it is a record of anyone's work.
 * @param db - an open SQLite connection.
 * @param schema - the capability's name, application id, version, and DDL.
 * @throws when the file belongs to another application or another schema version.
 */
export function applyCatalogSchema(db: DatabaseSync, schema: CatalogSchema): void {
  const appId = readPragma(db, 'application_id')
  const version = readPragma(db, 'user_version')
  if (appId !== 0 && appId !== schema.applicationId) {
    throw new Error(`${schema.name}: database belongs to another application (application_id ${appId})`)
  }
  if (version > schema.version) {
    throw new Error(`${schema.name}: database schema ${version} is newer than this build's ${schema.version}`)
  }
  if (version !== 0 && version < schema.version) {
    throw new Error(`${schema.name}: database schema ${version} is older than this build's ${schema.version}; delete the file and synchronize again`)
  }
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(schema.ddl)
  db.exec(`PRAGMA application_id = ${schema.applicationId}`)
  db.exec(`PRAGMA user_version = ${schema.version}`)
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
