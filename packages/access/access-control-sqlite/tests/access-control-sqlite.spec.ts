/**
 * The evaluation rules, exercised against a real account store because the
 * policy revision a decision quotes lives with the organization, not here.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DuplicateRoleNameError,
  UnknownPermissionError,
  UnknownRoleError,
  type AccessControl,
  type GroupId,
  type ResourceId,
  type RoleId,
} from '@deepseek-ai/dsh-access-control'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import { UserId, type AccountStore, type OrgId } from '@deepseek-ai/dsh-account-store'
import SqliteAccessControl, { ACCESS_CONTROL_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from '../src/index.ts'
import { applySchema } from '../src/schema.ts'

let ctx: Context
let store: AccountStore
let access: AccessControl
let orgId: OrgId
let alice: UserId

/** A request for one action on one governed resource, as a gateway would ask. */
function ask(action: string, resourceType: string, resourceId: string, principalId = alice) {
  return { orgId, principalId, action, resourceType, resourceId }
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SqliteAccountStore, { path: ':memory:' }).await()
  await ctx.plugin(SqliteAccessControl, { path: ':memory:' }).await()
  store = ctx.get('accountStore') as AccountStore
  access = ctx.get('accessControl') as AccessControl
  orgId = (await store.createOrganization('Acme')).id
  alice = (await store.createUser({ orgId, loginName: 'alice', displayName: 'Alice' })).id
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('default deny', () => {
  it('refuses a principal with no roles at all', async () => {
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    expect(await access.authorize(ask('model.invoke', 'model', 'v4')))
      .toMatchObject({ allowed: false, reason: 'default-deny', matchedGrantIds: [] })
  })

  it('refuses a principal whose roles carry no matching grant', async () => {
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const role = await access.createRole({ orgId, name: 'reader' })
    await access.bindUserRole(alice, role.id)
    expect(await access.authorize(ask('model.invoke', 'model', 'v4')))
      .toMatchObject({ allowed: false, reason: 'no-grant' })
  })

  it('answers an unknown resource exactly as an ungranted one', async () => {
    const role = await access.createRole({ orgId, name: 'reader' })
    await access.bindUserRole(alice, role.id)
    // Absent and unauthorized are one answer, so a refusal never confirms that
    // a resource exists to a principal who holds nothing on it.
    expect(await access.authorize(ask('model.invoke', 'model', 'no-such-model')))
      .toMatchObject({ allowed: false, reason: 'no-grant' })
  })

  it('refuses everything for an organization it does not hold', async () => {
    expect(await access.authorize({
      orgId: 'missing' as OrgId, principalId: alice,
      action: 'model.invoke', resourceType: 'model', resourceId: 'v4',
    })).toMatchObject({ allowed: false, reason: 'default-deny', policyRevision: 0n })
  })
})

