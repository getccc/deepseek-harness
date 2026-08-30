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
  GrantId,
  PERMISSION_CATALOG,
  RoleId,
  type AccessControl,
  type Role,
  type RoleGrant,
} from '@deepseek-ai/dsh-access-control'
import {
  DuplicateLoginNameError,
  OrgId,
  UserId,
  type AccountUser,
  type Organization,
} from '@deepseek-ai/dsh-account-store'
import type {} from '@deepseek-ai/dsh-account-auth'
import type { AuditActionName, AuditOutcome } from '@deepseek-ai/dsh-audit'
import { DeviceId, type Device } from '@deepseek-ai/dsh-device-authorization'
import {
  MODEL_STATUSES,
  isUsableCredentialRef,
  type ModelEntry,
  type ModelStatus,
} from '@deepseek-ai/dsh-model-gateway'
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
import { CSRF_HEADER, json, readJson, refuse, text } from './http.ts'
import type {
  WireDevice,
  WireGrant,
  WireMember,
  WireModel,
  WireOrganization,
  WireOverview,
  WireRole,
} from './types.ts'

export { CSRF_HEADER } from './http.ts'
export type {
  WireDevice,
  WireGrant,
  WireMember,
  WireModel,
  WireOrganization,
  WireOverview,
  WirePermission,
  WireRefusal,
  WireRole,
  WireRoleRef,
  WireSession,
} from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'team-admin-api'

/** Services required before the API can claim its routes. */
export const inject = [
  'webServer', 'accountStore', 'accountAuth', 'accessControl', 'audit',
  'deviceAuthorization', 'modelGateway',
]

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

/** Project one organization for the browser. */
function wireOrganization(org: Organization): WireOrganization {
  return {
    id: org.id,
    name: org.name,
    policyRevision: org.policyRevision.toString(),
    createdAt: org.createdAt,
  }
}

/** Project one member, with the roles this console could also unbind. */
function wireMember(member: AccountUser, roles: readonly Role[]): WireMember {
  return {
    id: member.id,
    loginName: member.loginName,
    displayName: member.displayName,
    ...(member.email === undefined ? {} : { email: member.email }),
    status: member.status,
    createdAt: member.createdAt,
    ...(member.lastLoginAt === undefined ? {} : { lastLoginAt: member.lastLoginAt }),
    roles: roles.map(role => ({ id: role.id, name: role.name })),
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
      resourceDisplayName: grant.resourceDisplayName,
    }
}

