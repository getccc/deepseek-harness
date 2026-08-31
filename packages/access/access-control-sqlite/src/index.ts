/**
 * SQLite-backed access control: roles, grants, governed resources, and the
 * default-deny evaluation over them.
 * @module @deepseek-ai/dsh-access-control-sqlite
 */

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  AccessControl,
  PERMISSION_CATALOG,
  DuplicateRoleCodeError,
  DuplicateRoleNameError,
  GOVERNED_RESOURCE_TYPES,
  GrantId,
  GroupId,
  ResourceId,
  RoleId,
  SystemRoleError,
  UnknownPermissionError,
  UnknownRoleError,
  isRegisteredPermission,
  type AccessDecision,
  type AccessRequest,
  type CreateRole,
  type ManagedResource,
  type RegisterResource,
  type Role,
  type RoleGrant,
  type RoleKind,
  type UpdateRole,
  type UserGroup,
} from '@deepseek-ai/dsh-access-control'
import { OrgId, type OrgId as OrgIdType, type UserId } from '@deepseek-ai/dsh-account-store'
import { applySchema, type GroupRow, type ResourceRow, type RoleRow } from './schema.ts'

export { ACCESS_CONTROL_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from './schema.ts'

/** Plugin config: where the database lives. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
}

const DUPLICATE_ROLE = /UNIQUE constraint failed: role\.org_id, role\.name/u

const DUPLICATE_ROLE_CODE = /UNIQUE constraint failed: role\.org_id, role\.code/u

/** A refusal that names no grant and carries no scope. */
function refuse(policyRevision: bigint, reason: AccessDecision['reason']): AccessDecision {
  return { allowed: false, policyRevision, matchedGrantIds: [], scopes: [], reason }
}

function toRole(row: RoleRow): Role {
  return {
    id: RoleId(row.id),
    orgId: OrgId(row.org_id),
    name: row.name,
    code: row.code,
    description: row.description,
    kind: row.kind as RoleKind,
    createdAt: row.created_at ?? undefined,
    coversCatalog: row.covers_catalog !== 0,
  }
}

function toResource(row: ResourceRow): ManagedResource {
  return {
    id: ResourceId(row.id),
    orgId: OrgId(row.org_id),
    type: row.type,
    externalRef: row.external_ref,
    displayName: row.display_name,
    enabled: row.enabled !== 0,
  }
}

/**
 * Access control over one SQLite database.
 *
 * The organization's policy revision lives with the organization, in the
 * account store, so one counter serves every cache rather than each subsystem
 * keeping its own. Every mutation here that can change an outcome advances it.
 */
export class SqliteAccessControl extends AccessControl {
  static inject = ['accountStore']

  static Config: z<Config> = z.object({
    path: z.string().required(),
  })

  private db!: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  /** Open, bring the database to the current schema, and seed the catalog. */
  protected async [Service.init](): Promise<void> {
    const db = new DatabaseSync(this.config.path)
    applySchema(db)
    this.db = db
    this.ctx.effect(() => () => { db.close() }, 'access-control-sqlite.close')
    await Promise.resolve()
  }

  async authorize(request: AccessRequest): Promise<AccessDecision> {
    const org = await this.ctx.accountStore.getOrganization(request.orgId)
    // An organization the store does not hold governs nothing, and a decision
    // still needs a revision to be quoted against: zero is the value before any
    // policy exists.
    if (org === undefined) return refuse(0n, 'default-deny')
    const revision = org.policyRevision

    const principal = await this.ctx.accountStore.getUser(request.principalId)
    if (principal === undefined || principal.orgId !== request.orgId || principal.status !== 'active') {
      return refuse(revision, 'default-deny')
    }

    const resource = this.db.prepare(
      'SELECT * FROM resource WHERE org_id = ? AND type = ? AND external_ref = ?',
    ).get(request.orgId, request.resourceType, request.resourceId) as ResourceRow | undefined
    // Absent and unauthorized answer alike, so a refusal never confirms that a
    // resource exists to a principal who holds nothing on it.
    if (resource === undefined) return refuse(revision, 'no-grant')
    if (resource.enabled === 0) return refuse(revision, 'resource-disabled')

    const roles = await this.rolesOf(request.principalId)
    if (roles.length === 0) return refuse(revision, 'default-deny')

    const placeholders = roles.map(() => '?').join(', ')
    const matched = this.db.prepare(
      `SELECT id FROM role_type_grant
         WHERE role_id IN (${placeholders}) AND resource_type = ? AND action = ?
       UNION
       SELECT id FROM role_resource_grant
         WHERE role_id IN (${placeholders}) AND resource_id = ? AND action = ?`,
    ).all(
      ...roles, request.resourceType, request.action,
      ...roles, resource.id, request.action,
    ) as unknown as { id: string }[]
    if (matched.length === 0) return refuse(revision, 'no-grant')

    return {
      allowed: true,
      policyRevision: revision,
      matchedGrantIds: matched.map(row => GrantId(row.id)),
      // A knowledge request carries the scope it was allowed on, so a gateway
      // can pass it downstream without a second lookup. Assembling several
      // scopes is the gateway's loop over its own authorized list.
      scopes: request.resourceType === 'knowledge_scope' ? [resource.external_ref] : [],
      reason: 'allowed',
    }
  }

  async createRole(input: CreateRole): Promise<Role> {
    const id = randomUUID()
    const row: RoleRow = {
      id,
      org_id: input.orgId,
      name: input.name,
      // A role that names no code still has to be unique against the code
      // index, and its own id is the one value nothing else can hold.
      code: input.code ?? id,
      description: input.description ?? '',
      kind: input.kind ?? 'custom',
      created_at: Date.now(),
      covers_catalog: input.coversCatalog === true ? 1 : 0,
    }
    try {
      this.db.prepare(
        `INSERT INTO role (id, org_id, name, code, description, kind, created_at, covers_catalog)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id, row.org_id, row.name, row.code, row.description, row.kind,
        row.created_at, row.covers_catalog,
      )
    } catch (error) {
      /* v8 ignore next -- node:sqlite rejects with Error; the guard is for the type, not a reachable path */
      if (!(error instanceof Error)) throw new Error(String(error))
      if (DUPLICATE_ROLE.test(error.message)) throw new DuplicateRoleNameError(input.orgId, input.name)
      if (DUPLICATE_ROLE_CODE.test(error.message)) throw new DuplicateRoleCodeError(input.orgId, row.code)
      throw error
    }
    await this.bump(input.orgId)
    return toRole(row)
  }

  async updateRole(roleId: RoleId, changes: UpdateRole): Promise<void> {
    const role = this.role(roleId)
    const written = ([
      ['name', changes.name],
      ['code', changes.code],
      ['description', changes.description],
      ['covers_catalog', changes.coversCatalog === undefined ? undefined : changes.coversCatalog ? 1 : 0],
    ] as const).flatMap(([column, value]) => value === undefined ? [] : [[column, value] as const])
    // Nothing to write is not a failure: the role the caller named is there,
    // and it already reads the way they asked for.
    if (written.length === 0) return
    try {
      this.db.prepare(`UPDATE role SET ${written.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`)
        .run(...written.map(([, value]) => value), roleId)
    } catch (error) {
      /* v8 ignore next -- node:sqlite rejects with Error; the guard is for the type, not a reachable path */
      if (!(error instanceof Error)) throw new Error(String(error))
      const org = OrgId(role.org_id)
      if (DUPLICATE_ROLE.test(error.message)) throw new DuplicateRoleNameError(org, changes.name as string)
      if (DUPLICATE_ROLE_CODE.test(error.message)) throw new DuplicateRoleCodeError(org, changes.code as string)
      throw error
    }
    // A role's readable fields admit nothing, but a grant's display name is read
    // from the role it hangs from, so the revision advances with the rename.
    await this.bump(OrgId(role.org_id))
  }

  async deleteRole(roleId: RoleId): Promise<void> {
    const role = this.role(roleId)
    if (role.kind === 'system') throw new SystemRoleError(roleId)
    // The grants and bindings go first: both reference the role, and leaving
    // either would fail the foreign key rather than delete the role.
    this.db.prepare('DELETE FROM role_type_grant WHERE role_id = ?').run(roleId)
    this.db.prepare('DELETE FROM role_resource_grant WHERE role_id = ?').run(roleId)
    this.db.prepare('DELETE FROM user_role_binding WHERE role_id = ?').run(roleId)
    this.db.prepare('DELETE FROM group_role_binding WHERE role_id = ?').run(roleId)
    this.db.prepare('DELETE FROM role WHERE id = ?').run(roleId)
    await this.bump(OrgId(role.org_id))
  }

  listRoles(orgId: OrgIdType): Promise<Role[]> {
    const rows = this.db.prepare('SELECT * FROM role WHERE org_id = ? ORDER BY rowid')
      .all(orgId) as unknown as RoleRow[]
    return Promise.resolve(rows.map(toRole))
  }

  listRoleGrants(roleId: RoleId): Promise<RoleGrant[]> {
    this.role(roleId)
    const typeRows = this.db.prepare(
      'SELECT id, resource_type, action FROM role_type_grant WHERE role_id = ? ORDER BY rowid',
    ).all(roleId) as unknown as { id: string; resource_type: string; action: string }[]
    const resourceRows = this.db.prepare(
      `SELECT g.id, g.resource_id, r.type AS resource_type, r.display_name, g.action
         FROM role_resource_grant g
         JOIN resource r ON r.id = g.resource_id
        WHERE g.role_id = ?
        ORDER BY g.rowid`,
    ).all(roleId) as unknown as {
      id: string
      resource_id: string
      resource_type: string
      display_name: string
      action: string
    }[]
    return Promise.resolve([
      ...typeRows.map((row): RoleGrant => ({
        id: GrantId(row.id), roleId, kind: 'type',
        resourceType: row.resource_type, action: row.action,
      })),
      ...resourceRows.map((row): RoleGrant => ({
        id: GrantId(row.id), roleId, kind: 'resource',
        resourceId: ResourceId(row.resource_id), resourceType: row.resource_type,
        resourceDisplayName: row.display_name, action: row.action,
      })),
    ])
  }

  async registerResource(input: RegisterResource): Promise<ManagedResource> {
    // A type no permission governs can never be authorized, so governing a
    // resource of that type would store a row nothing could ever use.
    if (!GOVERNED_RESOURCE_TYPES.includes(input.type)) {
      throw new UnknownPermissionError(input.type, '(any)')
    }
    // Idempotent on the identity a request names, because the owning subsystem
    // re-registers its catalog on every start; only the display name follows.
    const before = this.db.prepare(
      'SELECT * FROM resource WHERE org_id = ? AND type = ? AND external_ref = ?',
    ).get(input.orgId, input.type, input.externalRef) as ResourceRow | undefined
    this.db.prepare(
      `INSERT INTO resource (id, org_id, type, external_ref, display_name, enabled)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT (org_id, type, external_ref)
       DO UPDATE SET display_name = excluded.display_name`,
    ).run(randomUUID(), input.orgId, input.type, input.externalRef, input.displayName)
    const row = this.db.prepare(
      'SELECT * FROM resource WHERE org_id = ? AND type = ? AND external_ref = ?',
    ).get(input.orgId, input.type, input.externalRef) as unknown as ResourceRow
    // A type grant already held by some role covers a newly governed resource.
    // Re-registering an unchanged owner row on startup changes no outcome and
    // must not make every restart look like a policy edit.
    if (before === undefined || before.display_name !== input.displayName) {
      await this.bump(input.orgId)
    }
    return toResource(row)
  }

  async setResourceEnabled(id: ResourceId, enabled: boolean): Promise<void> {
    const row = this.db.prepare(
      'UPDATE resource SET enabled = ? WHERE id = ? RETURNING org_id',
    ).get(enabled ? 1 : 0, id) as Pick<ResourceRow, 'org_id'> | undefined
    if (row !== undefined) await this.bump(OrgId(row.org_id))
  }

  listResources(orgId: OrgIdType, type: string): Promise<ManagedResource[]> {
    const rows = this.db.prepare(
      'SELECT * FROM resource WHERE org_id = ? AND type = ? ORDER BY rowid',
    ).all(orgId, type) as unknown as ResourceRow[]
    return Promise.resolve(rows.map(toResource))
  }

  async grantType(roleId: RoleId, resourceType: string, action: string): Promise<GrantId> {
    if (!isRegisteredPermission(resourceType, action)) {
      throw new UnknownPermissionError(resourceType, action)
    }
    const role = this.role(roleId)
    const id = randomUUID()
    this.db.prepare(
      `INSERT INTO role_type_grant (id, role_id, resource_type, action) VALUES (?, ?, ?, ?)
       ON CONFLICT (role_id, resource_type, action) DO NOTHING`,
    ).run(id, roleId, resourceType, action)
    const stored = this.db.prepare(
      'SELECT id FROM role_type_grant WHERE role_id = ? AND resource_type = ? AND action = ?',
    ).get(roleId, resourceType, action) as { id: string }
    await this.bump(OrgId(role.org_id))
    return GrantId(stored.id)
  }

  async grantResource(roleId: RoleId, resourceId: ResourceId, action: string): Promise<GrantId> {
    const role = this.role(roleId)
    const resource = this.db.prepare('SELECT * FROM resource WHERE id = ?').get(resourceId) as
      ResourceRow | undefined
    if (resource === undefined) throw new UnknownPermissionError('(unknown resource)', action)
    if (!isRegisteredPermission(resource.type, action)) {
      throw new UnknownPermissionError(resource.type, action)
    }
    const id = randomUUID()
    this.db.prepare(
      `INSERT INTO role_resource_grant (id, role_id, resource_id, action) VALUES (?, ?, ?, ?)
       ON CONFLICT (role_id, resource_id, action) DO NOTHING`,
    ).run(id, roleId, resourceId, action)
    const stored = this.db.prepare(
      'SELECT id FROM role_resource_grant WHERE role_id = ? AND resource_id = ? AND action = ?',
    ).get(roleId, resourceId, action) as { id: string }
    await this.bump(OrgId(role.org_id))
    return GrantId(stored.id)
  }

  async revokeGrant(grantId: GrantId): Promise<void> {
    const typeGrant = this.db.prepare(
      `DELETE FROM role_type_grant WHERE id = ?
       RETURNING (SELECT org_id FROM role WHERE role.id = role_type_grant.role_id) AS org_id`,
    ).get(grantId) as { org_id: string } | undefined
    const resourceGrant = typeGrant !== undefined ? undefined : this.db.prepare(
      `DELETE FROM role_resource_grant WHERE id = ?
       RETURNING (SELECT org_id FROM role WHERE role.id = role_resource_grant.role_id) AS org_id`,
    ).get(grantId) as { org_id: string } | undefined
    const removed = typeGrant ?? resourceGrant
    // Withdrawing a grant that is already absent is not an error: the caller's
    // intent is that it not be there, and it is not.
    if (removed !== undefined) await this.bump(OrgId(removed.org_id))
  }

  async bindUserRole(userId: UserId, roleId: RoleId): Promise<void> {
    const role = this.role(roleId)
    this.db.prepare(
      'INSERT INTO user_role_binding (user_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
    ).run(userId, roleId)
    await this.bump(OrgId(role.org_id))
  }

  async unbindUserRole(userId: UserId, roleId: RoleId): Promise<void> {
    const row = this.db.prepare(
      `DELETE FROM user_role_binding WHERE user_id = ? AND role_id = ?
       RETURNING (SELECT org_id FROM role WHERE role.id = ?) AS org_id`,
    ).get(userId, roleId, roleId) as { org_id: string } | undefined
    if (row !== undefined) await this.bump(OrgId(row.org_id))
  }

  createGroup(orgId: OrgIdType, name: string): Promise<UserGroup> {
    const row: GroupRow = { id: randomUUID(), org_id: orgId, name }
    this.db.prepare('INSERT INTO user_group (id, org_id, name) VALUES (?, ?, ?)')
      .run(row.id, row.org_id, row.name)
    // A group with no role bound changes no outcome, so creating one does not
    // advance the revision.
    return Promise.resolve({ id: GroupId(row.id), orgId: OrgId(row.org_id), name: row.name })
  }

  async addGroupMember(groupId: GroupId, userId: UserId): Promise<void> {
    const group = this.db.prepare('SELECT * FROM user_group WHERE id = ?').get(groupId) as
      GroupRow | undefined
    if (group === undefined) throw new Error(`unknown group ${groupId}`)
    this.db.prepare(
      'INSERT INTO group_member (group_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
    ).run(groupId, userId)
    await this.bump(OrgId(group.org_id))
  }

  async bindGroupRole(groupId: GroupId, roleId: RoleId): Promise<void> {
    const role = this.role(roleId)
    this.db.prepare(
      'INSERT INTO group_role_binding (group_id, role_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
    ).run(groupId, roleId)
    await this.bump(OrgId(role.org_id))
  }

  rolesOf(userId: UserId): Promise<RoleId[]> {
    // Direct and group-derived roles are one set: a group is a way to bind in
    // bulk, not a second kind of binding the evaluation has to know about.
    const rows = this.db.prepare(
      `SELECT role_id FROM user_role_binding WHERE user_id = ?
       UNION
       SELECT grb.role_id FROM group_role_binding grb
         JOIN group_member gm ON gm.group_id = grb.group_id
        WHERE gm.user_id = ?
       ORDER BY role_id`,
    ).all(userId, userId) as unknown as { role_id: string }[]
    return Promise.resolve(rows.map(row => RoleId(row.role_id)))
  }

  async syncCatalogRole(roleId: RoleId): Promise<string[]> {
    const role = this.role(roleId)
    const held = new Set((this.db.prepare(
      'SELECT resource_type, action FROM role_type_grant WHERE role_id = ?',
    ).all(roleId) as unknown as { resource_type: string; action: string }[])
      .map(row => `${row.resource_type}|${row.action}`))
    const missing = PERMISSION_CATALOG
      .filter(permission => !held.has(`${permission.resourceType}|${permission.action}`))
    for (const permission of missing) {
      this.db.prepare(
        `INSERT INTO role_type_grant (id, role_id, resource_type, action) VALUES (?, ?, ?, ?)
         ON CONFLICT (role_id, resource_type, action) DO NOTHING`,
      ).run(randomUUID(), roleId, permission.resourceType, permission.action)
    }
    // Nothing was added means nothing an authorization cache holds went stale,
    // so a start that changes no policy does not read as a policy edit.
    if (missing.length > 0) await this.bump(OrgId(role.org_id))
    return missing.map(permission => `${permission.resourceType}|${permission.action}`)
  }

  listCatalogRoles(orgId: OrgIdType): Promise<Role[]> {
    const rows = this.db.prepare(
      'SELECT * FROM role WHERE org_id = ? AND covers_catalog != 0 ORDER BY rowid',
    ).all(orgId) as unknown as RoleRow[]
    return Promise.resolve(rows.map(toRole))
  }

  /** Read a role or refuse: a grant or binding naming no role would be unreachable. */
  private role(roleId: RoleId): RoleRow {
    const row = this.db.prepare('SELECT * FROM role WHERE id = ?').get(roleId) as RoleRow | undefined
    if (row === undefined) throw new UnknownRoleError(roleId)
    return row
  }

  /** Advance the revision every authorization cache keys on. */
  private async bump(orgId: OrgIdType): Promise<void> {
    await this.ctx.accountStore.bumpPolicyRevision(orgId)
  }
}

export default SqliteAccessControl
