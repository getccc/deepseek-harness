/**
 * The administration console's browser API.
 *
 * The console is a browser application; this is the only thing it talks to.
 * Every route here asks the same three questions a form post asked — is there
 * a session, did this come from this site, does access control admit it — and
 * every write leaves the same audit record. The console decides what to show;
 * it decides nothing about what is allowed.
 * @module @deepseek-ai/dsh-team-admin-api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DuplicateRoleCodeError,
  DuplicateRoleNameError,
  GrantId,
  PERMISSION_CATALOG,
  ResourceId,
  RoleId,
  SystemRoleError,
  type AccessControl,
  type Role,
  type RoleGrant,
} from '@deepseek-ai/dsh-access-control'
import {
  DepartmentNotEmptyError,
  DeptId,
  DuplicateDepartmentCodeError,
  DuplicateLoginNameError,
  OrgId,
  UserId,
  type AccountUser,
  type Department,
  type DepartmentCategory,
  type DepartmentStatus,
  type MemberGender,
  type Organization,
  type UpdateAccountUser,
  type UpdateDepartment,
} from '@deepseek-ai/dsh-account-store'
import { WeakSecretError } from '@deepseek-ai/dsh-account-auth'
import type { AuditActionName, AuditOutcome } from '@deepseek-ai/dsh-audit'
import { DeviceId, type Device } from '@deepseek-ai/dsh-device-authorization'
import {
  MODEL_STATUSES,
  isUsableCredentialRef,
  type ModelEntry,
  type ModelStatus,
} from '@deepseek-ai/dsh-model-gateway'
import {
  ConsoleMenuNotEmptyError,
  MenuId,
  UnknownMenuPermissionError,
  isMenuPermission,
  type ConsoleMenu,
  type ConsoleMenuKind,
  type ConsoleMenuStatus,
  type UpdateConsoleMenu,
} from '@deepseek-ai/dsh-team-console-menu'
import {
  csrfMatches,
  csrfToken,
  currentSession,
  hashToken,
  newSessionToken,
  sameOrigin,
  writeSessionCookie,
  type Signed,
} from '@deepseek-ai/dsh-team-browser-session'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { CSRF_HEADER, json, patchBoolean, patchInteger, patchText, readJson, refuse, text } from './http.ts'
import type {
  WireDepartment,
  WireDevice,
  WireGrant,
  WireMember,
  WireMenu,
  WireModel,
  WireOrganization,
  WireOverview,
  WireRole,
} from './types.ts'

export { CSRF_HEADER } from './http.ts'
export type {
  WireDepartment,
  WireDevice,
  WireGrant,
  WireMember,
  WireMenu,
  WireModel,
  WireOrganization,
  WireOverview,
  WirePermission,
  WireRefusal,
  WireRefusalReason,
  WireRole,
  WireRoleRef,
  WireSession,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'team-admin-api'

/** Services required before the API can claim its routes. */
export const inject = [
  'webServer', 'accountStore', 'accountAuth', 'accessControl', 'audit',
  'consoleMenu', 'deviceAuthorization', 'modelGateway',
]

/** The department statuses a request may ask for. */
const DEPARTMENT_STATUSES: readonly DepartmentStatus[] = ['active', 'suspended']

/** The navigation-entry statuses a request may ask for. */
const MENU_STATUSES: readonly ConsoleMenuStatus[] = ['active', 'suspended']

/** The navigation-entry kinds a request may name. */
const MENU_KINDS: readonly ConsoleMenuKind[] = ['catalog', 'menu', 'action']

/** The genders an account may record. */
const GENDERS: readonly MemberGender[] = ['male', 'female', 'unspecified']

/** The department categories a request may name. */
const DEPARTMENT_CATEGORIES: readonly DepartmentCategory[] = ['company', 'department']

/** Address prefix every administration endpoint lives under. */
export const API_PREFIX = '/team/api'

/**
 * The governed resource standing for the company model catalog.
 *
 * The catalog is one thing an organization owns rather than one row per model,
 * so a grant to manage it is a grant over the catalog, not over each entry.
 */
export const MODEL_CATALOG_RESOURCE = 'urn:dsh:admin:model-catalog'

/** Plugin config: which organization, and how a browser session behaves. */
export interface Config {
  /**
   * The organization this Control Plane serves. The first version is
   * single-organization, and naming it here keeps that a stated fact rather
   * than something the API infers from whatever the store happens to hold.
   */
  organizationId: string
  /** How long a Control Plane session is honoured, in seconds. */
  sessionMaxAgeSeconds: number
  /**
   * Whether to mark the session cookie `Secure`. A deployment served over
   * HTTPS sets this; a local one cannot, because a browser drops a Secure
   * cookie on a plain-HTTP origin and the member would never stay signed in.
   */
  secureCookie: boolean
  /** Largest request body accepted, in bytes. */
  maxRequestBodyBytes: number
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  organizationId: z.string().required(),
  sessionMaxAgeSeconds: z.natural().min(1).default(43_200),
  secureCookie: z.boolean().default(true),
  maxRequestBodyBytes: z.natural().min(1).default(16 * 1024),
})

/**
 * Project one organization for the browser.
 * @param org - the stored organization.
 * @param leaderName - the display name of the account leading it, when one leads it.
 * @returns the browser's view of the organization.
 */
function wireOrganization(org: Organization, leaderName: string | undefined): WireOrganization {
  return {
    id: org.id,
    name: org.name,
    ...(org.code === undefined ? {} : { code: org.code }),
    ...(org.leaderId === undefined ? {} : { leaderId: org.leaderId }),
    ...(leaderName === undefined ? {} : { leaderName }),
    ...(org.phone === undefined ? {} : { phone: org.phone }),
    ...(org.email === undefined ? {} : { email: org.email }),
    policyRevision: org.policyRevision.toString(),
    createdAt: org.createdAt,
  }
}

/**
 * Project one member, with the roles this console could also unbind.
 * @param member - the stored account.
 * @param roles - the roles it holds from this organization.
 * @param departmentName - the name of the department it sits in, when it sits in one.
 * @returns the browser's view of the account.
 */
function wireMember(
  member: AccountUser,
  roles: readonly Role[],
  departmentName: string | undefined,
): WireMember {
  return {
    id: member.id,
    loginName: member.loginName,
    displayName: member.displayName,
    ...(member.email === undefined ? {} : { email: member.email }),
    ...(member.phone === undefined ? {} : { phone: member.phone }),
    ...(member.gender === undefined ? {} : { gender: member.gender }),
    status: member.status,
    ...(member.departmentId === undefined ? {} : { departmentId: member.departmentId }),
    ...(departmentName === undefined ? {} : { departmentName }),
    createdAt: member.createdAt,
    ...(member.lastLoginAt === undefined ? {} : { lastLoginAt: member.lastLoginAt }),
    roles: roles.map(role => ({ id: role.id, name: role.name })),
  }
}

/**
 * Project one department, with the people a directory row shows.
 * @param department - the stored department.
 * @param leaderName - the display name of the account leading it, when one leads it.
 * @param memberNames - display names of the accounts in it, in store order.
 * @returns the browser's view of the department.
 */
