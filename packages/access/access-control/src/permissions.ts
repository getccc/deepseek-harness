/**
 * The permission catalog: every `(resourceType, action)` pair this build
 * governs, seeded from code.
 *
 * Administrators compose roles out of these pairs; they cannot invent a
 * permission string or upload policy code. A pair that is not here is not a
 * permission, so a typo in a grant fails loudly where the grant is written
 * instead of silently admitting or refusing when a request arrives.
 * @module @deepseek-ai/dsh-access-control/permissions
 */

/** One governed capability. */
export interface Permission {
  /** The kind of thing acted upon; grants and resources are keyed by it. */
  readonly resourceType: string
  /** The fully-qualified action name, as an audit record spells it. */
  readonly action: string
}

/**
 * Every permission this build governs.
 *
 * Action names are fully qualified and need not repeat their resource type
 * verbatim — `mcp_server` carries `mcp.server.connect` — because the type is
 * what a grant matches on while the action is what a person reads in an audit
 * row.
 */
export const PERMISSION_CATALOG: readonly Permission[] = [
  { resourceType: 'organization', action: 'organization.admin.access' },
  { resourceType: 'organization', action: 'organization.read' },
  { resourceType: 'organization', action: 'organization.settings.manage' },
  { resourceType: 'organization', action: 'organization.audit.read' },
  { resourceType: 'member', action: 'member.read' },
  { resourceType: 'member', action: 'member.create' },
  { resourceType: 'member', action: 'member.update' },
  { resourceType: 'member', action: 'member.delete' },
  { resourceType: 'member', action: 'member.disable' },
  { resourceType: 'member', action: 'member.enable' },
  { resourceType: 'member', action: 'member.password.reset' },
  { resourceType: 'member', action: 'member.role.bind' },
  { resourceType: 'department', action: 'department.read' },
  { resourceType: 'department', action: 'department.manage' },
  { resourceType: 'role', action: 'role.read' },
  { resourceType: 'role', action: 'role.create' },
  { resourceType: 'role', action: 'role.update' },
  { resourceType: 'role', action: 'role.delete' },
  { resourceType: 'role', action: 'role.grant.manage' },
  { resourceType: 'menu', action: 'menu.manage' },
  { resourceType: 'device', action: 'device.inventory.read' },
  { resourceType: 'device', action: 'device.revoke' },
  { resourceType: 'model', action: 'model.discover' },
  { resourceType: 'model', action: 'model.invoke' },
  { resourceType: 'model', action: 'model.catalog.read' },
  { resourceType: 'model', action: 'model.catalog.manage' },
  { resourceType: 'mcp_server', action: 'mcp.server.discover' },
  { resourceType: 'mcp_server', action: 'mcp.server.connect' },
  { resourceType: 'mcp_tool', action: 'mcp.tool.discover' },
  { resourceType: 'mcp_tool', action: 'mcp.tool.call' },
  { resourceType: 'knowledge_scope', action: 'knowledge.search' },
  { resourceType: 'knowledge_scope', action: 'knowledge.read' },
  { resourceType: 'knowledge_scope', action: 'knowledge.download' },
  { resourceType: 'knowledge_scope', action: 'knowledge.catalog.read' },
  { resourceType: 'knowledge_scope', action: 'knowledge.catalog.manage' },
  { resourceType: 'plugin', action: 'plugin.discover' },
  { resourceType: 'plugin', action: 'plugin.download' },
  { resourceType: 'plugin', action: 'plugin.use' },
  { resourceType: 'skill', action: 'skill.discover' },
  { resourceType: 'skill', action: 'skill.download' },
  { resourceType: 'skill', action: 'skill.use' },
  { resourceType: 'usage', action: 'usage.own.read' },
  { resourceType: 'usage', action: 'usage.organization.read' },
]

const REGISTERED = new Set(PERMISSION_CATALOG.map(entry => `${entry.resourceType} ${entry.action}`))

/**
 * Whether a pair is one this build governs.
 * @param resourceType - the kind of thing acted upon.
 * @param action - the fully-qualified action name.
 * @returns true when the catalog registers that pair.
 */
export function isRegisteredPermission(resourceType: string, action: string): boolean {
  return REGISTERED.has(`${resourceType} ${action}`)
}

/** Every resource type the catalog governs, in catalog order without repeats. */
export const GOVERNED_RESOURCE_TYPES: readonly string[] =
  [...new Set(PERMISSION_CATALOG.map(entry => entry.resourceType))]
