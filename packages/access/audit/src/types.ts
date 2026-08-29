/**
 * Audit vocabulary shared by every provider and consumer.
 * @module @deepseek-ai/dsh-audit/types
 */

import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type { AuditActionName } from './actions.ts'
import type { AuditMetadata } from './metadata.ts'
import type { AUDIT_OUTCOMES, AUDIT_REASONS } from './vocabulary.ts'

/** How an audited operation ended. */
export type AuditOutcome = typeof AUDIT_OUTCOMES[number]

/**
 * Why an operation was refused, from a closed set.
 *
 * A refusal reason is the one place a reader most wants a sentence, and the one
 * place a sentence is most likely to quote the request. These words carry the
 * diagnosis instead; the request itself stays on the member's machine.
 */
export type AuditReason = typeof AUDIT_REASONS[number]

/**
 * What a caller asks the audit service to record.
 *
 * Every optional string is a short token, not prose: {@link AUDIT_TOKEN} bounds
 * `resourceId`, `deviceId`, and `correlationId` alike, so none of them can
 * carry a path, a query, or a message.
 */
export interface AuditRecord {
  readonly orgId: OrgId
  /** An operation from the action catalog, which also fixes the resource type. */
  readonly action: AuditActionName
  readonly outcome: AuditOutcome
  /** The account that acted, absent when the operation failed before identifying one. */
  readonly principalId?: UserId
  /** The owning subsystem's identifier for what was acted on. */
  readonly resourceId?: string
  /** The device the operation arrived from, when one is bound to it. */
  readonly deviceId?: string
  /** Opaque correlation for the session the operation belongs to; never a local session id. */
  readonly correlationId?: string
  /** Required reading for a refusal; meaningless on an allowed outcome. */
  readonly reason?: AuditReason
  /** The organization policy revision an authorization was computed against. */
  readonly policyRevision?: bigint
  /** Catalog keys the action declares, and nothing else. */
  readonly metadata?: AuditMetadata
}

/** One stored audit event: what a caller recorded, plus what the store assigned. */
export interface AuditEvent extends AuditRecord {
  /** Position in the organization's append-only sequence, ascending, gap-free per store. */
  readonly seq: bigint
  /** When the store accepted the record, in epoch milliseconds. */
  readonly at: number
  /** Taken from the action catalog, never from the caller. */
  readonly resourceType: string
  readonly metadata: AuditMetadata
}

/**
 * Which events to read back. Every field but the organization narrows;
 * omitting them all reads the organization's most recent events.
 */
export interface AuditQuery {
  readonly orgId: OrgId
  readonly principalId?: UserId
  readonly action?: AuditActionName
  readonly resourceType?: string
  readonly outcome?: AuditOutcome
  /** Inclusive lower bound on {@link AuditEvent.at}, in epoch milliseconds. */
  readonly since?: number
  /** Exclusive upper bound on {@link AuditEvent.at}, in epoch milliseconds. */
  readonly until?: number
  /** Read the page before this sequence number, for paging backwards through history. */
  readonly before?: bigint
  /** At most this many events; the store's configured maximum still applies. */
  readonly limit?: number
}
