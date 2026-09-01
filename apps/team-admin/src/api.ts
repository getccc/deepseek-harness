/**
 * Talking to the Control Plane.
 *
 * One place carries the CSRF value the session handed out and turns a refusal
 * into something the console can switch on, so no view builds a request by
 * hand and no view parses an error body twice.
 */

import type {
  WireDepartment,
  WireDevice,
  WireMember,
  WireMenu,
  WireModel,
  WireOrganization,
  WireOverview,
  WirePermission,
  WireRefusal,
  WireRefusalReason,
  WireRole,
  WireSession,
} from '@deepseek-ai/dsh-team-admin-api'

export type {
  SecretCharacterClass, WireDepartment, WireDevice, WireGrant, WireMember, WireMenu, WireModel,
  WireOrganization, WireOverview, WirePermission, WireRole, WireSecretPolicy, WireSession,
} from '@deepseek-ai/dsh-team-admin-api'

/** The fields the company row's form collects; an empty string clears a stored one. */
export interface OrganizationInput {
  name: string
  code?: string
  leaderId?: string
  phone?: string
  email?: string
}

/** The fields a department form collects; an empty string clears a stored one. */
export interface DepartmentInput {
  name: string
  code: string
  parentId?: string
  category?: 'company' | 'department'
  leaderId?: string
  phone?: string
  email?: string
  sortOrder?: number
}

/** The fields a navigation-entry form collects. */
export interface MenuInput {
  name: string
  kind: 'catalog' | 'menu' | 'action'
  parentId?: string
  routePath?: string
  componentPath?: string
  permission?: string
  icon?: string
  sortOrder?: number
  visible?: boolean
}

/** The account fields an administrator may edit after issuing the account. */
export interface MemberProfileInput {
  displayName?: string
  email?: string
  phone?: string
  gender?: 'male' | 'female' | 'unspecified' | ''
  departmentId?: string
}

/** Address prefix the Control Plane serves the administration API under. */
const API_PREFIX = '/team/api'

/** Header a write echoes the session's CSRF value in. */
const CSRF_HEADER = 'x-dsh-csrf'

/**
 * A request the Control Plane did not carry out.
 *
 * `error` is the word to switch on; `detail` is the server's own sentence and
 * is shown only when the console has nothing better to say.
 */
export class ApiError extends Error {
  constructor(
    readonly error: WireRefusal['error'],
    readonly reason?: WireRefusalReason,
    readonly detail?: string,
  ) {
    super(detail ?? error)
    this.name = 'ApiError'
  }
}

/** The CSRF value of the session this page is running under. */
let csrf = ''

/**
 * Remember the CSRF value a session handed out.
 * @param value - the value every later write echoes.
 */
export function holdCsrf(value: string): void {
  csrf = value
}

