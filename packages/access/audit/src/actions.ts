/**
 * The audit action catalog: every operation this build records, the kind of
 * thing each one acts on, and the metadata keys each one may carry.
 *
 * A caller names an action; it does not name a resource type. The type comes
 * from this table, so a record cannot describe a role change as a device event.
 * The per-action metadata list is the second half of the same idea: a login
 * carries how the member authenticated and nothing else, so an unrelated key
 * cannot ride along on an operation nobody expected to carry it.
 * @module @deepseek-ai/dsh-audit/actions
 */

import type { MetadataKey } from './metadata.ts'

/** What one audited operation acts on and may record. */
export interface AuditActionSpec {
  /** The kind of thing acted upon, as a query filters on it. */
  readonly resourceType: string
  /** The metadata keys this operation may carry, in full. */
  readonly metadata: readonly MetadataKey[]
}

/**
 * Every operation this build audits.
 *
 * The list covers what the Control Plane can do today: authenticate members,
 * manage browser sessions and devices, issue and withdraw credentials, and
 * change policy. Company-resource actions — model calls, knowledge queries,
 * plugin downloads — arrive with the gateways that perform them, because an
 * action nothing records is an entry no reader can trust.
 */
export const AUDIT_ACTIONS = {
  'member.login': { resourceType: 'member', metadata: ['authMethod'] },
  'member.logout': { resourceType: 'member', metadata: [] },
  'member.create': { resourceType: 'member', metadata: [] },
  'member.disable': { resourceType: 'member', metadata: [] },
  'member.enable': { resourceType: 'member', metadata: [] },
  'browser_session.revoke': { resourceType: 'browser_session', metadata: [] },
  'device.bind': { resourceType: 'device', metadata: ['platform', 'runnerVersion'] },
  'device.revoke': { resourceType: 'device', metadata: [] },
  'credential.issue': { resourceType: 'credential', metadata: ['credentialKind'] },
  'credential.rotate': { resourceType: 'credential', metadata: ['credentialKind'] },
  'credential.revoke': { resourceType: 'credential', metadata: ['credentialKind'] },
  'role.create': { resourceType: 'role', metadata: [] },
  'role.delete': { resourceType: 'role', metadata: [] },
  'grant.add': { resourceType: 'grant', metadata: [] },
  'grant.revoke': { resourceType: 'grant', metadata: [] },
  'binding.add': { resourceType: 'binding', metadata: [] },
  'binding.remove': { resourceType: 'binding', metadata: [] },
  'resource.register': { resourceType: 'managed_resource', metadata: [] },
  'resource.enable': { resourceType: 'managed_resource', metadata: [] },
  'resource.disable': { resourceType: 'managed_resource', metadata: [] },
  'policy.update': { resourceType: 'organization', metadata: [] },
  'audit.export': { resourceType: 'organization', metadata: ['itemCount'] },
} as const satisfies Record<string, AuditActionSpec>

/** An operation the action catalog registers. */
export type AuditActionName = keyof typeof AUDIT_ACTIONS

/**
 * Whether a string is an action this build audits.
 * @param action - the candidate action name.
 * @returns true when the catalog registers it, narrowing the argument.
 */
export function isAuditAction(action: string): action is AuditActionName {
  return Object.hasOwn(AUDIT_ACTIONS, action)
}

/** Every resource type the action catalog names, in catalog order without repeats. */
export const AUDIT_RESOURCE_TYPES: readonly string[] =
  [...new Set(Object.values(AUDIT_ACTIONS).map(spec => spec.resourceType))]
