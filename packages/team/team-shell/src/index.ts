/**
 * The Team Shell: the Control Plane's own pages.
 *
 * Signing in, confirming a computer, and the administrative pages for members,
 * roles, and devices. Every write is authorized twice — the session says who is
 * asking, and access control says whether they may — and every one of them
 * leaves an audit record naming the principal that made it.
 * @module @deepseek-ai/dsh-team-shell
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import type {} from '@deepseek-ai/dsh-account-auth'
import { RoleId } from '@deepseek-ai/dsh-access-control'
import { DeviceId, TransactionId } from '@deepseek-ai/dsh-device-authorization'
import type { AuditActionName, AuditOutcome, AuditReason } from '@deepseek-ai/dsh-audit'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { ADMIN_PREFIX, CONFIRM_PREFIX, LOGIN_PATH, LOGOUT_PATH } from './paths.ts'
import {
  confirmPage,
  devicesPage,
  loginPage,
  membersPage,
  noticePage,
  rolesPage,
} from './pages.ts'
import {
  csrfMatches,
  csrfToken,
  currentSession,
  hashToken,
  newSessionToken,
  sameOrigin,
  writeSessionCookie,
  type Signed,
} from './session.ts'

export { ADMIN_PREFIX, CONFIRM_PREFIX, LOGIN_PATH, LOGOUT_PATH } from './paths.ts'
export { SESSION_COOKIE } from './session.ts'

/** Cordis plugin name. */
export const name = 'team-shell'
/** Services required before the pages may register. */
export const inject = ['webServer', 'accountStore', 'accountAuth', 'accessControl', 'audit', 'deviceAuthorization']

/** Plugin config: how long a session lasts, and whether the cookie is Secure. */
export interface Config {
  /**
   * The organization this Control Plane serves. The first version is
   * single-organization, and naming it here is what keeps that a stated fact
   * rather than something the shell infers from whatever the store happens to
   * hold.
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
  /** Largest form body accepted, in bytes. */
  maxRequestBodyBytes: number
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  organizationId: z.string().required(),
  sessionMaxAgeSeconds: z.natural().min(1).default(43_200),
  secureCookie: z.boolean().default(true),
  maxRequestBodyBytes: z.natural().min(1).default(16 * 1024),
})

/** Write one HTML page. */
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** Send the browser somewhere else. */
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { 'cache-control': 'no-store', location, 'referrer-policy': 'no-referrer' })
  res.end()
}

/** Read a form body, or the reason it cannot be read. */
async function readForm(req: IncomingMessage, limit: number): Promise<URLSearchParams | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > limit) return undefined
    chunks.push(buffer)
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Read one submitted field.
 *
 * A field a form did not carry reads as empty rather than absent, because every
 * caller below hands the value to something that already refuses an empty one —
 * a store that requires a login name, a seam that requires a role id. Spelling
 * the fallback once keeps that one decision in one place.
 * @param form - the submitted form or query.
 * @param name - the field to read.
 * @returns the value, or the empty string.
 */
function field(form: URLSearchParams, name: string): string {
  return form.get(name) ?? ''
}

/**
 * Read the fields an action cannot proceed without.
 *
 * A browser that submitted the rendered form always carries them; one that did
 * not is telling this page something it has no way to act on, and an empty
 * login name or role id must not reach a store that would happily hold it.
 * @param res - the response, owned by this function when it returns undefined.
 * @param form - the submitted form.
 * @param names - the fields the action requires.
 * @returns the values in order, or undefined when any of them is empty.
 */
function requireFields(
  res: ServerResponse,
  form: URLSearchParams,
  ...names: string[]
): string[] | undefined {
  const values = names.map(name => field(form, name))
  if (values.every(value => value.length > 0)) return values
  html(res, 400, noticePage('Cannot continue', 'That form was missing something it needs.'))
  return undefined
}

/** The path a browser should come back to after signing in. */
function safeNext(candidate: string | null): string {
  // Only a same-origin path: a `next` that named another site would turn the
  // sign-in page into an open redirect.
  return candidate !== null && candidate.startsWith('/') && !candidate.startsWith('//')
    ? candidate
    : `${ADMIN_PREFIX}/members`
}