/**
 * Make one request and read its JSON.
 * @param method - the HTTP method.
 * @param path - the address under the API prefix.
 * @param body - the request body, for a method that takes one.
 * @returns the parsed answer.
 * @throws {ApiError} when the Control Plane refuses or cannot be reached.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      // Same-origin only: the console is served by the Control Plane it talks
      // to, and a cookie should never travel further than that.
      credentials: 'same-origin',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(method === 'GET' ? {} : { [CSRF_HEADER]: csrf }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch {
    // A network failure is not a refusal, and telling a member their roles are
    // insufficient when the server is unreachable would send them to an
    // administrator for nothing.
    throw new ApiError('unavailable')
  }
  const answer: unknown = await response.json().catch(() => ({ error: 'unavailable' }))
  if (response.ok) return answer as T
  const refusal = answer as WireRefusal
  throw new ApiError(refusal.error, refusal.reason, refusal.detail)
}

/** Everything the console asks the Control Plane for. */
export const api = {
  /** Who is signed in, what they hold, and the CSRF value writes must echo. */
  session: (): Promise<WireSession> => call('GET', '/session'),
  /** Sign in with a member name and password. */
  signIn: (loginName: string, secret: string): Promise<WireSession> =>
    call('POST', '/session', { loginName, secret }),
  /** End this session. */
  signOut: (): Promise<{ ended: boolean }> => call('DELETE', '/session'),

  /** The counts on the overview. */
  overview: (): Promise<WireOverview> => call('GET', '/overview'),
  /** The organization this deployment serves. */
  organization: (): Promise<WireOrganization> => call('GET', '/organization'),
  /** Change the organization's own fields, the way an edit changes a department. */
  updateOrganization: (input: OrganizationInput): Promise<WireOrganization> =>
    call('PATCH', '/organization', input),

  /** Every member, with the roles this console could also unbind. */
  members: (): Promise<WireMember[]> => call('GET', '/members'),
  /** Issue one account. */
  addMember: (input: {
    loginName: string
    displayName: string
    secret: string
    email?: string
    phone?: string
    gender?: string
    departmentId?: string
  }): Promise<WireMember[]> => call('POST', '/members', input),
  /** Change one account's profile fields. */
  updateMember: (id: string, input: MemberProfileInput): Promise<WireMember[]> =>
    call('PATCH', `/members/${encodeURIComponent(id)}`, input),
  /** Delete one account, with its role bindings, devices, and sessions. */
  removeMember: (id: string): Promise<WireMember[]> =>
    call('DELETE', `/members/${encodeURIComponent(id)}`),
  /** Suspend or reactivate one account. */
  setMemberStatus: (id: string, status: 'active' | 'suspended'): Promise<WireMember[]> =>
    call('PATCH', `/members/${encodeURIComponent(id)}`, { status }),
  /** Replace one account's password and end every session and device credential it holds. */
  resetMemberPassword: (id: string, secret: string): Promise<{ reset: true; self: boolean }> =>
    call('PATCH', `/members/${encodeURIComponent(id)}/password`, { secret }),
  /** Bind one role to one member. */
  bindRole: (id: string, roleId: string): Promise<WireMember[]> =>
    call('POST', `/members/${encodeURIComponent(id)}/roles`, { roleId }),
  /** Take one role away from one member. */
  unbindRole: (id: string, roleId: string): Promise<WireMember[]> =>
    call('DELETE', `/members/${encodeURIComponent(id)}/roles/${encodeURIComponent(roleId)}`),

  /** Every department of this organization, parents before their children. */
  departments: (): Promise<WireDepartment[]> => call('GET', '/departments'),
  /** Create one department. */
  addDepartment: (input: DepartmentInput): Promise<WireDepartment[]> =>
    call('POST', '/departments', input),
  /** Change one department. */
  updateDepartment: (
    id: string,
    input: Partial<DepartmentInput> & { status?: 'active' | 'suspended' },
  ): Promise<WireDepartment[]> => call('PATCH', `/departments/${encodeURIComponent(id)}`, input),
  /** Delete one department. */
  removeDepartment: (id: string): Promise<WireDepartment[]> =>
    call('DELETE', `/departments/${encodeURIComponent(id)}`),

  /** The console's navigation, which needs a session and no grant. */
  menus: (): Promise<WireMenu[]> => call('GET', '/menus'),
  /** Create one navigation entry. */
  addMenu: (input: MenuInput): Promise<WireMenu[]> => call('POST', '/menus', input),
  /** Change one navigation entry. */
  updateMenu: (
    id: string,
    input: Partial<MenuInput> & { status?: 'active' | 'suspended' },
  ): Promise<WireMenu[]> => call('PATCH', `/menus/${encodeURIComponent(id)}`, input),
  /** Delete one navigation entry. */
  removeMenu: (id: string): Promise<WireMenu[]> =>
    call('DELETE', `/menus/${encodeURIComponent(id)}`),

  /** Every role with its grants. */
  roles: (): Promise<WireRole[]> => call('GET', '/roles'),
  /** Create one role. */
  addRole: (input: { name: string; code?: string; description?: string }): Promise<WireRole[]> =>
    call('POST', '/roles', input),
  /** Change one role's name, code, description, or catalog coverage. */
  updateRole: (
    id: string,
    input: { name?: string; code?: string; description?: string; coversCatalog?: boolean },
  ): Promise<WireRole[]> => call('PATCH', `/roles/${encodeURIComponent(id)}`, input),
  /** Make one role's type grants exactly these `resourceType|action` pairs. */
  setRolePermissions: (id: string, permissions: readonly string[]): Promise<WireRole[]> =>
    call('POST', `/roles/${encodeURIComponent(id)}/permissions`, { permissions }),
  /** Make one role's model grants match these exact managed models. */
  setRoleModels: (id: string, modelIds: readonly string[]): Promise<WireRole[]> =>
    call('POST', `/roles/${encodeURIComponent(id)}/models`, { modelIds }),
  /** Delete one role, with its grants and the bindings carrying it. */
  removeRole: (id: string): Promise<WireRole[]> =>
    call('DELETE', `/roles/${encodeURIComponent(id)}`),
  /** Make one role's grants match the navigation entries it is given. */
  setRoleMenus: (id: string, menuIds: readonly string[]): Promise<WireRole[]> =>
    call('POST', `/roles/${encodeURIComponent(id)}/menus`, { menuIds }),
  /** Add one catalog permission to one role. */
  addGrant: (roleId: string, resourceType: string, action: string): Promise<WireRole[]> =>
    call('POST', `/roles/${encodeURIComponent(roleId)}/grants`, { resourceType, action }),
  /** Take one grant away. */
  revokeGrant: (grantId: string): Promise<WireRole[]> =>
    call('DELETE', `/grants/${encodeURIComponent(grantId)}`),
  /** Every `(resourceType, action)` pair a grant may name. */
  permissions: (): Promise<WirePermission[]> => call('GET', '/permissions'),

  /** Every computer bound in this organization. */
  devices: (): Promise<WireDevice[]> => call('GET', '/devices'),
  /** Stop one computer's credential working. */
  revokeDevice: (id: string): Promise<WireDevice[]> =>
    call('DELETE', `/devices/${encodeURIComponent(id)}`),

  /** The company model catalog. */
  models: (): Promise<WireModel[]> => call('GET', '/models'),
  /** Put one model in the catalog, or update the one already there. */
  addModel: (input: {
    modelRef: string
    displayName: string
    providerRef: string
    upstreamModel: string
    endpoint: string
    credentialRef: string
    maxOutputTokens: number
  }): Promise<WireModel[]> => call('POST', '/models', input),
  /** Withdraw one model from service, or return it. */
  setModelStatus: (modelRef: string, status: 'active' | 'retired'): Promise<WireModel[]> =>
    call('PATCH', `/models/${encodeURIComponent(modelRef)}`, { status }),
}