describe('grants', () => {
  let modelId: ResourceId
  let otherId: ResourceId
  let role: RoleId

  beforeEach(async () => {
    modelId = (await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })).id
    otherId = (await access.registerResource({ orgId, type: 'model', externalRef: 'pro', displayName: 'Pro' })).id
    role = (await access.createRole({ orgId, name: 'engineering' })).id
    await access.bindUserRole(alice, role)
  })

  it('admits through a type grant, and names the grant that did it', async () => {
    const grant = await access.grantType(role, 'model', 'model.invoke')
    const decision = await access.authorize(ask('model.invoke', 'model', 'v4'))
    expect(decision).toMatchObject({ allowed: true, reason: 'allowed' })
    expect(decision.matchedGrantIds).toEqual([grant])
    // A type grant covers every resource of that type, including ones governed
    // after the grant was written.
    expect(await access.authorize(ask('model.invoke', 'model', 'pro'))).toMatchObject({ allowed: true })
  })

  it('admits through a resource grant, and only for that resource', async () => {
    await access.grantResource(role, modelId, 'model.invoke')
    expect(await access.authorize(ask('model.invoke', 'model', 'v4'))).toMatchObject({ allowed: true })
    expect(await access.authorize(ask('model.invoke', 'model', 'pro')))
      .toMatchObject({ allowed: false, reason: 'no-grant' })
  })

  it('keeps each action separate', async () => {
    await access.grantType(role, 'model', 'model.discover')
    expect(await access.authorize(ask('model.discover', 'model', 'v4'))).toMatchObject({ allowed: true })
    expect(await access.authorize(ask('model.invoke', 'model', 'v4')))
      .toMatchObject({ allowed: false, reason: 'no-grant' })
  })

  it('withdraws a grant, and treats withdrawing an absent one as done', async () => {
    const grant = await access.grantResource(role, otherId, 'model.invoke')
    await access.revokeGrant(grant)
    expect(await access.authorize(ask('model.invoke', 'model', 'pro')))
      .toMatchObject({ allowed: false, reason: 'no-grant' })
    await expect(access.revokeGrant(grant)).resolves.toBeUndefined()
  })

  it('lists type and resource grants with the resource identity an administrator needs', async () => {
    const typeGrant = await access.grantType(role, 'model', 'model.discover')
    const resourceGrant = await access.grantResource(role, modelId, 'model.invoke')
    expect(await access.listRoleGrants(role)).toEqual([
      {
        id: typeGrant, roleId: role, kind: 'type',
        resourceType: 'model', action: 'model.discover',
      },
      {
        id: resourceGrant, roleId: role, kind: 'resource', resourceId: modelId,
        resourceType: 'model', resourceDisplayName: 'V4', action: 'model.invoke',
      },
    ])
  })

  it('refuses a grant naming a pair the catalog does not govern', async () => {
    await expect(access.grantType(role, 'model', 'model.delete-everything'))
      .rejects.toBeInstanceOf(UnknownPermissionError)
    await expect(access.grantType(role, 'spaceship', 'model.invoke'))
      .rejects.toBeInstanceOf(UnknownPermissionError)
    await expect(access.grantResource(role, modelId, 'knowledge.search'))
      .rejects.toBeInstanceOf(UnknownPermissionError)
  })

  it('refuses a grant or binding naming a role that does not exist', async () => {
    const ghost = 'no-such-role' as RoleId
    await expect(access.grantType(ghost, 'model', 'model.invoke')).rejects.toBeInstanceOf(UnknownRoleError)
    await expect(access.grantResource(ghost, modelId, 'model.invoke')).rejects.toBeInstanceOf(UnknownRoleError)
    await expect(access.bindUserRole(alice, ghost)).rejects.toBeInstanceOf(UnknownRoleError)
  })

  it('is idempotent: granting the same pair twice yields one grant', async () => {
    const first = await access.grantType(role, 'model', 'model.invoke')
    const second = await access.grantType(role, 'model', 'model.invoke')
    expect(second).toBe(first)
    expect((await access.authorize(ask('model.invoke', 'model', 'v4'))).matchedGrantIds).toEqual([first])
  })
})

describe('several roles', () => {
  it('takes the union, so one role admitting is enough', async () => {
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const reader = await access.createRole({ orgId, name: 'reader' })
    const invoker = await access.createRole({ orgId, name: 'invoker' })
    await access.grantType(reader.id, 'model', 'model.discover')
    const grant = await access.grantType(invoker.id, 'model', 'model.invoke')
    await access.bindUserRole(alice, reader.id)
    await access.bindUserRole(alice, invoker.id)

    // No role denies: there is no explicit deny, so holding a role that lacks
    // the action never subtracts from one that has it.
    const decision = await access.authorize(ask('model.invoke', 'model', 'v4'))
    expect(decision.allowed).toBe(true)
    expect(decision.matchedGrantIds).toEqual([grant])
  })

  it('stops admitting once the admitting role is unbound', async () => {
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const role = await access.createRole({ orgId, name: 'invoker' })
    await access.grantType(role.id, 'model', 'model.invoke')
    await access.bindUserRole(alice, role.id)
    await access.unbindUserRole(alice, role.id)
    expect(await access.authorize(ask('model.invoke', 'model', 'v4')))
      .toMatchObject({ allowed: false, reason: 'default-deny' })
  })
})

describe('groups', () => {
  it('bind roles in bulk and change nothing about how a request is evaluated', async () => {
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const role = await access.createRole({ orgId, name: 'invoker' })
    const grant = await access.grantType(role.id, 'model', 'model.invoke')
    const group = await access.createGroup(orgId, 'engineering')
    await access.bindGroupRole(group.id, role.id)
    await access.addGroupMember(group.id, alice)

    const decision = await access.authorize(ask('model.invoke', 'model', 'v4'))
    // Identical to a direct binding, down to the grant named.
    expect(decision).toMatchObject({ allowed: true, reason: 'allowed' })
    expect(decision.matchedGrantIds).toEqual([grant])
    expect(await access.rolesOf(alice)).toEqual([role.id])
  })

  it('does not double-count a role held both directly and through a group', async () => {
    const role = await access.createRole({ orgId, name: 'invoker' })
    const group = await access.createGroup(orgId, 'engineering')
    await access.bindGroupRole(group.id, role.id)
    await access.addGroupMember(group.id, alice)
    await access.bindUserRole(alice, role.id)
    expect(await access.rolesOf(alice)).toEqual([role.id])
  })
})

