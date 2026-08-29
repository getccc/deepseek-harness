/**
 * The rule an audit record must satisfy before a store may hold it.
 *
 * This is where the privacy claim becomes a check. A record has no free-text
 * field by construction, and this function proves the remaining fields keep
 * that true: the action is one the catalog knows, each token is short and
 * plain, and each metadata key is one the action declares with a value its kind
 * admits. A store calls it before its first write, and its schema declares the
 * same rules again so a caller that reached the database directly is refused
 * too.
 * @module @deepseek-ai/dsh-audit/validate
 */

import { AUDIT_ACTIONS, isAuditAction } from './actions.ts'
import { METADATA_KEYS, isAuditToken, satisfiesSpec, type MetadataKey } from './metadata.ts'
import type { AuditRecord } from './types.ts'

/** Raised when a record names an operation this build does not audit. */
export class UnknownAuditActionError extends Error {
  constructor(readonly action: string) {
    super(`no audited action ${JSON.stringify(action)}`)
    this.name = 'UnknownAuditActionError'
  }
}

/** Raised when metadata names a key the catalog does not register. */
export class UnknownMetadataKeyError extends Error {
  constructor(readonly key: string) {
    super(`no audit metadata key ${JSON.stringify(key)}`)
    this.name = 'UnknownMetadataKeyError'
  }
}

/** Raised when a registered key is not one the action declares. */
export class MetadataKeyNotAllowedError extends Error {
  constructor(readonly action: string, readonly key: string) {
    super(`action ${JSON.stringify(action)} does not carry metadata key ${JSON.stringify(key)}`)
    this.name = 'MetadataKeyNotAllowedError'
  }
}

/** Raised when a field's value is not one its rule admits. */
export class InvalidAuditValueError extends Error {
  constructor(readonly field: string) {
    super(`audit field ${JSON.stringify(field)} holds a value its rule does not admit`)
    this.name = 'InvalidAuditValueError'
  }
}

/** The record fields bounded by {@link isAuditToken}. */
const TOKEN_FIELDS = ['resourceId', 'deviceId', 'correlationId'] as const

/**
 * Check one record against the catalogs and the value rules.
 *
 * Returns the problem rather than throwing it, so a store whose `record` method
 * is asynchronous can reject with it. A check that threw here would escape a
 * caller's `catch` on the returned promise.
 * @param record - the record a caller wants stored.
 * @returns the error explaining why the record is inadmissible, or undefined when it may be stored.
 */
export function checkAuditRecord(record: AuditRecord): Error | undefined {
  if (!isAuditAction(record.action)) return new UnknownAuditActionError(record.action)
  for (const field of TOKEN_FIELDS) {
    const value = record[field]
    if (value !== undefined && !isAuditToken(value)) return new InvalidAuditValueError(field)
  }
  const allowed: readonly MetadataKey[] = AUDIT_ACTIONS[record.action].metadata
  for (const [key, value] of Object.entries(record.metadata ?? {})) {
    if (!Object.hasOwn(METADATA_KEYS, key)) return new UnknownMetadataKeyError(key)
    const registered = key as MetadataKey
    if (!allowed.includes(registered)) return new MetadataKeyNotAllowedError(record.action, key)
    if (!satisfiesSpec(METADATA_KEYS[registered], value)) return new InvalidAuditValueError(key)
  }
  return undefined
}
