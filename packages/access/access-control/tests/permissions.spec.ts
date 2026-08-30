/**
 * The permission catalog is the closed set an administrator composes roles
 * from. These pin what it contains and that nothing outside it counts.
 */

import { describe, expect, it } from 'vitest'
import {
  GOVERNED_RESOURCE_TYPES,
  PERMISSION_CATALOG,
  UnknownPermissionError,
  UnknownRoleError,
  isRegisteredPermission,
  RoleId,
} from '../src/index.ts'

describe('the permission catalog', () => {
  it('governs exactly the resource types Team Edition authorizes', () => {
    expect([...GOVERNED_RESOURCE_TYPES].sort()).toEqual([
      'device', 'knowledge_scope', 'mcp_server', 'mcp_tool',
      'member', 'model', 'organization', 'plugin', 'role', 'skill', 'usage',
    ])
  })

  it('registers each pair once', () => {
    const pairs = PERMISSION_CATALOG.map(entry => `${entry.resourceType} ${entry.action}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('answers only for pairs it holds, matching type and action together', () => {
    expect(isRegisteredPermission('model', 'model.invoke')).toBe(true)
    // A real action against the wrong type is not a permission: the pair is
    // what a grant matches on.
    expect(isRegisteredPermission('plugin', 'model.invoke')).toBe(false)
    expect(isRegisteredPermission('model', 'model.delete')).toBe(false)
    expect(isRegisteredPermission('spaceship', 'model.invoke')).toBe(false)
  })
})

describe('access-control errors', () => {
  it('names the pair a rejected grant asked for', () => {
    const error = new UnknownPermissionError('spaceship', 'model.invoke')
    expect(error.name).toBe('UnknownPermissionError')
    expect(error.message).toBe('no permission "model.invoke" on resource type "spaceship"')
  })

  it('names the role an operation could not find', () => {
    const error = new UnknownRoleError(RoleId('role-1'))
    expect(error.name).toBe('UnknownRoleError')
    expect(error.roleId).toBe('role-1')
  })
})