function wireDepartment(
  department: Department,
  leaderName: string | undefined,
  memberNames: readonly string[],
): WireDepartment {
  return {
    id: department.id,
    ...(department.parentId === undefined ? {} : { parentId: department.parentId }),
    name: department.name,
    code: department.code,
    category: department.category,
    ...(department.leaderId === undefined ? {} : { leaderId: department.leaderId }),
    ...(leaderName === undefined ? {} : { leaderName }),
    ...(department.phone === undefined ? {} : { phone: department.phone }),
    ...(department.email === undefined ? {} : { email: department.email }),
    sortOrder: department.sortOrder,
    status: department.status,
    createdAt: department.createdAt,
    memberCount: memberNames.length,
    memberNames,
  }
}

/** Project one navigation entry. */
function wireMenu(menu: ConsoleMenu): WireMenu {
  return {
    id: menu.id,
    ...(menu.parentId === undefined ? {} : { parentId: menu.parentId }),
    name: menu.name,
    ...(menu.labelKey === undefined ? {} : { labelKey: menu.labelKey }),
    kind: menu.kind,
    ...(menu.routePath === undefined ? {} : { routePath: menu.routePath }),
    ...(menu.componentPath === undefined ? {} : { componentPath: menu.componentPath }),
    ...(menu.permission === undefined ? {} : { permission: menu.permission }),
    ...(menu.icon === undefined ? {} : { icon: menu.icon }),
    sortOrder: menu.sortOrder,
    status: menu.status,
    visible: menu.visible,
    shipped: menu.seedKey !== undefined,
    createdAt: menu.createdAt,
  }
}

/** Project one grant, carrying a display name only where one exists. */
function wireGrant(grant: RoleGrant): WireGrant {
  return grant.kind === 'type'
    ? { id: grant.id, scope: 'type', resourceType: grant.resourceType, action: grant.action }
    : {
      id: grant.id,
      scope: 'resource',
      resourceType: grant.resourceType,
      action: grant.action,
      resourceId: grant.resourceId,
      resourceDisplayName: grant.resourceDisplayName,
    }
}

/**
 * Project one role, its composition, and who holds it.
 * @param role - the stored role.
 * @param grants - the grants composing it.
 * @param memberNames - display names of the accounts holding it, in store order.
 * @returns the browser's view of the role.
 */
function wireRole(
  role: Role,
  grants: readonly RoleGrant[],
  memberNames: readonly string[],
): WireRole {
  return {
    id: role.id,
    name: role.name,
    code: role.code,
    description: role.description,
    kind: role.kind,
    coversCatalog: role.coversCatalog,
    /* v8 ignore next -- only a role stored before this build carries no creation moment, and every role these tests create carries one */
    ...(role.createdAt === undefined ? {} : { createdAt: role.createdAt }),
    grants: grants.map(wireGrant),
    memberCount: memberNames.length,
    memberNames,
  }
}

/** Project one bound computer. */
function wireDevice(device: Device): WireDevice {
  return {
    id: device.id,
    ownerId: device.ownerId,
    platform: device.platform,
    runnerVersion: device.runnerVersion,
    publicKeyDigest: device.publicKeyDigest,
    status: device.status,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
  }
}

/** Project one catalog entry. */
function wireModel(entry: ModelEntry, resourceId: ResourceId): WireModel {
  return {
    resourceId,
    modelRef: entry.modelRef,
    displayName: entry.displayName,
    providerRef: entry.providerRef,
    upstreamModel: entry.upstreamModel,
    endpoint: entry.endpoint,
    credentialRef: entry.credentialRef,
    maxOutputTokens: entry.maxOutputTokens,
    status: entry.status,
  }
}

/**
 * Answer a role conflict the console has copy for.
 * @param res - the response to write.
 * @param error - what the access-control service raised.
 * @throws the error unchanged when it is not a conflict this console can explain,
 *   which the route handler turns into "this site could not answer".
 */
function refuseRoleConflict(res: ServerResponse, error: unknown): void {
  if (error instanceof DuplicateRoleNameError) {
    refuse(res, 409, 'conflict', { reason: 'name-taken', detail: 'That role name is already in this organization.' })
    return
  }
  if (error instanceof DuplicateRoleCodeError) {
    refuse(res, 409, 'conflict', { reason: 'code-taken', detail: 'That code is already in this organization.' })
    return
  }
  throw error
}

/**
 * Every permission a principal holds, as `resourceType|action`.
 *
 * The console uses this to leave out controls nobody could use. It is asked
 * once per session read rather than cached, because a role change must reach
 * the next page load rather than the next sign-in.
 * @param access - the access-control service.
 * @param orgId - the organization the principal acts in.
 * @param principalId - the account asking.
 * @returns the held pairs, in catalog order.
 */
async function heldPermissions(
  access: AccessControl,
  orgId: OrgId,
  principalId: UserId,
): Promise<string[]> {
  const decisions = await Promise.all(PERMISSION_CATALOG.map(permission => access.authorize({
    orgId,
    principalId,
    action: permission.action,
    resourceType: permission.resourceType,
    resourceId: permission.resourceType === 'model' ? MODEL_CATALOG_RESOURCE : orgId,
  })))
  return PERMISSION_CATALOG
    .filter((_permission, index) => decisions[index]?.allowed === true)
    .map(permission => `${permission.resourceType}|${permission.action}`)
}

