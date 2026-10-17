/**
 * Types of the governed catalog engine: the SQLite rows it reads, the
 * description each capability gives it, and the views it returns.
 * @module @deepseek-ai/dsh-governed-catalog-sqlite/types
 */

import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import type { ManagedResource } from '@deepseek-ai/dsh-access-control'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { AuditActionName, AuditOutcome, AuditReason, MetadataKey } from '@deepseek-ai/dsh-audit'

/** SQLite journal modes a catalog database accepts. */
export type JournalMode = 'wal' | 'delete' | 'truncate' | 'persist'

/** How the engine opens its database; each field is already defaulted by the caller's config schema. */
export interface CatalogDatabaseConfig {
  /** Path to the catalog database. */
  readonly path: string
  /** SQLite journal mode applied after the schema. */
  readonly journalMode: JournalMode
  /** How long a statement waits for another connection's lock, in milliseconds. */
  readonly busyTimeoutMs: number
}

/**
 * Who is asking, recovered from a verified access token.
 *
 * Structurally the principal of every governed capability gateway; never read
 * from a request body.
 */
export interface GovernedPrincipal {
  readonly orgId: OrgId
  readonly principalId: UserId
  /** The device the request arrived from, when one is bound to it. */
  readonly deviceId?: string
  /** Opaque correlation for the Session; never a local session id. */
  readonly correlationId?: string
}

/** Whether a source answered, and when it last did. */
export type SourceHealth = 'never-synced' | 'healthy' | 'failing'

/** How the configured source is doing, for an administrator reading the page. */
export interface SourceStatus {
  /** The deployment's code for the source. */
  readonly sourceCode: string
  /** Which upstream product it is. */
  readonly providerKind: string
  readonly health: SourceHealth
  /** Epoch milliseconds of the last attempt, or undefined before the first. */
  readonly lastAttemptAt: number | undefined
  /** Epoch milliseconds of the last success, or undefined before the first. */
  readonly lastSuccessAt: number | undefined
  /** The closed failure word of the last attempt, or undefined when it did not fail. */
  readonly lastFailure: string | undefined
}

/** What the administration page reads in one call. */
export interface CatalogView<Entry> {
  readonly source: SourceStatus
  readonly entries: readonly Entry[]
}

/** One source row, as SQLite returns it; a type alias so it is comparable to SQLite's row record. */
export type SourceRow = {
  readonly org_id: string
  readonly source_code: string
  readonly provider_kind: string
  readonly last_attempt_at: number
  readonly last_success_at: number | null
  readonly last_failure: string | null
}

/**
 * The columns every catalog row carries, with the capability's own reference
 * column named by `C`; a type alias so it is comparable to SQLite's row record.
 */
export type CatalogRow<C extends string> = {
  readonly org_id: string
  readonly source_code: string
  readonly upstream_id: string
  readonly display_name: string
  readonly admin_enabled: number
  readonly last_discovered_at: number
} & { readonly [K in C]: string }

/** The configured source, as the engine reads it. */
export interface CatalogSource<Listed> {
  /** The deployment's code for the source. */
  readonly sourceCode: string
  /** Which upstream product it is. */
  readonly providerKind: string
  /**
   * One full listing of what the source governs.
   * @returns every entry the source lists.
   */
  list(): Promise<readonly Listed[]>
}

/** One listed entry as the catalog stores it. */
export interface ListedEntry {
  /** The governed reference minted for the entry. */
  readonly ref: string
  /** The source's own identifier for the entry. */
  readonly upstreamId: string
  /** The name shown to administrators and role editors. */
  readonly displayName: string
  /** Values for {@link GovernedCatalogSpec.listedColumns}, in the same order. */
  readonly values: readonly SQLInputValue[]
}

/**
 * Everything one capability supplies to the engine. All of it is fixed per
 * capability: names of its tables and columns, its governed resource, its audit
 * vocabulary, and how its own types map onto catalog rows.
 */
export interface GovernedCatalogSpec<C extends string, Row extends CatalogRow<C>, Entry extends { readonly ref: string }, Listed> {
  /** Plugin name, used to label the database-close effect. */
  readonly name: string
  /** Table holding one row per governed entry. */
  readonly table: string
  /** Table holding one row per configured source. */
  readonly sourceTable: string
  /** Column of {@link table} holding the governed reference. */
  readonly refColumn: C
  /** The governed resource type of the entries and of the catalog. */
  readonly resourceType: string
  /** The governed resource standing for the catalog itself, recorded against by synchronization. */
  readonly catalogResource: string
  /** Audit action recorded by one synchronization. */
  readonly syncAction: AuditActionName
  /** Audit metadata key carrying a failure word. */
  readonly failureKey: MetadataKey
  /** Whether a newly discovered entry starts switched on. */
  readonly startsEnabled: boolean
  /** Columns of {@link table} the listing writes beyond the common ones. */
  readonly listedColumns: readonly string[]
  /**
   * Create the capability's tables and refuse a database written by any other build.
   * @param db - the opened connection.
   */
  applySchema(db: DatabaseSync): void
  /**
   * The source configured now.
   * @returns the source, read per call so a replaced provider is seen.
   */
  source(): CatalogSource<Listed>
  /**
   * Name one listed entry as the catalog stores it. Every entry is described
   * before anything is written, so a listing this build cannot express changes
   * nothing.
   * @param listed - one entry of the source's listing.
   * @param source - the source that listed it.
   * @returns the minted reference and the values to store.
   */
  describe(listed: Listed, source: CatalogSource<Listed>): ListedEntry
  /**
   * The closed failure word recorded when a listing fails.
   * @param error - what the source threw.
   * @returns a word the audit metadata key accepts.
   */
  failureReason(error: unknown): string
  /**
   * The refusal for a switch on an entry the catalog does not hold.
   * @returns the error to throw.
   */
  unknownEntry(): Error
  /**
   * Project one catalog row for a reader.
   * @param row - the catalog row.
   * @param resource - the governed resource registered for it.
   * @returns the capability's catalog entry.
   */
  entry(row: Row, resource: ManagedResource): Entry
}

/** One member-facing audit record; the engine adds the principal's identity fields. */
export interface MemberRecord {
  readonly action: AuditActionName
  readonly outcome: AuditOutcome
  /** The governed reference acted on, absent when the request named none this build could read. */
  readonly resourceId?: string | undefined
  /** Required reading for a refusal. */
  readonly reason?: AuditReason | undefined
  /** Catalog keys the action declares; entries whose value is undefined are left out. */
  readonly metadata: Readonly<Partial<Record<MetadataKey, number | string | undefined>>>
}

/** What one capability's schema module hands the shared schema check. */
export interface CatalogSchema {
  /** Plugin name, used to prefix refusals. */
  readonly name: string
  /** The `application_id` pragma value reserved for the capability's databases. */
  readonly applicationId: number
  /** The physical schema version this build writes. */
  readonly version: number
  /** `CREATE ... IF NOT EXISTS` statements for every table and index. */
  readonly ddl: string
}
