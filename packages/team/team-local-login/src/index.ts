/**
 * The Team Runner's local member sign-in and application-entry endpoints.
 *
 * A member types the organization account and password only into the loopback
 * Runner. The Runner authenticates against the Control Plane over its configured
 * origin, binds its device key, and unlocks this browser locally. No member
 * navigation to the administration origin is part of the flow.
 * @module @deepseek-ai/dsh-team-local-login
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-team-account-client'
import { LOGIN_LOCALES, loginPage, pageCopy, problemPage, type LoginLocale } from './pages.ts'
import { ACCOUNT_PATH, LOGIN_PATH, LOGOUT_PATH, OPEN_PATH } from './paths.ts'

export { ACCOUNT_PATH, LOGIN_PATH, LOGOUT_PATH, OPEN_PATH } from './paths.ts'

/** Stable Cordis plugin name. */
export const name = 'team-local-login'
/** Services required before the endpoints may register. */
export const inject = ['webServer', 'teamAccountClient', 'browserSession']

/** Plugin config: where a completed sign-in lands and how much form data is accepted. */
export interface Config {
  /** Same-origin application path opened after sign-in. */
  applicationPath: string
  /** Largest form body accepted, in bytes. */
  maxRequestBodyBytes: number
  /** Locale used before the client application loads. */
  locale?: LoginLocale
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  applicationPath: z.string().default('/'),
  maxRequestBodyBytes: z.natural().min(1).default(16 * 1024),
  locale: z.union(LOGIN_LOCALES).default('en-US'),
})

/** Write one response that must not be cached or leak a referring address. */
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/** Write a private same-origin JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

/** Whether this request is a top-level browser navigation. */
function isTopLevelNavigation(req: IncomingMessage): boolean {
  const mode = req.headers['sec-fetch-mode']
  const dest = req.headers['sec-fetch-dest']
  if (mode === undefined && dest === undefined) return req.method === 'GET'
  return req.method === 'GET' && mode === 'navigate' && dest === 'document'
}

/**
 * Whether a form submission came from the same local origin it targets.
 *
 * The login response's `Referrer-Policy: no-referrer` makes browsers serialize
 * the form's Origin as `null`. Fetch Metadata must independently classify that
 * opaque navigation as same-origin; a cross-site page cannot set that header.
 */
function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  if (host === undefined) return false
  if (origin === 'null') return req.headers['sec-fetch-site'] === 'same-origin'
  if (typeof origin !== 'string') return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

/** Read a bounded URL-encoded form. */
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
 * Register the Runner-local sign-in endpoints.
 * @param ctx - Host context carrying the web server, team account, and browser session.
 * @param config - resolved plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  const destination = config.applicationPath
  const copy = pageCopy(config.locale ?? 'en-US')

  const login: WebRoute = {
    kind: 'exact',
    path: LOGIN_PATH,
    handler: async (req, res) => {
      if (req.method === 'GET') {
        html(res, 200, loginPage(copy))
        return
      }
      if (req.method !== 'POST') {
        html(res, 405, problemPage(copy, copy.formOnly))
        return
      }
      if (!isSameOrigin(req)) {
        html(res, 403, problemPage(copy, copy.differentOrigin))
        return
      }
      const form = await readForm(req, config.maxRequestBodyBytes)
      const loginName = form?.get('loginName') ?? ''
      const secret = form?.get('secret') ?? ''
      if (form === undefined || loginName.length === 0 || secret.length === 0) {
        html(res, 400, loginPage(copy, copy.enterBoth))
        return
      }
      try {
        await ctx.teamAccountClient.signIn(loginName, secret)
      } catch (error) {
        if (error instanceof Error && error.name === 'ProtocolUnsupportedError') {
          html(res, 426, loginPage(copy, copy.updateRequired))
          return
        }
        html(res, 401, loginPage(copy, copy.credentialsRefused))
        return
      }
      if (!ctx.browserSession.issueSession(req, res, destination)) {
        html(res, 400, problemPage(copy, copy.sessionFailed))
      }
    },
  }

  const open: WebRoute = {
    kind: 'exact',
    path: OPEN_PATH,
    handler: (req, res) => {
      if (!isTopLevelNavigation(req)) {
        html(res, 405, problemPage(copy, copy.navigationOnly))
        return
      }
      if (ctx.browserSession.isAuthenticated(req)) {
        res.writeHead(303, { 'cache-control': 'no-store', location: destination, 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      res.writeHead(303, { 'cache-control': 'no-store', location: LOGIN_PATH, 'referrer-policy': 'no-referrer' })
      res.end()
    },
  }

  const logout: WebRoute = {
    kind: 'exact',
    path: LOGOUT_PATH,
    handler: async (req, res) => {
      if (!isTopLevelNavigation(req)) {
        html(res, 405, problemPage(copy, copy.navigationOnly))
        return
      }
      if (!ctx.browserSession.isAuthenticated(req)) {
        res.writeHead(303, { 'cache-control': 'no-store', location: LOGIN_PATH, 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      await ctx.teamAccountClient.signOut()
      ctx.browserSession.endSession(req, res, LOGIN_PATH)
    },
  }

  const account: WebRoute = {
    kind: 'exact',
    path: ACCOUNT_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      if (!ctx.browserSession.isAuthenticated(req)) {
        json(res, 401, { error: 'unauthorized' })
        return
      }
      const state = await ctx.teamAccountClient.state()
      if (!state.bound || state.member === undefined) {
        json(res, 404, { error: 'account unavailable' })
        return
      }
      json(res, 200, state.member)
    },
  }

  for (const route of [login, open, logout, account]) {
    ctx.effect(() => ctx.webServer.register(route), `team-local-login: ${route.path}`)
  }
}
