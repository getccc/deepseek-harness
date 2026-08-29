/**
 * The audit seam: one service that records what a principal did to a company
 * resource, and reads those records back.
 *
 * An audit trail proves that company resources and administrative operations
 * were authorized. It is not a copy of anyone's work, so this service is built
 * so that a member's task content has nowhere to land: the columns are fixed,
 * the actions are a closed catalog, and the only caller-chosen values are
 * metadata keys whose kinds admit a count, a listed word, or a short token.
 * @module @deepseek-ai/dsh-audit
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditQuery, AuditRecord } from './types.ts'

export {
  AUDIT_ACTIONS,
  AUDIT_RESOURCE_TYPES,
  isAuditAction,
  type AuditActionName,
  type AuditActionSpec,
} from './actions.ts'
export {
  AUDIT_TOKEN,
  METADATA_KEYS,
  isAuditToken,
  satisfiesSpec,
  type AuditMetadata,
  type MetadataKey,
  type MetadataSpec,
} from './metadata.ts'
export type {
  AuditEvent,
  AuditOutcome,
  AuditQuery,
  AuditReason,
  AuditRecord,
} from './types.ts'
export {
  InvalidAuditValueError,
  MetadataKeyNotAllowedError,
  UnknownAuditActionError,
  UnknownMetadataKeyError,
  checkAuditRecord,
} from './validate.ts'
export { AUDIT_OUTCOMES, AUDIT_REASONS } from './vocabulary.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    audit: Audit
  }
}

/**
 * The audit trail. A provider mounts this service; consumers inject `audit`.
 *
 * Records are append-only: there is no method to amend or remove one, and a
 * store is expected to refuse both at the database as well. A reader who
 * cannot rewrite history is what makes the trail worth reading.
 */
export abstract class Audit extends Service {
  constructor(ctx: Context) {
    super(ctx, 'audit')
  }

  /**
   * Record one operation. The store assigns the sequence number and the time,
   * so a caller can neither backdate an entry nor choose its order.
   * @param record - what happened: the action, its outcome, and who and what it involved.
   * @returns the stored event, including what the store assigned.
   * @throws {UnknownAuditActionError} when the action catalog does not register the action.
   * @throws {InvalidAuditValueError} when a field holds a value its rule does not admit.
   * @throws {UnknownMetadataKeyError} when metadata names an unregistered key.
   * @throws {MetadataKeyNotAllowedError} when the action does not declare a registered key.
   */
  abstract record(record: AuditRecord): Promise<AuditEvent>

  /**
   * Read events back, most recent first.
   * @param query - the organization to read, and any narrowing the reader wants.
   * @returns the matching events, newest first, bounded by the store's configured maximum.
   */
  abstract query(query: AuditQuery): Promise<AuditEvent[]>
}