/** Project one role and its composition. */
function wireRole(role: Role, grants: readonly RoleGrant[]): WireRole {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    kind: role.kind,
    grants: grants.map(wireGrant),
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
function wireModel(entry: ModelEntry): WireModel {
  return {
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
      ['role', organizationId, 'Role administration'],
      ['device', organizationId, 'Device administration'],
      ['model', MODEL_CATALOG_RESOURCE, 'Model catalog administration'],
    ] as const) {
      await ctx.accessControl.registerResource({ orgId: organizationId, type, externalRef, displayName })
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

  /** Read the account a session stands for; a session cannot outlive it either. */
  const readMember = async (userId: UserId): Promise<AccountUser> => {
    const member = await ctx.accountStore.getUser(userId)
    if (member === undefined) throw new Error(`team-admin-api: session names no account ${userId}`)
    return member
  }

  /**
   * Answer a read that must carry a session.
   * @returns the session, or undefined when the caller already answered 401.
   */
  const requireSession = async (req: IncomingMessage, res: ServerResponse): Promise<Signed | undefined> => {
    const signed = await currentSession(ctx.accountStore, req)
    if (signed === undefined) refuse(res, 401, 'unauthenticated')
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
      refuse(res, 403, 'forbidden', 'This request did not come from this site.')
      return undefined
    }
    const signed = await currentSession(ctx.accountStore, req)
    if (signed === undefined) {
      refuse(res, 401, 'unauthenticated')
      return undefined
    }
    const supplied = req.headers[CSRF_HEADER]
    if (typeof supplied !== 'string' || !csrfMatches(signed.token, supplied)) {
      refuse(res, 403, 'forbidden', 'This session token is out of date. Reload and try again.')
      return undefined
    }
    if (!expectBody) return { signed, body: {} }
    const body = await readJson(req, config.maxRequestBodyBytes)
    if (body === 'too-large') {
      refuse(res, 413, 'too-large')
      return undefined
    }
    if (body === 'malformed') {
      refuse(res, 400, 'malformed', 'The request body is not a JSON object.')
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
    refuse(res, 403, 'forbidden', 'Your roles do not include this.')
    return false
  }

  /** Every member with the roles from this organization they hold. */
  const readMembers = async (orgId: OrgId): Promise<WireMember[]> => {
    const [members, roles] = await Promise.all([
      ctx.accountStore.listUsers(orgId),
      ctx.accessControl.listRoles(orgId),
    ])
    // Nothing stops a role binding from naming a role in another organization,
    // and this console administers one: a member's roles are the ones this API
    // could also unbind, not every binding they carry.
    const roleById = new Map(roles.map(role => [role.id, role]))
    return Promise.all(members.map(async member => wireMember(
      member,
      (await ctx.accessControl.rolesOf(member.id)).flatMap(id => roleById.get(id) ?? []),
    )))
  }

  /** Every role with its grants. */
  const readRoles = async (orgId: OrgId): Promise<WireRole[]> => {
    const roles = await ctx.accessControl.listRoles(orgId)
    return Promise.all(roles.map(async role => wireRole(
      role,
      await ctx.accessControl.listRoleGrants(role.id),
    )))
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
      refuse(res, 403, 'forbidden', 'This request did not come from this site.')
      return
    }
    const body = await readJson(req, config.maxRequestBodyBytes)
    if (body === 'too-large') {
      refuse(res, 413, 'too-large')
      return
    }
    if (body === 'malformed') {
      refuse(res, 400, 'malformed', 'The request body is not a JSON object.')
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
      refuse(res, 401, 'unauthenticated', 'That member and password do not match.')
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
      organization: wireOrganization(await readOrganization()),
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
      organization: wireOrganization(await readOrganization()),
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
      json(res, 200, wireOrganization(await readOrganization()))
      return
    }
    if (segments[0] === 'members' && segments.length === 1) {
      if (!await mayProceed(res, signed, 'member.read', 'member', org)) return
      json(res, 200, await readMembers(org))
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
      json(res, 200, (await ctx.modelGateway.list(org)).map(wireModel))
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
        refuse(res, 400, 'malformed', 'An organization needs a name.')
        return
      }
      await ctx.accountStore.setOrganizationName(org, name)
      await record('policy.update', signed, 'allowed', { resourceId: org })
      json(res, 200, wireOrganization(await readOrganization()))
      return
    }

    if (segments[0] === 'members' && segments.length === 1 && method === 'POST') {
      if (!await mayProceed(res, signed, 'member.create', 'member', org)) return
      const loginName = text(body, 'loginName')
      const displayName = text(body, 'displayName')
      if (loginName === undefined || displayName === undefined) {
        refuse(res, 400, 'malformed', 'A member needs a login name and a display name.')
        return
      }
      const email = text(body, 'email')
      try {
        await ctx.accountStore.createUser({
          orgId: org, loginName, displayName, ...(email === undefined ? {} : { email }),
        })
      } catch (error) {
        // The store owns login-name uniqueness; a second account with the same
        // name is the administrator's mistake, not the site's failure.
        if (!(error instanceof DuplicateLoginNameError)) throw error
        refuse(res, 409, 'conflict', 'That login name is already in this organization.')
        return
      }
      await record('member.create', signed, 'allowed')
      json(res, 200, await readMembers(org))
      return
    }

    if (segments[0] === 'members' && segments.length === 2 && method === 'PATCH') {
      const status = text(body, 'status')
      if (status !== 'active' && status !== 'suspended') {
        refuse(res, 400, 'malformed', 'That account status is not supported.')
        return
      }
      const action = status === 'active' ? 'member.enable' : 'member.disable'
      if (!await mayProceed(res, signed, action, 'member', org)) return
      const target = UserId(segments[1] as string)
      // Suspending is the whole act: a session resolves through its account, so
      // the sessions this member holds stop working with the status change
      // rather than needing a second call someone has to remember.
      await ctx.accountStore.setUserStatus(target, status)
      await record(action, signed, 'allowed', { resourceId: target })
      json(res, 200, await readMembers(org))
      return
    }

    if (segments[0] === 'members' && segments[2] === 'roles' && method === 'POST' && segments.length === 3) {
      if (!await mayProceed(res, signed, 'member.role.bind', 'member', org)) return
      const roleId = text(body, 'roleId')
      if (roleId === undefined) {
        refuse(res, 400, 'malformed', 'A binding needs a role.')
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
        refuse(res, 400, 'malformed', 'A role needs a name.')
        return
      }
      await ctx.accessControl.createRole({
        orgId: org, name: roleName, description: text(body, 'description') ?? '',
      })
      await record('role.create', signed, 'allowed')
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
        refuse(res, 400, 'malformed', 'That permission is not registered.')
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
      json(res, 200, (await ctx.modelGateway.list(org)).map(wireModel))
      return
    }

    if (segments[0] === 'models' && segments.length === 2 && method === 'PATCH') {
      if (!await mayProceed(res, signed, 'model.catalog.manage', 'model', MODEL_CATALOG_RESOURCE)) return
      const status = text(body, 'status')
      if (!MODEL_STATUSES.includes(status as ModelStatus)) {
        refuse(res, 400, 'malformed', 'That model status is not supported.')
        return
      }
      const modelRef = segments[1] as string
      await ctx.modelGateway.setStatus(org, modelRef, status as ModelStatus)
      await record(
        status === 'active' ? 'resource.enable' : 'resource.disable',
        signed, 'allowed', { resourceId: modelRef },
      )
      json(res, 200, (await ctx.modelGateway.list(org)).map(wireModel))
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
      refuse(res, 400, 'malformed', 'A model needs every route field.')
      return false
    }
    const maxOutputTokens = Number(body['maxOutputTokens'])
    let endpoint: URL
    try {
      endpoint = new URL(fields[4] as string)
    } catch {
      refuse(res, 400, 'malformed', 'The provider endpoint must be an absolute URL.')
      return false
    }
    if (endpoint.protocol !== 'https:' || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1) {
      refuse(res, 400, 'malformed', 'Use an HTTPS endpoint and a positive whole-token ceiling.')
      return false
    }
    // A credential key and a credential reference address different things,
    // and only the reference resolves at call time. Refusing it here keeps an
    // administrator from registering a model that reads as active and fails
    // every invocation.
    if (!isUsableCredentialRef(fields[5] as string)) {
      refuse(res, 400, 'malformed', 'The credential reference must be a name like COMPANY_DEEPSEEK_KEY.')
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
        } else refuse(res, 405, 'malformed', 'This address does not accept that method.')
      } catch (error) {
        // Every route answers as its last act, so nothing has been written when
        // this runs. Without it the web server replies with its own bare 400,
        // telling a signed-in administrator their request was malformed when
        // the site is what could not serve it.
        ctx.logger.warn(error)
        refuse(res, 500, 'unavailable', 'This site could not answer. Try again shortly.')
      }
    },
  }

  ctx.effect(() => ctx.webServer.register(api), `team-admin-api: ${API_PREFIX}`)
}