describe('a disabled resource', () => {
  it('is refused whatever any grant says', async () => {
    const resource = await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const role = await access.createRole({ orgId, name: 'invoker' })
    await access.grantType(role.id, 'model', 'model.invoke')
    await access.bindUserRole(alice, role.id)
    expect(await access.authorize(ask('model.invoke', 'model', 'v4'))).toMatchObject({ allowed: true })

    await access.setResourceEnabled(resource.id, false)
    expect(await access.authorize(ask('model.invoke', 'model', 'v4')))
      .toMatchObject({ allowed: false, reason: 'resource-disabled', matchedGrantIds: [] })

    await access.setResourceEnabled(resource.id, true)
    expect(await access.authorize(ask('model.invoke', 'model', 'v4'))).toMatchObject({ allowed: true })
  })
})

describe('administrative roles are not a master key', () => {
  it('leaves company resources refused to a role that only manages members', async () => {
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const admin = await access.createRole({ orgId, name: 'admin', kind: 'system' })
    await access.grantType(admin.id, 'member', 'member.create')
    await access.grantType(admin.id, 'device', 'device.revoke')
    await access.bindUserRole(alice, admin.id)

    expect(await access.authorize(ask('model.invoke', 'model', 'v4')))
      .toMatchObject({ allowed: false, reason: 'no-grant' })
  })
})

describe('knowledge scopes', () => {
  it('carries the scope a knowledge request was allowed on, and nothing for other types', async () => {
    await access.registerResource({
      orgId, type: 'knowledge_scope', externalRef: 'engineering.docs', displayName: 'Engineering docs',
    })
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const role = await access.createRole({ orgId, name: 'engineering' })
    await access.grantType(role.id, 'knowledge_scope', 'knowledge.search')
    await access.grantType(role.id, 'model', 'model.invoke')
    await access.bindUserRole(alice, role.id)

    expect((await access.authorize(ask('knowledge.search', 'knowledge_scope', 'engineering.docs'))).scopes)
      .toEqual(['engineering.docs'])
    expect((await access.authorize(ask('model.invoke', 'model', 'v4'))).scopes).toEqual([])
  })

  it('returns different data to two roles through the same request shape', async () => {
    const bob = (await store.createUser({ orgId, loginName: 'bob', displayName: 'Bob' })).id
    for (const ref of ['engineering.docs', 'finance.ledger']) {
      await access.registerResource({ orgId, type: 'knowledge_scope', externalRef: ref, displayName: ref })
    }
    const engineering = await access.createRole({ orgId, name: 'engineering' })
    const finance = await access.createRole({ orgId, name: 'finance' })
    await access.grantResource(
      engineering.id,
      (await access.listResources(orgId, 'knowledge_scope')).find(r => r.externalRef === 'engineering.docs')!.id,
      'knowledge.search',
    )
    await access.grantResource(
      finance.id,
      (await access.listResources(orgId, 'knowledge_scope')).find(r => r.externalRef === 'finance.ledger')!.id,
      'knowledge.search',
    )
    await access.bindUserRole(alice, engineering.id)
    await access.bindUserRole(bob, finance.id)

    // Same action, same resource type, same call shape: only the principal differs.
    expect(await access.authorize(ask('knowledge.search', 'knowledge_scope', 'engineering.docs', alice)))
      .toMatchObject({ allowed: true })
    expect(await access.authorize(ask('knowledge.search', 'knowledge_scope', 'finance.ledger', alice)))
      .toMatchObject({ allowed: false })
    expect(await access.authorize(ask('knowledge.search', 'knowledge_scope', 'finance.ledger', bob)))
      .toMatchObject({ allowed: true })
  })
})

describe('the policy revision a decision quotes', () => {
  it('advances on every change that can alter an outcome', async () => {
    const revision = async (): Promise<bigint> => (await store.getOrganization(orgId))!.policyRevision
    const seen: bigint[] = [await revision()]

    const resource = await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    seen.push(await revision())
    const role = await access.createRole({ orgId, name: 'invoker' })
    seen.push(await revision())
    const grant = await access.grantType(role.id, 'model', 'model.invoke')
    seen.push(await revision())
    await access.bindUserRole(alice, role.id)
    seen.push(await revision())
    await access.setResourceEnabled(resource.id, false)
    seen.push(await revision())
    await access.revokeGrant(grant)
    seen.push(await revision())

    // Strictly increasing: a cache keyed on this value can tell stale from old.
    expect(seen).toEqual([0n, 1n, 2n, 3n, 4n, 5n, 6n])
    expect((await access.authorize(ask('model.invoke', 'model', 'v4'))).policyRevision).toBe(6n)
  })

  it('does not advance for a group that binds no role', async () => {
    const before = (await store.getOrganization(orgId))!.policyRevision
    await access.createGroup(orgId, 'engineering')
    expect((await store.getOrganization(orgId))!.policyRevision).toBe(before)
  })
})