/**
 * Mount the administration API.
 * @param ctx - the Control Plane context.
 * @param config - which organization, and how a browser session behaves.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.organizationId.trim().length === 0) {
    throw new Error('team-admin-api: organizationId must name the organization this Control Plane serves')
  }
  const organizationId = OrgId(config.organizationId)

  ctx.effect(async () => {
    for (const [type, externalRef, displayName] of [
      ['organization', organizationId, 'Organization administration'],
      ['member', organizationId, 'Member administration'],
      ['department', organizationId, 'Department administration'],
      ['role', organizationId, 'Role administration'],
      ['menu', organizationId, 'Console navigation administration'],
      ['device', organizationId, 'Device administration'],
      ['model', MODEL_CATALOG_RESOURCE, 'Model catalog administration'],
    ] as const) {
      await ctx.accessControl.registerResource({ orgId: organizationId, type, externalRef, displayName })
    }
    // The navigation this build ships, for an organization that does not have
    // it yet. Seeding here rather than in the store keeps the store ignorant of
    // which organization a Control Plane serves, which is this plugin's config.
    await ctx.consoleMenu.seedShipped(organizationId)
    // A role that covers the catalog is brought up to it here, so a build that
    // adds a permission does not leave the administrator holding a console
    // whose new controls are all refused.
    for (const role of await ctx.accessControl.listCatalogRoles(organizationId)) {
      const added = await ctx.accessControl.syncCatalogRole(role.id)
      if (added.length === 0) continue
      await ctx.audit.record({ orgId: organizationId, action: 'grant.add', outcome: 'allowed', resourceId: role.id })
    }
    return () => {}
  }, 'team-admin-api: govern administrative resources')

  /** Record one administrative act, naming who performed it. */
  const record = (
    action: AuditActionName,
    signed: Signed,
    outcome: AuditOutcome,
    extra: { resourceId?: string } = {},
  ): Promise<unknown> => ctx.audit.record({
    orgId: signed.session.orgId,
    principalId: signed.session.userId,
    action,
    outcome,
    ...extra,
  })

  /** Read the configured organization; a signed session cannot outlive it. */
  const readOrganization = async (): Promise<Organization> => {
    const org = await ctx.accountStore.getOrganization(organizationId)
    if (org === undefined) throw new Error(`team-admin-api: unknown configured organization ${organizationId}`)
    return org
  }

  /** The organization as the console reads it, with the name of the account leading it. */
  const readWireOrganization = async (): Promise<WireOrganization> => {
    const org = await readOrganization()
    if (org.leaderId === undefined) return wireOrganization(org, undefined)
    const leader = await ctx.accountStore.getUser(org.leaderId)
    /* v8 ignore next -- deleting an account clears the lead it held, so a stored lead always names an account */
    return wireOrganization(org, leader?.displayName)
  }

  /** Read the account a session stands for; a session cannot outlive it either. */
  const readMember = async (userId: UserId): Promise<AccountUser> => {
    const member = await ctx.accountStore.getUser(userId)
    if (member === undefined) throw new Error(`team-admin-api: session names no account ${userId}`)
    return member
  }

  /** Whether one active member may enter this administration surface. */
  const mayEnterConsole = async (userId: UserId): Promise<boolean> => (
    await ctx.accessControl.authorize({
      orgId: organizationId,
      principalId: userId,
      action: 'organization.admin.access',
      resourceType: 'organization',
      resourceId: organizationId,
    })
  ).allowed

  /**
   * Answer a read that must carry a session.
   * @returns the session, or undefined when the caller already answered 401.
   */
  const requireSession = async (req: IncomingMessage, res: ServerResponse): Promise<Signed | undefined> => {
    const signed = await currentSession(ctx.accountStore, req)
    if (signed === undefined) {
      refuse(res, 401, 'unauthenticated')
      return undefined
    }
    await readOrganization()
    await readMember(signed.session.userId)
    if (!await mayEnterConsole(signed.session.userId)) {
      refuse(res, 403, 'forbidden', { detail: 'This account cannot use the administration console.' })
      return undefined
    }
    return signed
  }

  /**
   * Accept a write: a session, this site's origin, and the session's own CSRF
   * value in the header. All three, because a cookie alone travels with a
   * request a member never made.
   * @returns the session and body, or undefined when the caller already answered.
   */
  const acceptWrite = async (req: IncomingMessage, res: ServerResponse, expectBody: boolean): Promise<
    { signed: Signed; body: Record<string, unknown> } | undefined
  > => {
    if (!sameOrigin(req)) {
      refuse(res, 403, 'forbidden', { detail: 'This request did not come from this site.' })
      return undefined
    }
    const signed = await currentSession(ctx.accountStore, req)
    if (signed === undefined) {
      refuse(res, 401, 'unauthenticated')
      return undefined
    }
    await readOrganization()
    await readMember(signed.session.userId)
    if (!await mayEnterConsole(signed.session.userId)) {
      refuse(res, 403, 'forbidden', { detail: 'This account cannot use the administration console.' })
      return undefined
    }
    const supplied = req.headers[CSRF_HEADER]
    if (typeof supplied !== 'string' || !csrfMatches(signed.token, supplied)) {
      refuse(res, 403, 'forbidden', { detail: 'This session token is out of date. Reload and try again.' })
      return undefined
    }
    if (!expectBody) return { signed, body: {} }
    const body = await readJson(req, config.maxRequestBodyBytes)
    if (body === 'too-large') {
      refuse(res, 413, 'too-large')
      return undefined
    }
    if (body === 'malformed') {
      refuse(res, 400, 'malformed', { reason: 'body', detail: 'The request body is not a JSON object.' })
      return undefined
    }
    return { signed, body }
  }

  /**
   * Ask access control, and answer the member when it says no.
   * @returns true when the principal may proceed.
   */
  const mayProceed = async (
    res: ServerResponse,
    signed: Signed,
    action: string,
    resourceType: string,
    resourceId: string,
  ): Promise<boolean> => {
    const decision = await ctx.accessControl.authorize({
      orgId: signed.session.orgId,
      principalId: signed.session.userId,
      action,
      resourceType,
      resourceId,
    })
    if (decision.allowed) return true
    refuse(res, 403, 'forbidden', { detail: 'Your roles do not include this.' })
    return false
  }

  /**
   * Every account of one organization with the role ids it holds.
   *
   * Read once and passed to whichever projection needs it: the member table
   * wants a member's roles, and the role table wants a role's members, and
   * asking access control twice for the same bindings would let the two tables
   * disagree about the same moment.
   * @returns the accounts, each with the role ids bound to it.
   */
  const readBindings = async (orgId: OrgId): Promise<
    readonly { member: AccountUser; roleIds: readonly RoleId[] }[]
  > => {
    const members = await ctx.accountStore.listUsers(orgId)
    return Promise.all(members.map(async member => ({
      member,
      roleIds: await ctx.accessControl.rolesOf(member.id),
    })))
  }

  /** Every member with the roles from this organization they hold. */
  const readMembers = async (orgId: OrgId): Promise<WireMember[]> => {
    const [bound, roles, departments] = await Promise.all([
      readBindings(orgId),
      ctx.accessControl.listRoles(orgId),
      ctx.accountStore.listDepartments(orgId),
    ])
    // Nothing stops a role binding from naming a role in another organization,
    // and this console administers one: a member's roles are the ones this API
    // could also unbind, not every binding they carry.
    const roleById = new Map(roles.map(role => [role.id, role]))
    const departmentName = new Map(departments.map(department => [department.id, department.name]))
    return bound.map(({ member, roleIds }) => wireMember(
      member,
      roleIds.flatMap(id => roleById.get(id) ?? []),
      member.departmentId === undefined ? undefined : departmentName.get(member.departmentId),
    ))
  }

  /** Every role with its grants and the accounts holding it. */
  const readRoles = async (orgId: OrgId): Promise<WireRole[]> => {
    const [roles, bound] = await Promise.all([
      ctx.accessControl.listRoles(orgId),
      readBindings(orgId),
    ])
    const holders = new Map<string, string[]>()
    for (const { member, roleIds } of bound) {
      for (const roleId of roleIds) holders.set(roleId, [...holders.get(roleId) ?? [], member.displayName])
    }
    return Promise.all(roles.map(async role => wireRole(
      role,
      await ctx.accessControl.listRoleGrants(role.id),
      holders.get(role.id) ?? [],
    )))
  }

  /** Every department with the people a directory row shows. */
  const readDepartments = async (orgId: OrgId): Promise<WireDepartment[]> => {
    const [departments, members] = await Promise.all([
      ctx.accountStore.listDepartments(orgId),
      ctx.accountStore.listUsers(orgId),
    ])
    const displayName = new Map(members.map(member => [member.id as string, member.displayName]))
    const inDepartment = new Map<string, string[]>()
    for (const member of members) {
      if (member.departmentId === undefined) continue
      inDepartment.set(
        member.departmentId,
        [...inDepartment.get(member.departmentId) ?? [], member.displayName],
      )
    }
    return departments.map(department => wireDepartment(
      department,
      department.leaderId === undefined ? undefined : displayName.get(department.leaderId),
      inDepartment.get(department.id) ?? [],
    ))
  }

  /** The organization's navigation. */
  const readMenus = async (orgId: OrgId): Promise<WireMenu[]> =>
    (await ctx.consoleMenu.listMenus(orgId)).map(wireMenu)

  /** Every model with the managed-resource id an exact role grant names. */
  const readModels = async (orgId: OrgId): Promise<WireModel[]> => {
    const [models, resources] = await Promise.all([
      ctx.modelGateway.list(orgId),
      ctx.accessControl.listResources(orgId, 'model'),
    ])
    const byRef = new Map(resources.map(resource => [resource.externalRef, resource.id]))
    return models.map((model) => {
      const resourceId = byRef.get(model.modelRef)
      if (resourceId === undefined) {
        throw new Error(`model ${JSON.stringify(model.modelRef)} has no managed resource`)
      }
      return wireModel(model, resourceId)
    })
  }

  /**
   * Make one role's type grants exactly the catalog pairs it was given.
   *
   * Grants over one named resource are left alone: they say something this list
   * cannot, and a catalog editor must not silently drop what it does not show.
   * @param roleId - the role to change.
   * @param wanted - the `resourceType|action` pairs the role is to hold.
   */
  const setRolePermissions = async (roleId: RoleId, wanted: ReadonlySet<string>): Promise<void> => {
    const held = await ctx.accessControl.listRoleGrants(roleId)
    const byPair = new Map<string, GrantId>(held.flatMap(grant =>
      grant.kind === 'type' ? [[`${grant.resourceType}|${grant.action}`, grant.id] as const] : []))
    for (const pair of wanted) {
      if (byPair.has(pair)) continue
      const separator = pair.indexOf('|')
      await ctx.accessControl.grantType(roleId, pair.slice(0, separator), pair.slice(separator + 1))
    }
    for (const [pair, grantId] of byPair) {
      if (!wanted.has(pair)) await ctx.accessControl.revokeGrant(grantId)
    }
  }

  /**
   * Make one role's grants match the navigation entries it was given.
   *
   * Menu access is not a second kind of permission: an entry names a pair the
   * permission catalog governs, and admitting the entry is granting that pair.
   * Only pairs some entry names are touched, so a grant an administrator added
   * from the permission list directly is left exactly as it was.
   * @param orgId - the organization whose navigation the ids belong to.
   * @param roleId - the role to change.
   * @param chosen - ids of the entries this role is to reach.
   */
  const setRoleMenus = async (
    orgId: OrgId, roleId: RoleId, chosen: ReadonlySet<string>,
  ): Promise<void> => {
    const [menus, held] = await Promise.all([
      ctx.consoleMenu.listMenus(orgId),
      ctx.accessControl.listRoleGrants(roleId),
    ])
    const grantByPair = new Map<string, GrantId>(held.flatMap(grant =>
      grant.kind === 'type' ? [[`${grant.resourceType}|${grant.action}`, grant.id] as const] : []))
    const governed = new Set<string>()
    const wanted = new Set<string>()
    for (const menu of menus) {
      if (menu.permission === undefined) continue
      governed.add(menu.permission)
      if (chosen.has(menu.id)) wanted.add(menu.permission)
    }
    for (const pair of wanted) {
      if (grantByPair.has(pair)) continue
      const separator = pair.indexOf('|')
      await ctx.accessControl.grantType(roleId, pair.slice(0, separator), pair.slice(separator + 1))
    }
    for (const pair of governed) {
      const grantId = grantByPair.get(pair)
      if (wanted.has(pair) || grantId === undefined) continue
      await ctx.accessControl.revokeGrant(grantId)
    }
  }

  /** The counts the overview shows. */
  const readOverview = async (orgId: OrgId): Promise<WireOverview> => {
    const [members, roles, devices, models] = await Promise.all([
      ctx.accountStore.listUsers(orgId),
      ctx.accessControl.listRoles(orgId),
      ctx.deviceAuthorization.listDevices(orgId),
      ctx.modelGateway.list(orgId),
    ])
    return {
      members: members.length,
      activeMembers: members.filter(member => member.status === 'active').length,
      roles: roles.length,
      devices: devices.length,
      activeDevices: devices.filter(device => device.status !== 'revoked').length,
      models: models.length,
      activeModels: models.filter(model => model.status === 'active').length,
    }
  }

  /** Sign a member in, or refuse without saying which half was wrong. */
  const signIn = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    // Signing in is a write like any other. Without this, a page on another
    // site could sign a member into an account that site controls, and every
    // view they then loaded would be that account's.
    if (!sameOrigin(req)) {
      refuse(res, 403, 'forbidden', { detail: 'This request did not come from this site.' })
      return
    }
    const body = await readJson(req, config.maxRequestBodyBytes)
    if (body === 'too-large') {
      refuse(res, 413, 'too-large')
      return
    }
    if (body === 'malformed') {
      refuse(res, 400, 'malformed', { reason: 'body', detail: 'The request body is not a JSON object.' })
      return
    }
    const outcome = await ctx.accountAuth.authenticate(
      organizationId,
      text(body, 'loginName') ?? '',
      typeof body['secret'] === 'string' ? body['secret'] : '',
    )
    if (!outcome.ok) {
      // One answer for every failure: which of "no such member", "wrong
      // password", and "locked" it was is exactly what an attacker wants.
      await ctx.audit.record({
        orgId: organizationId,
        action: 'member.login',
        outcome: 'denied',
        reason: 'invalid-credentials',
        metadata: { authMethod: 'password' },
      })
      refuse(res, 401, 'unauthenticated', { detail: 'That member and password do not match.' })
      return
    }
    if (!await mayEnterConsole(outcome.userId)) {
      await ctx.audit.record({
        orgId: organizationId,
        principalId: outcome.userId,
        action: 'member.login',
        outcome: 'denied',
        reason: 'no-grant',
        metadata: { authMethod: 'password' },
      })
      refuse(res, 403, 'forbidden', { detail: 'This account cannot use the administration console.' })
      return
    }
    const token = newSessionToken()
    await ctx.accountStore.createBrowserSession(
      outcome.userId,
      hashToken(token),
      Date.now() + config.sessionMaxAgeSeconds * 1000,
    )
    await ctx.audit.record({
      orgId: organizationId,
      principalId: outcome.userId,
      action: 'member.login',
      outcome: 'allowed',
      metadata: { authMethod: 'password' },
    })
    writeSessionCookie(res, token, config.sessionMaxAgeSeconds, config.secureCookie)
    const member = await readMember(outcome.userId)
    json(res, 200, {
      member: {
        id: member.id,
        loginName: member.loginName,
        displayName: member.displayName,
      },
      organization: await readWireOrganization(),
      permissions: await heldPermissions(ctx.accessControl, organizationId, outcome.userId),
      csrf: csrfToken(token),
    })
  }

  /** Answer who is signed in, or that nobody is. */
  const readSession = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const signed = await requireSession(req, res)
    if (signed === undefined) return
    const member = await readMember(signed.session.userId)
    json(res, 200, {
      member: {
        id: member.id,
        loginName: member.loginName,
        displayName: member.displayName,
      },
      organization: await readWireOrganization(),
      permissions: await heldPermissions(
        ctx.accessControl,
        signed.session.orgId,
        signed.session.userId,
      ),
      csrf: csrfToken(signed.token),
    })
  }

  /** Serve one read. */
  const read = async (
    req: IncomingMessage, res: ServerResponse, segments: readonly string[],
  ): Promise<void> => {
    if (segments[0] === 'session') {
      await readSession(req, res)
      return
    }
    const signed = await requireSession(req, res)
    if (signed === undefined) return
    const org = signed.session.orgId
    if (segments[0] === 'permissions' && segments.length === 1) {
      // The catalog is the same for every organization and names nothing an
      // organization holds, so reading it needs a session and no grant.
      json(res, 200, PERMISSION_CATALOG)
      return
    }
    if (segments[0] === 'overview' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'organization.read', 'organization', org)) return
      json(res, 200, await readOverview(org))
      return
    }
    if (segments[0] === 'organization' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'organization.read', 'organization', org)) return
      json(res, 200, await readWireOrganization())
      return
    }
    if (segments[0] === 'members' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'member.read', 'member', org)) return
      json(res, 200, await readMembers(org))
      return
    }
    if (segments[0] === 'departments' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'department.read', 'department', org)) return
      json(res, 200, await readDepartments(org))
      return
    }
    if (segments[0] === 'menus' && segments.length === 1) {
      // Navigation needs a session and no grant, like the permission catalog:
      // the console cannot draw itself without it, it names only what this
      // build ships, and every page it leads to asks access control again.
      json(res, 200, await readMenus(org))
      return
    }
    if (segments[0] === 'roles' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'role.read', 'role', org)) return
      json(res, 200, await readRoles(org))
      return
    }
    if (segments[0] === 'devices' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'device.inventory.read', 'device', org)) return
      json(res, 200, (await ctx.deviceAuthorization.listDevices(org)).map(wireDevice))
      return
    }
    if (segments[0] === 'models' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'model.catalog.read', 'model', MODEL_CATALOG_RESOURCE)) return
      json(res, 200, await readModels(org))
      return
    }
    refuse(res, 404, 'not-found')
  }

  /** Carry out one write. */
  const write = async (
    req: IncomingMessage, res: ServerResponse, method: string, segments: readonly string[],
  ): Promise<void> => {
    if (segments[0] === 'session' && segments.length === 1) {
      if (method === 'POST') {
        await signIn(req, res)
        return
      }
      const accepted = await acceptWrite(req, res, false)
      if (accepted === undefined) return
      await ctx.accountStore.revokeBrowserSession(hashToken(accepted.signed.token))
      await record('member.logout', accepted.signed, 'allowed')
      writeSessionCookie(res, '', 0, config.secureCookie)
      json(res, 200, { ended: true })
      return
    }
    const accepted = await acceptWrite(req, res, method !== 'DELETE')
    if (accepted === undefined) return
    const { signed, body } = accepted
    const org = signed.session.orgId

    if (segments[0] === 'organization' && segments.length === 1 && method === 'PATCH') {
      if (!await mayProceed(res, signed, 'organization.settings.manage', 'organization', org)) return
      const name = text(body, 'name')
      if (name === undefined) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'An organization needs a name.' })
        return
      }
      const code = patchText(body, 'code')
      const leaderId = patchText(body, 'leaderId')
      const phone = patchText(body, 'phone')
      const email = patchText(body, 'email')
      await ctx.accountStore.updateOrganization(org, {
        name,
        ...(code === undefined ? {} : { code }),
        ...(leaderId === undefined ? {} : { leaderId: leaderId as UserId | null }),
        ...(phone === undefined ? {} : { phone }),
        ...(email === undefined ? {} : { email }),
      })
      await record('policy.update', signed, 'allowed', { resourceId: org })
      json(res, 200, await readWireOrganization())
      return
    }

    if (segments[0] === 'members' && segments.length === 1 && method === 'POST') {
      if (!await mayProceed(res, signed, 'member.create', 'member', org)) return
      const loginName = text(body, 'loginName')
      const displayName = text(body, 'displayName')
      const secret = text(body, 'secret')
      if (loginName === undefined || displayName === undefined || secret === undefined) {
        refuse(res, 400, 'malformed', {
          reason: 'fields',
          detail: 'A member needs a login name, display name, and initial password.',
        })
        return
      }
      const email = text(body, 'email')
      const phone = text(body, 'phone')
      const gender = text(body, 'gender')
      const departmentId = text(body, 'departmentId')
      if (gender !== undefined && !GENDERS.includes(gender as MemberGender)) {
        refuse(res, 400, 'malformed', { reason: 'gender', detail: 'That gender is not one this build records.' })
        return
      }
      try {
        const member = await ctx.accountStore.createUser({
          orgId: org,
          loginName,
          displayName,
          ...(email === undefined ? {} : { email }),
          ...(phone === undefined ? {} : { phone }),
          ...(gender === undefined ? {} : { gender: gender as MemberGender }),
          ...(departmentId === undefined ? {} : { departmentId: DeptId(departmentId) }),
        })
        try {
          await ctx.accountAuth.setSecret(member.id, secret)
        } catch (error) {
          // Provisioning is one administration operation even though identity
          // and password material have different owners. Do not leave behind
          // an account that the form reported as failed to create.
          await ctx.accountStore.deleteUser(member.id)
          throw error
        }
      } catch (error) {
        // The store owns login-name uniqueness; a second account with the same
        // name is the administrator's mistake, not the site's failure.
        if (error instanceof DuplicateLoginNameError) {
          refuse(res, 409, 'conflict', {
            reason: 'login-taken', detail: 'That login name is already in this organization.',
          })
          return
        }
        if (error instanceof WeakSecretError) {
          refuse(res, 400, 'malformed', { reason: 'weak-secret', detail: error.requirement })
          return
        }
        throw error
      }
      await record('member.create', signed, 'allowed')
      json(res, 200, await readMembers(org))
      return
    }

    if (segments[0] === 'members' && segments[2] === 'password' && segments.length === 3 && method === 'PATCH') {
      if (!await mayProceed(res, signed, 'member.password.reset', 'member', org)) return
      const target = UserId(segments[1] as string)
      const member = await ctx.accountStore.getUser(target)
      if (member === undefined || member.orgId !== org) {
        refuse(res, 404, 'not-found')
        return
      }
      const secret = text(body, 'secret')
      if (secret === undefined) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A new password is required.' })
        return
      }
      try {
        await ctx.accountAuth.setSecret(target, secret)
      } catch (error) {
        if (!(error instanceof WeakSecretError)) throw error
        refuse(res, 400, 'malformed', { reason: 'weak-secret', detail: error.requirement })
        return
      }
      await ctx.accountStore.revokeBrowserSessions(target)
      await ctx.deviceAuthorization.revokeUserDevices(org, target)
      await record('member.password.reset', signed, 'allowed', { resourceId: target })
      const self = target === signed.session.userId
      if (self) writeSessionCookie(res, '', 0, config.secureCookie)
      json(res, 200, { reset: true, self })
      return
    }

    if (segments[0] === 'members' && segments.length === 2 && method === 'PATCH') {
      const target = UserId(segments[1] as string)
      // Two different acts share the address because both edit one account, and
      // they are told apart by what the body carries: a status change is a
      // separate permission from editing a profile, and holding one of them is
      // not holding the other.
      if (Object.hasOwn(body, 'status')) {
        const status = text(body, 'status')
        if (status !== 'active' && status !== 'suspended') {
          refuse(res, 400, 'malformed', { reason: 'member-status', detail: 'That account status is not supported.' })
          return
        }
        const action = status === 'active' ? 'member.enable' : 'member.disable'
        if (!await mayProceed(res, signed, action, 'member', org)) return
        // Suspending is the whole act: a session resolves through its account,
        // so the sessions this member holds stop working with the status change
        // rather than needing a second call someone has to remember.
        await ctx.accountStore.setUserStatus(target, status)
        await record(action, signed, 'allowed', { resourceId: target })
        json(res, 200, await readMembers(org))
        return
      }
      if (!await mayProceed(res, signed, 'member.update', 'member', org)) return
      const gender = patchText(body, 'gender')
      if (typeof gender === 'string' && !GENDERS.includes(gender as MemberGender)) {
        refuse(res, 400, 'malformed', { reason: 'gender', detail: 'That gender is not one this build records.' })
        return
      }
      const displayName = text(body, 'displayName')
      const email = patchText(body, 'email')
      const phone = patchText(body, 'phone')
      const departmentId = patchText(body, 'departmentId')
      const changes: UpdateAccountUser = {
        ...(displayName === undefined ? {} : { displayName }),
        ...(email === undefined ? {} : { email }),
        ...(phone === undefined ? {} : { phone }),
        ...(gender === undefined ? {} : { gender: gender as MemberGender | null }),
        ...(departmentId === undefined ? {} : { departmentId: departmentId as DeptId | null }),
      }
      await ctx.accountStore.updateUser(target, changes)
      await record('member.update', signed, 'allowed', { resourceId: target })
      json(res, 200, await readMembers(org))
      return
    }

    if (segments[0] === 'members' && segments.length === 2 && method === 'DELETE') {
      if (!await mayProceed(res, signed, 'member.delete', 'member', org)) return
      const target = UserId(segments[1] as string)
      // An administrator deleting their own account would end the session
      // carrying out the request and leave nobody able to undo it.
      if (target === signed.session.userId) {
        refuse(res, 409, 'conflict', { reason: 'self-delete', detail: 'You cannot delete the account you are signed in as.' })
        return
      }
      // The records other services own go first: what this store deletes is
      // the account, and a binding or a credential naming an account that is
      // gone would admit work nobody can account for.
      for (const roleId of await ctx.accessControl.rolesOf(target)) {
        await ctx.accessControl.unbindUserRole(target, roleId)
      }
      for (const device of await ctx.deviceAuthorization.listDevices(org)) {
        if (device.ownerId === target) await ctx.deviceAuthorization.revokeDevice(device.id)
      }
      await ctx.accountStore.deleteUser(target)
      await record('member.delete', signed, 'allowed', { resourceId: target })
      json(res, 200, await readMembers(org))
      return
    }

    if (segments[0] === 'departments' && segments.length === 1 && method === 'POST') {
      if (!await mayProceed(res, signed, 'department.manage', 'department', org)) return
      const name = text(body, 'name')
      const code = text(body, 'code')
      if (name === undefined || code === undefined) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A department needs a name and a code.' })
        return
      }
      const category = text(body, 'category')
      if (category !== undefined && !DEPARTMENT_CATEGORIES.includes(category as DepartmentCategory)) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A department is either a company or a department.' })
        return
      }
      const parentId = text(body, 'parentId')
      const leaderId = text(body, 'leaderId')
      const phone = text(body, 'phone')
      const email = text(body, 'email')
      const sortOrder = patchInteger(body, 'sortOrder')
      try {
        await ctx.accountStore.createDepartment({
          orgId: org,
          name,
          code,
          ...(parentId === undefined ? {} : { parentId: DeptId(parentId) }),
          ...(category === undefined ? {} : { category: category as DepartmentCategory }),
          ...(leaderId === undefined ? {} : { leaderId: UserId(leaderId) }),
          ...(phone === undefined ? {} : { phone }),
          ...(email === undefined ? {} : { email }),
          ...(sortOrder === undefined ? {} : { sortOrder }),
        })
      } catch (error) {
        if (!(error instanceof DuplicateDepartmentCodeError)) throw error
        refuse(res, 409, 'conflict', { reason: 'code-taken', detail: 'That code is already in this organization.' })
        return
      }
      await record('department.create', signed, 'allowed')
      json(res, 200, await readDepartments(org))
      return
    }

    if (segments[0] === 'departments' && segments.length === 2 && method === 'PATCH') {
      if (!await mayProceed(res, signed, 'department.manage', 'department', org)) return
      const status = text(body, 'status')
      if (status !== undefined && !DEPARTMENT_STATUSES.includes(status as DepartmentStatus)) {
        refuse(res, 400, 'malformed', { reason: 'department-status', detail: 'That department status is not supported.' })
        return
      }
      const category = text(body, 'category')
      if (category !== undefined && !DEPARTMENT_CATEGORIES.includes(category as DepartmentCategory)) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A department is either a company or a department.' })
        return
      }
      const name = text(body, 'name')
      const code = text(body, 'code')
      const sortOrder = patchInteger(body, 'sortOrder')
      const leaderId = patchText(body, 'leaderId')
      const phone = patchText(body, 'phone')
      const email = patchText(body, 'email')
      const changes: UpdateDepartment = {
        ...(name === undefined ? {} : { name }),
        ...(code === undefined ? {} : { code }),
        ...(category === undefined ? {} : { category: category as DepartmentCategory }),
        ...(leaderId === undefined ? {} : { leaderId: leaderId as UserId | null }),
        ...(phone === undefined ? {} : { phone }),
        ...(email === undefined ? {} : { email }),
        ...(sortOrder === undefined ? {} : { sortOrder }),
        ...(status === undefined ? {} : { status: status as DepartmentStatus }),
      }
      const target = DeptId(segments[1] as string)
      try {
        await ctx.accountStore.updateDepartment(target, changes)
      } catch (error) {
        if (!(error instanceof DuplicateDepartmentCodeError)) throw error
        refuse(res, 409, 'conflict', { reason: 'code-taken', detail: 'That code is already in this organization.' })
        return
      }
      await record('department.update', signed, 'allowed', { resourceId: target })
      json(res, 200, await readDepartments(org))
      return
    }

    if (segments[0] === 'departments' && segments.length === 2 && method === 'DELETE') {
      if (!await mayProceed(res, signed, 'department.manage', 'department', org)) return
      const target = DeptId(segments[1] as string)
      try {
        await ctx.accountStore.deleteDepartment(target)
      } catch (error) {
        if (!(error instanceof DepartmentNotEmptyError)) throw error
        refuse(res, 409, 'conflict', {
          reason: 'department-not-empty',
          detail: 'Departments or accounts still belong to this department.',
        })
        return
      }
      await record('department.delete', signed, 'allowed', { resourceId: target })
      json(res, 200, await readDepartments(org))
      return
    }

    if (segments[0] === 'menus' && segments.length === 1 && method === 'POST') {
      if (!await mayProceed(res, signed, 'menu.manage', 'menu', org)) return
      const name = text(body, 'name')
      const kind = text(body, 'kind')
      if (name === undefined || kind === undefined) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A navigation entry needs a name and a kind.' })
        return
      }
      if (!MENU_KINDS.includes(kind as ConsoleMenuKind)) {
        refuse(res, 400, 'malformed', { reason: 'menu-kind', detail: 'That navigation entry kind is not supported.' })
        return
      }
      const parentId = text(body, 'parentId')
      const routePath = text(body, 'routePath')
      const componentPath = text(body, 'componentPath')
      const permission = text(body, 'permission')
      const icon = text(body, 'icon')
      const sortOrder = patchInteger(body, 'sortOrder')
      const visible = patchBoolean(body, 'visible')
      try {
        await ctx.consoleMenu.createMenu({
          orgId: org,
          name,
          kind: kind as ConsoleMenuKind,
          ...(parentId === undefined ? {} : { parentId: MenuId(parentId) }),
          ...(routePath === undefined ? {} : { routePath }),
          ...(componentPath === undefined ? {} : { componentPath }),
          ...(permission === undefined ? {} : { permission }),
          ...(icon === undefined ? {} : { icon }),
          ...(sortOrder === undefined ? {} : { sortOrder }),
          ...(visible === undefined ? {} : { visible }),
        })
      } catch (error) {
        if (!(error instanceof UnknownMenuPermissionError)) throw error
        refuse(res, 400, 'malformed', { reason: 'permission', detail: 'That permission is not registered.' })
        return
      }
      await record('menu.create', signed, 'allowed')
      json(res, 200, await readMenus(org))
      return
    }

    if (segments[0] === 'menus' && segments.length === 2 && method === 'PATCH') {
      if (!await mayProceed(res, signed, 'menu.manage', 'menu', org)) return
      const status = text(body, 'status')
      if (status !== undefined && !MENU_STATUSES.includes(status as ConsoleMenuStatus)) {
        refuse(res, 400, 'malformed', { reason: 'menu-status', detail: 'That navigation entry status is not supported.' })
        return
      }
      const kind = text(body, 'kind')
      if (kind !== undefined && !MENU_KINDS.includes(kind as ConsoleMenuKind)) {
        refuse(res, 400, 'malformed', { reason: 'menu-kind', detail: 'That navigation entry kind is not supported.' })
        return
      }
      const name = text(body, 'name')
      const sortOrder = patchInteger(body, 'sortOrder')
      const visible = patchBoolean(body, 'visible')
      const routePath = patchText(body, 'routePath')
      const componentPath = patchText(body, 'componentPath')
      const permission = patchText(body, 'permission')
      const icon = patchText(body, 'icon')
      const changes: UpdateConsoleMenu = {
        ...(name === undefined ? {} : { name }),
        ...(kind === undefined ? {} : { kind: kind as ConsoleMenuKind }),
        ...(routePath === undefined ? {} : { routePath }),
        ...(componentPath === undefined ? {} : { componentPath }),
        ...(permission === undefined ? {} : { permission }),
        ...(icon === undefined ? {} : { icon }),
        ...(sortOrder === undefined ? {} : { sortOrder }),
        ...(status === undefined ? {} : { status: status as ConsoleMenuStatus }),
        ...(visible === undefined ? {} : { visible }),
      }
      const target = MenuId(segments[1] as string)
      try {
        await ctx.consoleMenu.updateMenu(target, changes)
      } catch (error) {
        if (!(error instanceof UnknownMenuPermissionError)) throw error
        refuse(res, 400, 'malformed', { reason: 'permission', detail: 'That permission is not registered.' })
        return
      }
      await record('menu.update', signed, 'allowed', { resourceId: target })
      json(res, 200, await readMenus(org))
      return
    }

    if (segments[0] === 'menus' && segments.length === 2 && method === 'DELETE') {
      if (!await mayProceed(res, signed, 'menu.manage', 'menu', org)) return
      const target = MenuId(segments[1] as string)
      try {
        await ctx.consoleMenu.deleteMenu(target)
      } catch (error) {
        if (!(error instanceof ConsoleMenuNotEmptyError)) throw error
        refuse(res, 409, 'conflict', {
          reason: 'menu-not-empty',
          detail: 'Other navigation entries still sit under this one.',
        })
        return
      }
      await record('menu.delete', signed, 'allowed', { resourceId: target })
      json(res, 200, await readMenus(org))
      return
    }

    if (segments[0] === 'members' && segments[2] === 'roles' && method === 'POST' && segments.length === 3) {
      if (!await mayProceed(res, signed, 'member.role.bind', 'member', org)) return
      const roleId = text(body, 'roleId')
      if (roleId === undefined) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A binding needs a role.' })
        return
      }
      await ctx.accessControl.bindUserRole(UserId(segments[1] as string), RoleId(roleId))
      await record('binding.add', signed, 'allowed')
      json(res, 200, await readMembers(org))
      return
    }

    if (segments[0] === 'members' && segments[2] === 'roles' && method === 'DELETE' && segments.length === 4) {
      if (!await mayProceed(res, signed, 'member.role.bind', 'member', org)) return
      await ctx.accessControl.unbindUserRole(
        UserId(segments[1] as string),
        RoleId(segments[3] as string),
      )
      await record('binding.remove', signed, 'allowed')
      json(res, 200, await readMembers(org))
      return
    }

    if (segments[0] === 'roles' && segments.length === 1 && method === 'POST') {
      if (!await mayProceed(res, signed, 'role.create', 'role', org)) return
      const roleName = text(body, 'name')
      if (roleName === undefined) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A role needs a name.' })
        return
      }
      const roleCode = text(body, 'code')
      try {
        await ctx.accessControl.createRole({
          orgId: org,
          name: roleName,
          ...(roleCode === undefined ? {} : { code: roleCode }),
          description: text(body, 'description') ?? '',
        })
      } catch (error) {
        refuseRoleConflict(res, error)
        return
      }
      await record('role.create', signed, 'allowed')
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'roles' && segments.length === 2 && method === 'PATCH') {
      if (!await mayProceed(res, signed, 'role.update', 'role', org)) return
      const roleName = text(body, 'name')
      const roleCode = text(body, 'code')
      const description = patchText(body, 'description')
      const covers = patchBoolean(body, 'coversCatalog')
      // Marking a role as covering the catalog widens what it admits, which is
      // grant management rather than editing how the role reads.
      if (covers !== undefined && !await mayProceed(res, signed, 'role.grant.manage', 'role', org)) return
      const target = RoleId(segments[1] as string)
      try {
        await ctx.accessControl.updateRole(target, {
          ...(roleName === undefined ? {} : { name: roleName }),
          ...(roleCode === undefined ? {} : { code: roleCode }),
          ...(description === undefined ? {} : { description: description ?? '' }),
          ...(covers === undefined ? {} : { coversCatalog: covers }),
        })
        // The mark alone grants nothing; bringing the role up to the catalog is
        // what makes it true, and it happens here rather than at the next start.
        if (covers === true) await ctx.accessControl.syncCatalogRole(target)
      } catch (error) {
        refuseRoleConflict(res, error)
        return
      }
      await record('role.update', signed, 'allowed', { resourceId: target })
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'roles' && segments.length === 2 && method === 'DELETE') {
      if (!await mayProceed(res, signed, 'role.delete', 'role', org)) return
      const target = RoleId(segments[1] as string)
      try {
        await ctx.accessControl.deleteRole(target)
      } catch (error) {
        if (!(error instanceof SystemRoleError)) throw error
        refuse(res, 409, 'conflict', {
          reason: 'system-role',
          detail: 'This role ships with the product and cannot be deleted.',
        })
        return
      }
      await record('role.delete', signed, 'allowed', { resourceId: target })
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'roles' && segments[2] === 'permissions' && method === 'POST' && segments.length === 3) {
      if (!await mayProceed(res, signed, 'role.grant.manage', 'role', org)) return
      const wanted = body['permissions']
      if (!Array.isArray(wanted) || wanted.some(pair => typeof pair !== 'string')) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'Permissions are a list of resourceType|action pairs.' })
        return
      }
      const unknown = (wanted as string[]).filter(pair => !isMenuPermission(pair))
      if (unknown.length > 0) {
        refuse(res, 400, 'malformed', { reason: 'permission', detail: 'That permission is not registered.' })
        return
      }
      await setRolePermissions(RoleId(segments[1] as string), new Set(wanted as string[]))
      await record('grant.add', signed, 'allowed', { resourceId: segments[1] as string })
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'roles' && segments[2] === 'models' && method === 'POST' && segments.length === 3) {
      if (!await mayProceed(res, signed, 'role.grant.manage', 'role', org)) return
      const modelIds = body['modelIds']
      if (!Array.isArray(modelIds) || modelIds.some(id => typeof id !== 'string')) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'Model access is a list of model resource ids.' })
        return
      }
      const roleId = RoleId(segments[1] as string)
      const [resources, held] = await Promise.all([
        ctx.accessControl.listResources(org, 'model'),
        ctx.accessControl.listRoleGrants(roleId),
      ])
      const resourcesById = new Map(resources.map(resource => [resource.id as string, resource]))
      const wanted = new Set(modelIds as string[])
      if ([...wanted].some(id => !resourcesById.has(id))) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'That model is not in this organization.' })
        return
      }
      const actions = new Set(['model.discover', 'model.invoke'])
      for (const grant of held) {
        if (grant.resourceType !== 'model' || !actions.has(grant.action)) continue
        if (grant.kind === 'type' || !wanted.has(grant.resourceId)) {
          await ctx.accessControl.revokeGrant(grant.id)
        }
      }
      const afterRevoke = await ctx.accessControl.listRoleGrants(roleId)
      const present = new Set(afterRevoke.flatMap(grant => grant.kind === 'resource'
        ? [`${grant.resourceId}|${grant.action}`]
        : []))
      for (const resourceId of wanted) {
        for (const action of actions) {
          if (!present.has(`${resourceId}|${action}`)) {
            await ctx.accessControl.grantResource(roleId, ResourceId(resourceId), action)
          }
        }
      }
      await ctx.accessControl.updateRole(roleId, { coversCatalog: false })
      await record('grant.add', signed, 'allowed', { resourceId: roleId })
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'roles' && segments[2] === 'menus' && method === 'POST' && segments.length === 3) {
      if (!await mayProceed(res, signed, 'role.grant.manage', 'role', org)) return
      const menuIds = body['menuIds']
      if (!Array.isArray(menuIds) || menuIds.some(id => typeof id !== 'string')) {
        refuse(res, 400, 'malformed', { reason: 'fields', detail: 'Menu access is a list of navigation entry ids.' })
        return
      }
      await setRoleMenus(org, RoleId(segments[1] as string), new Set(menuIds as string[]))
      await record('grant.add', signed, 'allowed')
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'roles' && segments[2] === 'grants' && method === 'POST' && segments.length === 3) {
      if (!await mayProceed(res, signed, 'role.grant.manage', 'role', org)) return
      const resourceType = text(body, 'resourceType')
      const action = text(body, 'action')
      const known = PERMISSION_CATALOG.some(permission =>
        permission.resourceType === resourceType && permission.action === action)
      if (!known) {
        refuse(res, 400, 'malformed', { reason: 'permission', detail: 'That permission is not registered.' })
        return
      }
      await ctx.accessControl.grantType(
        RoleId(segments[1] as string),
        resourceType as string,
        action as string,
      )
      await record('grant.add', signed, 'allowed')
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'grants' && segments.length === 2 && method === 'DELETE') {
      if (!await mayProceed(res, signed, 'role.grant.manage', 'role', org)) return
      await ctx.accessControl.revokeGrant(GrantId(segments[1] as string))
      await record('grant.revoke', signed, 'allowed')
      json(res, 200, await readRoles(org))
      return
    }

    if (segments[0] === 'devices' && segments.length === 2 && method === 'DELETE') {
      if (!await mayProceed(res, signed, 'device.revoke', 'device', org)) return
      const device = DeviceId(segments[1] as string)
      await ctx.deviceAuthorization.revokeDevice(device)
      await record('device.revoke', signed, 'allowed', { resourceId: device })
      json(res, 200, (await ctx.deviceAuthorization.listDevices(org)).map(wireDevice))
      return
    }

    if (segments[0] === 'models' && segments.length === 1 && method === 'POST') {
      if (!await mayProceed(res, signed, 'model.catalog.manage', 'model', MODEL_CATALOG_RESOURCE)) return
      const registered = await registerModel(res, signed, org, body)
      if (!registered) return
      json(res, 200, await readModels(org))
      return
    }

    if (segments[0] === 'models' && segments.length === 2 && method === 'PATCH') {
      if (!await mayProceed(res, signed, 'model.catalog.manage', 'model', MODEL_CATALOG_RESOURCE)) return
      const status = text(body, 'status')
      if (!MODEL_STATUSES.includes(status as ModelStatus)) {
        refuse(res, 400, 'malformed', { reason: 'model-status', detail: 'That model status is not supported.' })
        return
      }
      const modelRef = segments[1] as string
      await ctx.modelGateway.setStatus(org, modelRef, status as ModelStatus)
      await record(
        status === 'active' ? 'resource.enable' : 'resource.disable',
        signed, 'allowed', { resourceId: modelRef },
      )
      json(res, 200, await readModels(org))
      return
    }

    refuse(res, 404, 'not-found')
  }

  /**
   * Put one model in the catalog, refusing what no call could reach.
   * @returns true when the entry was stored.
   */
  const registerModel = async (
    res: ServerResponse, signed: Signed, org: OrgId, body: Record<string, unknown>,
  ): Promise<boolean> => {
    const fields = ['modelRef', 'displayName', 'providerRef', 'upstreamModel', 'endpoint', 'credentialRef']
      .map(field => text(body, field))
    if (fields.some(value => value === undefined)) {
      refuse(res, 400, 'malformed', { reason: 'fields', detail: 'A model needs every route field.' })
      return false
    }
    const maxOutputTokens = Number(body['maxOutputTokens'])
    let endpoint: URL
    try {
      endpoint = new URL(fields[4] as string)
    } catch {
      refuse(res, 400, 'malformed', { reason: 'endpoint', detail: 'The provider endpoint must be an absolute URL.' })
      return false
    }
    if (endpoint.protocol !== 'https:' || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
      refuse(res, 400, 'malformed', { reason: 'endpoint-security', detail: 'Use an HTTPS endpoint and a positive whole-token ceiling.' })
      return false
    }
    // A credential key and a credential reference address different things,
    // and only the reference resolves at call time. Refusing it here keeps an
    // administrator from registering a model that reads as active and fails
    // every invocation.
    if (!isUsableCredentialRef(fields[5] as string)) {
      refuse(res, 400, 'malformed', { reason: 'credential', detail: 'The credential reference must be a name like COMPANY_DEEPSEEK_KEY.' })
      return false
    }
    await ctx.modelGateway.register({
      orgId: org,
      modelRef: fields[0] as string,
      displayName: fields[1] as string,
      providerRef: fields[2] as string,
      upstreamModel: fields[3] as string,
      endpoint: endpoint.href,
      credentialRef: fields[5] as string,
      maxOutputTokens,
    })
    await record('resource.register', signed, 'allowed', { resourceId: fields[0] as string })
    return true
  }

  const api: WebRoute = {
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (req, res) => {
      /* v8 ignore next -- node:http always supplies url on server requests. */
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const segments = url.pathname.slice(API_PREFIX.length).split('/').filter(part => part !== '')
        .map(part => decodeURIComponent(part))
      /* v8 ignore next -- node:http always supplies method on server requests. */
      const method = req.method ?? 'GET'
      try {
        if (method === 'GET') await read(req, res, segments)
        else if (method === 'POST' || method === 'PATCH' || method === 'DELETE') {
          await write(req, res, method, segments)
        } else refuse(res, 405, 'malformed', { detail: 'This address does not accept that method.' })
      } catch (error) {
        // Every route answers as its last act, so nothing has been written when
        // this runs. Without it the web server replies with its own bare 400,
        // telling a signed-in administrator their request was malformed when
        // the site is what could not serve it.
        ctx.logger.warn(error)
        refuse(res, 500, 'unavailable', { detail: 'This site could not answer. Try again shortly.' })
      }
    },
  }

  ctx.effect(() => ctx.webServer.register(api), `team-admin-api: ${API_PREFIX}`)
}