/**
 * Register the Team Shell pages.
 * @param ctx - Host plugin context carrying the web server, the stores, and the seams.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  // Self-contained misconfiguration, so it fails at load rather than at the
  // first sign-in against an organization that does not exist.
  if (config.organizationId.trim().length === 0) {
    throw new Error('team-shell: organizationId must name the organization this Control Plane serves')
  }
  const organizationId = OrgId(config.organizationId)
  /** Record one administrative act, naming who performed it. */
  const record = (
    action: AuditActionName,
    session: Signed,
    outcome: AuditOutcome,
    extra: { resourceId?: string; reason?: AuditReason } = {},
  ): Promise<unknown> => ctx.audit.record({
    orgId: session.session.orgId,
    principalId: session.session.userId,
    action,
    outcome,
    ...extra,
  })

  /**
   * Answer a request that must carry a session, or send it to sign in.
   * @returns the session, or undefined when the caller already answered.
   */
  const requireSession = async (req: IncomingMessage, res: ServerResponse): Promise<Signed | undefined> => {
    const signed = await currentSession(ctx.accountStore, req)
    if (signed !== undefined) return signed
    /* v8 ignore next -- node:http always supplies url on server requests. */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    redirect(res, `${LOGIN_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`)
    return undefined
  }

  /**
   * Accept a write: it must carry a session, come from this site, and echo the
   * session's own CSRF token. All three, because a cookie alone travels with a
   * request a member never made.
   */
  const acceptWrite = async (req: IncomingMessage, res: ServerResponse): Promise<
    { signed: Signed; form: URLSearchParams } | undefined
  > => {
    if (req.method !== 'POST') {
      html(res, 405, noticePage('Cannot continue', 'This address accepts a form submission.'))
      return undefined
    }
    if (!sameOrigin(req)) {
      html(res, 403, noticePage('Cannot continue', 'This form did not come from this site.'))
      return undefined
    }
    const signed = await currentSession(ctx.accountStore, req)
    if (signed === undefined) {
      html(res, 403, noticePage('Cannot continue', 'Sign in and try again.'))
      return undefined
    }
    const form = await readForm(req, config.maxRequestBodyBytes)
    if (form === undefined) {
      html(res, 413, noticePage('Cannot continue', 'That was larger than this page accepts.'))
      return undefined
    }
    if (!csrfMatches(signed.token, field(form, 'csrf'))) {
      html(res, 403, noticePage('Cannot continue', 'This form is out of date. Reload the page and try again.'))
      return undefined
    }
    return { signed, form }
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
    html(res, 403, noticePage('Not allowed', 'Your roles do not include this.'))
    return false
  }

  const login: WebRoute = {
    kind: 'exact',
    path: LOGIN_PATH,
    handler: async (req, res) => {
      /* v8 ignore next -- node:http always supplies url on server requests. */
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      if (req.method === 'GET') {
        html(res, 200, loginPage(undefined, safeNext(url.searchParams.get('next'))))
        return
      }
      if (req.method !== 'POST') {
        html(res, 405, noticePage('Cannot continue', 'This address accepts a form submission.'))
        return
      }
      // Signing in is a write like any other. Without this, a form on another
      // site could sign a member into an account that site controls, and every
      // page they then reached would be that account's.
      if (!sameOrigin(req)) {
        html(res, 403, noticePage('Cannot continue', 'This form did not come from this site.'))
        return
      }
      const form = await readForm(req, config.maxRequestBodyBytes)
      if (form === undefined) {
        html(res, 413, noticePage('Cannot continue', 'That was larger than this page accepts.'))
        return
      }
      const next = safeNext(form.get('next'))
      const outcome = await ctx.accountAuth.authenticate(
        organizationId,
        field(form, 'loginName'),
        field(form, 'secret'),
      )
      if (!outcome.ok) {
        // One message for every failure: which of "no such member", "wrong
        // password", and "locked" it was is exactly what an attacker wants.
        await ctx.audit.record({
          orgId: organizationId,
          action: 'member.login',
          outcome: 'denied',
          reason: 'invalid-credentials',
          metadata: { authMethod: 'password' },
        })
        html(res, 401, loginPage('That member and password do not match.', next))
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
      redirect(res, next)
    },
  }

  const logout: WebRoute = {
    kind: 'exact',
    path: LOGOUT_PATH,
    handler: async (req, res) => {
      const accepted = await acceptWrite(req, res)
      if (accepted === undefined) return
      await ctx.accountStore.revokeBrowserSession(hashToken(accepted.signed.token))
      await record('member.logout', accepted.signed, 'allowed')
      writeSessionCookie(res, '', 0, config.secureCookie)
      redirect(res, LOGIN_PATH)
    },
  }

  const confirm: WebRoute = {
    kind: 'prefix',
    path: CONFIRM_PREFIX,
    handler: async (req, res) => {
      /* v8 ignore next -- node:http always supplies url on server requests. */
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const id = TransactionId(decodeURIComponent(url.pathname.slice(CONFIRM_PREFIX.length + 1)))
      if (req.method === 'GET') {
        const signed = await requireSession(req, res)
        if (signed === undefined) return
        try {
          html(res, 200, confirmPage(
            await ctx.deviceAuthorization.describe(id),
            field(url.searchParams, 'state'),
            csrfToken(signed.token),
          ))
        } catch (error) {
          const reason = refusalReason(error)
          if (reason === undefined) {
            html(res, 500, noticePage('Something went wrong', 'This site could not answer. Try again shortly.'))
            return
          }
          html(res, 400, noticePage('Cannot continue', pairingProblem(reason)))
        }
        return
      }
      const accepted = await acceptWrite(req, res)
      if (accepted === undefined) return
      try {
        const issued = await ctx.deviceAuthorization.confirm(id, {
          orgId: accepted.signed.session.orgId,
          userId: accepted.signed.session.userId,
          browserSessionId: hashToken(accepted.signed.token),
        })
        await record('device.bind', accepted.signed, 'allowed')
        // Back to the Runner that opened this, carrying the code and the state
        // it minted. The Runner refuses anything whose state it did not serve.
        const back = new URL(issued.callbackUri)
        back.searchParams.set('code', issued.code)
        back.searchParams.set('state', field(accepted.form, 'state'))
        redirect(res, back.href)
      } catch (error) {
        const reason = refusalReason(error)
        if (reason === undefined) {
          // Not a refusal: the record says so, and so does the answer.
          await record('device.bind', accepted.signed, 'error')
          html(res, 500, noticePage('Something went wrong', 'This site could not answer. Try again shortly.'))
          return
        }
        // The seam's own word, not a guess: a record that named the wrong
        // reason would be worse than one that named none.
        await record('device.bind', accepted.signed, 'denied', reason === 'expired' ? { reason } : {})
        html(res, 400, noticePage('Cannot continue', pairingProblem(reason)))
      }
    },
  }

  const admin: WebRoute = {
    kind: 'prefix',
    path: ADMIN_PREFIX,
    handler: async (req, res) => {
      /* v8 ignore next -- node:http always supplies url on server requests. */
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const page = url.pathname.slice(ADMIN_PREFIX.length)
      if (req.method === 'GET') {
        await adminPage(req, res, page)
        return
      }
      await adminAction(req, res, page)
    },
  }

  /** Serve one administrative page. */
  const adminPage = async (req: IncomingMessage, res: ServerResponse, page: string): Promise<void> => {
    const signed = await requireSession(req, res)
    if (signed === undefined) return
    const org = signed.session.orgId
    const csrf = csrfToken(signed.token)
    if (page === '/roles') {
      if (!await mayProceed(res, signed, 'member.role.bind', 'member', org)) return
      html(res, 200, rolesPage(await ctx.accessControl.listRoles(org), csrf))
      return
    }
    if (page === '/devices') {
      if (!await mayProceed(res, signed, 'device.inventory.read', 'device', org)) return
      html(res, 200, devicesPage(await ctx.deviceAuthorization.listDevices(org), csrf))
      return
    }
    if (page === '/members' || page === '' || page === '/') {
      if (!await mayProceed(res, signed, 'member.create', 'member', org)) return
      const [members, roles] = await Promise.all([
        ctx.accountStore.listUsers(org),
        ctx.accessControl.listRoles(org),
      ])
      html(res, 200, membersPage(members, roles, csrf))
      return
    }
    html(res, 404, noticePage('Not found', 'There is no such page.'))
  }

  /** Perform one administrative action. */
  const adminAction = async (req: IncomingMessage, res: ServerResponse, page: string): Promise<void> => {
    const accepted = await acceptWrite(req, res)
    if (accepted === undefined) return
    const { signed, form } = accepted
    const org = signed.session.orgId
    if (page === '/members/create') {
      if (!await mayProceed(res, signed, 'member.create', 'member', org)) return
      const supplied = requireFields(res, form, 'loginName', 'displayName')
      if (supplied === undefined) return
      await ctx.accountStore.createUser({
        orgId: org,
        loginName: supplied[0] as string,
        displayName: supplied[1] as string,
      })
      await record('member.create', signed, 'allowed')
      redirect(res, `${ADMIN_PREFIX}/members`)
      return
    }
    if (page === '/members/suspend') {
      if (!await mayProceed(res, signed, 'member.disable', 'member', org)) return
      const supplied = requireFields(res, form, 'userId')
      if (supplied === undefined) return
      const target = UserId(supplied[0] as string)
      // Suspending is the whole act: a session resolves through its account, so
      // the sessions this member holds stop working with the status change
      // rather than needing a second call someone has to remember.
      await ctx.accountStore.setUserStatus(target, 'suspended')
      await record('member.disable', signed, 'allowed', { resourceId: target })
      redirect(res, `${ADMIN_PREFIX}/members`)
      return
    }
    if (page === '/members/bind') {
      if (!await mayProceed(res, signed, 'member.role.bind', 'member', org)) return
      const supplied = requireFields(res, form, 'userId', 'roleId')
      if (supplied === undefined) return
      await ctx.accessControl.bindUserRole(UserId(supplied[0] as string), RoleId(supplied[1] as string))
      await record('binding.add', signed, 'allowed')
      redirect(res, `${ADMIN_PREFIX}/members`)
      return
    }
    if (page === '/roles/create') {
      if (!await mayProceed(res, signed, 'member.role.bind', 'member', org)) return
      const supplied = requireFields(res, form, 'name')
      if (supplied === undefined) return
      await ctx.accessControl.createRole({
        orgId: org,
        name: supplied[0] as string,
        description: field(form, 'description'),
      })
      await record('role.create', signed, 'allowed')
      redirect(res, `${ADMIN_PREFIX}/roles`)
      return
    }
    if (page === '/devices/revoke') {
      if (!await mayProceed(res, signed, 'device.revoke', 'device', org)) return
      const supplied = requireFields(res, form, 'deviceId')
      if (supplied === undefined) return
      const device = DeviceId(supplied[0] as string)
      await ctx.deviceAuthorization.revokeDevice(device)
      await record('device.revoke', signed, 'allowed', { resourceId: device })
      redirect(res, `${ADMIN_PREFIX}/devices`)
      return
    }
    html(res, 404, noticePage('Not found', 'There is no such action.'))
  }

  for (const route of [login, logout, confirm, admin]) {
    ctx.effect(() => ctx.webServer.register(route), `team-shell: ${route.path}`)
  }
}

/**
 * The seam's refusal word, when the failure was a refusal at all.
 *
 * A failure carrying no word is not this member's mistake — it is this
 * deployment's — and telling them their request was unrecognized would be
 * false as well as unhelpful.
 */
function refusalReason(error: unknown): string | undefined {
  return error instanceof Error && 'reason' in error ? String(error.reason) : undefined
}

/** What to tell a member whose confirmation was refused. */
function pairingProblem(reason: string): string {
  if (reason === 'expired') return 'That request took too long. Start again on the computer you are connecting.'
  if (reason === 'already-confirmed') return 'That computer was already confirmed.'
  return 'That connection request is not one this site knows about.'
}