describe('roles and resources', () => {
  it('refuses a duplicate role name inside one organization', async () => {
    await access.createRole({ orgId, name: 'engineering' })
    await expect(access.createRole({ orgId, name: 'engineering' }))
      .rejects.toBeInstanceOf(DuplicateRoleNameError)
  })

  it('lists roles and resources in creation order', async () => {
    await access.createRole({ orgId, name: 'first' })
    await access.createRole({ orgId, name: 'second' })
    expect((await access.listRoles(orgId)).map(role => role.name)).toEqual(['first', 'second'])

    await access.registerResource({ orgId, type: 'model', externalRef: 'a', displayName: 'A' })
    await access.registerResource({ orgId, type: 'model', externalRef: 'b', displayName: 'B' })
    expect((await access.listResources(orgId, 'model')).map(r => r.externalRef)).toEqual(['a', 'b'])
    expect(await access.listResources(orgId, 'plugin')).toEqual([])
  })

  it('re-registers a resource in place, keeping the id its grants point at', async () => {
    const first = await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    // The owning subsystem re-registers its catalog on every start; a renamed
    // display must not orphan the grants already written against the resource.
    const again = await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4 Turbo' })
    expect(again.id).toBe(first.id)
    expect(again.displayName).toBe('V4 Turbo')
    expect(await access.listResources(orgId, 'model')).toHaveLength(1)
  })

  it('does not advance policy when an owner re-registers an unchanged resource', async () => {
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    const before = (await store.getOrganization(orgId))!.policyRevision
    await access.registerResource({ orgId, type: 'model', externalRef: 'v4', displayName: 'V4' })
    expect((await store.getOrganization(orgId))!.policyRevision).toBe(before)
  })

  it('refuses to govern a resource of a type no permission covers', async () => {
    await expect(access.registerResource({
      orgId, type: 'spaceship', externalRef: 'x', displayName: 'X',
    })).rejects.toBeInstanceOf(UnknownPermissionError)
  })
})

describe('operations that name something absent', () => {
  it('accepts enabling a resource the catalog does not hold, changing nothing', async () => {
    await expect(access.setResourceEnabled('missing' as ResourceId, false)).resolves.toBeUndefined()
    expect(await access.listResources(orgId, 'model')).toEqual([])
  })

  it('refuses a resource grant on a resource that does not exist', async () => {
    const role = await access.createRole({ orgId, name: 'reader' })
    await expect(access.grantResource(role.id, 'missing' as ResourceId, 'model.invoke'))
      .rejects.toBeInstanceOf(UnknownPermissionError)
  })

  it('accepts unbinding a pair that is not bound', async () => {
    const role = await access.createRole({ orgId, name: 'reader' })
    await expect(access.unbindUserRole(alice, role.id)).resolves.toBeUndefined()
    expect(await access.rolesOf(alice)).toEqual([])
  })

  it('refuses to add a member to a group that does not exist', async () => {
    await expect(access.addGroupMember('missing' as GroupId, alice)).rejects.toThrow(/unknown group/u)
  })
})

describe('opening a database', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-access-'))
    path = join(dir, 'access.sqlite')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('stamps the application id and schema version', () => {
    const db = new DatabaseSync(path)
    applySchema(db)
    expect((db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id)
      .toBe(ACCESS_CONTROL_SQLITE_APPLICATION_ID)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('refuses a file another application owns', () => {
    const db = new DatabaseSync(path)
    db.exec('PRAGMA application_id = 12345')
    expect(() => { applySchema(db) }).toThrow(/another application/u)
    db.close()
  })

  it('refuses a database a newer build wrote', () => {
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${ACCESS_CONTROL_SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => { applySchema(db) }).toThrow(/newer than this build/u)
    db.close()
  })

  it('lets a storage failure that is not a duplicate name through unchanged', async () => {
    const fiber = new Context()
    await fiber.plugin(SqliteAccountStore, { path: ':memory:' }).await()
    await fiber.plugin(SqliteAccessControl, { path }).await()
    const control = fiber.get('accessControl') as AccessControl
    const org = (await (fiber.get('accountStore') as AccountStore).createOrganization('Acme')).id
    const db = new DatabaseSync(path)
    db.exec('DROP TABLE role')
    db.close()
    await expect(control.createRole({ orgId: org, name: 'reader' })).rejects.toThrow(/no such table/u)
    await fiber.fiber.dispose()
  })
})
