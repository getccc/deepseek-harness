/**
 * SQLite-backed audit trail: an append-only event log with a catalog-checked
 * vocabulary.
 * @module @deepseek-ai/dsh-audit-sqlite
 */

import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { OrgId, type UserId } from '@deepseek-ai/dsh-account-store'
import {
  AUDIT_ACTIONS,
  Audit,
  METADATA_KEYS,
  checkAuditRecord,
  type AuditActionName,
  type AuditEvent,
  type AuditMetadata,
  type AuditOutcome,
  type AuditQuery,
  type AuditReason,
  type AuditRecord,
  type MetadataKey,
} from '@deepseek-ai/dsh-audit'
import { applySchema, type AuditEventRow, type AuditMetadataRow } from './schema.ts'

export { AUDIT_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from './schema.ts'

/** Plugin config: where the trail lives and how much of it one read may return. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
  /**
   * The most events one {@link SqliteAudit.query} may return. A reader asking
   * for more is served this many; a reader asking for fewer is served what it
   * asked for.
   */
  maxQueryRows: number
}

/**
 * How many events to return: what the reader asked for, never more than the
 * deployment allows.
 * @param requested - the reader's own limit, when it named one.
 * @param max - the configured ceiling.
 * @returns the effective row count.
 */
function resolveLimit(requested: number | undefined, max: number): number {
  return requested === undefined ? max : Math.min(requested, max)
}

/** Turn one stored value back into what its key's kind declares. */
function metadataValue(row: AuditMetadataRow): number | string {
  return row.value_text === null ? row.value_int as number : row.value_text
}

/**
 * The audit trail over one SQLite database.
 *
 * Records go in and never change: the service exposes no amendment, and the
 * schema refuses UPDATE and DELETE on both tables. Reads come back newest
 * first, because that is the order a person investigating reads them.
 */
export class SqliteAudit extends Audit {
  static Config: z<Config> = z.object({
    path: z.string().required(),
    maxQueryRows: z.natural().min(1).required(),
  })

  private db!: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  /** Open, bring the database to the current schema, and seed the catalogs. */
  protected async [Service.init](): Promise<void> {
    const db = new DatabaseSync(this.config.path)
    applySchema(db)
    this.db = db
    this.ctx.effect(() => () => { db.close() }, 'audit-sqlite.close')
    await Promise.resolve()
  }

  record(record: AuditRecord): Promise<AuditEvent> {
    const problem = checkAuditRecord(record)
    if (problem !== undefined) return Promise.reject(problem)
    // The store assigns both, so a caller can neither backdate an entry nor
    // choose where it falls in the sequence.
    const at = Date.now()
    const metadata: AuditMetadata = record.metadata ?? {}
    const row = this.db.prepare(
      `INSERT INTO audit_event
         (at, org_id, action, outcome, principal_id, resource_id, device_id, correlation_id, reason, policy_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING seq`,
    ).get(
      at,
      record.orgId,
      record.action,
      record.outcome,
      record.principalId ?? null,
      record.resourceId ?? null,
      record.deviceId ?? null,
      record.correlationId ?? null,
      record.reason ?? null,
      record.policyRevision === undefined ? null : Number(record.policyRevision),
    ) as Pick<AuditEventRow, 'seq'>
    const insert = this.db.prepare(
      'INSERT INTO audit_event_metadata (seq, key, value_int, value_text) VALUES (?, ?, ?, ?)',
    )
    for (const [key, value] of Object.entries(metadata)) {
      const numeric = typeof value === 'number'
      insert.run(row.seq, key, numeric ? value : null, numeric ? null : value)
    }
    return Promise.resolve({
      ...record,
      seq: BigInt(row.seq),
      at,
      resourceType: AUDIT_ACTIONS[record.action].resourceType,
      metadata,
    })
  }

  query(query: AuditQuery): Promise<AuditEvent[]> {
    const where = ['e.org_id = ?']
    const params: (string | number)[] = [query.orgId]
    if (query.principalId !== undefined) { where.push('e.principal_id = ?'); params.push(query.principalId) }
    if (query.action !== undefined) { where.push('e.action = ?'); params.push(query.action) }
    if (query.resourceType !== undefined) { where.push('c.resource_type = ?'); params.push(query.resourceType) }
    if (query.outcome !== undefined) { where.push('e.outcome = ?'); params.push(query.outcome) }
    if (query.since !== undefined) { where.push('e.at >= ?'); params.push(query.since) }
    if (query.until !== undefined) { where.push('e.at < ?'); params.push(query.until) }
    if (query.before !== undefined) { where.push('e.seq < ?'); params.push(Number(query.before)) }
    const rows = this.db.prepare(
      `SELECT e.*, c.resource_type FROM audit_event e
         JOIN audit_action_catalog c ON c.action = e.action
        WHERE ${where.join(' AND ')}
        ORDER BY e.seq DESC
        LIMIT ?`,
    ).all(...params, resolveLimit(query.limit, this.config.maxQueryRows)) as unknown as
      (AuditEventRow & { readonly resource_type: string })[]
    return Promise.resolve(rows.map(row => this.toEvent(row, row.resource_type)))
  }

  /** Rebuild one event, reading its metadata rows back into catalog-keyed values. */
  private toEvent(row: AuditEventRow, resourceType: string): AuditEvent {
    const metadata: Partial<Record<MetadataKey, number | string>> = {}
    const rows = this.db.prepare('SELECT * FROM audit_event_metadata WHERE seq = ? ORDER BY key')
      .all(row.seq) as unknown as AuditMetadataRow[]
    // A key retired from the code catalog keeps its stored rows, and reading one
    // back as a live key would put a value in a place no consumer declares.
    for (const entry of rows) {
      if (Object.hasOwn(METADATA_KEYS, entry.key)) metadata[entry.key as MetadataKey] = metadataValue(entry)
    }
    return {
      seq: BigInt(row.seq),
      at: row.at,
      orgId: OrgId(row.org_id),
      action: row.action as AuditActionName,
      resourceType,
      outcome: row.outcome as AuditOutcome,
      ...(row.principal_id === null ? {} : { principalId: row.principal_id as UserId }),
      ...(row.resource_id === null ? {} : { resourceId: row.resource_id }),
      ...(row.device_id === null ? {} : { deviceId: row.device_id }),
      ...(row.correlation_id === null ? {} : { correlationId: row.correlation_id }),
      ...(row.reason === null ? {} : { reason: row.reason as AuditReason }),
      ...(row.policy_revision === null ? {} : { policyRevision: BigInt(row.policy_revision) }),
      metadata,
    }
  }
}

export default SqliteAudit
