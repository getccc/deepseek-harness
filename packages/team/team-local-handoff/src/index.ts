/**
 * The Runner's local navigation endpoints: how a member gets from the company
 * site into the application running on their own computer.
 *
 * Three paths, all reached by navigating and nothing else. They carry no RPC,
 * read no request body, and reach no Host capability, so the browser-trust
 * fence that guards `/api` has nothing to guard here — what guards them is that
 * they do nothing an attacker would want done, plus a local `state` value that
 * ties a callback to the pairing page that started it.
 * @module @deepseek-ai/dsh-team-local-handoff
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-team-account-client'
import { TransactionId } from '@deepseek-ai/dsh-device-authorization'
import { pairingPage, problemPage } from './pages.ts'

export { CALLBACK_PATH, OPEN_PATH, START_PATH } from './paths.ts'

import { CALLBACK_PATH, OPEN_PATH, START_PATH } from './paths.ts'

/** Cordis plugin name. */
export const name = 'team-local-handoff'
/** Services required before the endpoints may register. */
export const inject = ['webServer', 'teamAccountClient', 'browserSession']

/** Plugin config: where a completed handoff lands. */
export interface Config {
  /** Same-origin path the browser is handed to once it holds a session. */
  applicationPath: string
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  applicationPath: z.string().default('/'),
})

/** Bytes behind the local state value. */
const STATE_BYTES = 32

/** Write one HTML page. */
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  res.end(body)
}

/** Whether this is a navigation a person made, rather than a page fetching. */
function isTopLevelNavigation(req: IncomingMessage): boolean {
  const mode = req.headers['sec-fetch-mode']
  const dest = req.headers['sec-fetch-dest']
  // A browser that sends neither header is old enough that the check would
  // reject every request from it; the endpoints are safe without it, and the
  // headers narrow what reaches them when the browser offers the facts.
  if (mode === undefined && dest === undefined) return req.method === 'GET'
  return req.method === 'GET' && mode === 'navigate' && dest === 'document'
}

/** Compare two state values without letting the comparison time say how far it matched. */
function stateMatches(expected: string | undefined, actual: string): boolean {
  if (expected === undefined) return false
  const left = Buffer.from(expected, 'utf8')
  const right = Buffer.from(actual, 'utf8')
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

/**
 * Register the local handoff endpoints.
 * @param ctx - Host plugin context carrying the web server, the account client, and the browser session.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  const destination = config.applicationPath
  // The state ties a callback to the pairing page this process served, which is
  // what stops a link someone else assembled from binding this computer to
  // their account. It is not what stops a replay — the Control Plane's one-time
  // authorization code is. Living only in this process is deliberate: a Runner
  // restarted mid-binding refuses the callback rather than accepting one it
  // cannot tie to a page it served.
  let pendingState: string | undefined
  let pendingTransaction: TransactionId | undefined

  const start: WebRoute = {
    kind: 'exact',
    path: START_PATH,
    handler: async (req, res) => {
      if (!isTopLevelNavigation(req)) {
        html(res, 405, problemPage('This address is opened by navigating to it.'))
        return
      }
      try {
        const handle = await ctx.teamAccountClient.begin()
        const state = randomBytes(STATE_BYTES).toString('base64url')
        pendingState = state
        pendingTransaction = handle.transactionId
        const confirm = new URL(handle.confirmUrl)
        confirm.searchParams.set('state', state)
        html(res, 200, pairingPage(handle.pairingCode, confirm.href, handle.expiresAt))
      } catch (error) {
        html(res, 502, problemPage(
          `The company Control Plane could not start the binding: ${describe(error)}`,
        ))
      }
    },
  }

  const open: WebRoute = {
    kind: 'exact',
    path: OPEN_PATH,
    handler: async (req, res) => {
      if (!isTopLevelNavigation(req)) {
        html(res, 405, problemPage('This address is opened by navigating to it.'))
        return
      }
      // Already unlocked in this browser: nothing to issue, and no reason to
      // touch the Control Plane. This is the path the daily entry takes.
      if (ctx.browserSession.isAuthenticated(req)) {
        res.writeHead(303, { 'cache-control': 'no-store', location: destination, 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      const state = await ctx.teamAccountClient.state()
      if (!state.bound) {
        res.writeHead(303, { 'cache-control': 'no-store', location: START_PATH, 'referrer-policy': 'no-referrer' })
        res.end()
        return
      }
      // Bound but locked: the computer is already this member's, so the session
      // is re-issued without another pairing code.
      ctx.browserSession.issueSession(req, res, destination)
    },
  }

  const callback: WebRoute = {
    kind: 'exact',
    path: CALLBACK_PATH,
    handler: async (req, res) => {
      if (!isTopLevelNavigation(req)) {
        html(res, 405, problemPage('This address is opened by navigating to it.'))
        return
      }
      /* v8 ignore next -- node:http always supplies url on server requests. */
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const state = url.searchParams.get('state') ?? ''
      const code = url.searchParams.get('code') ?? ''
      const expected = pendingState
      const transaction = pendingTransaction
      if (!stateMatches(expected, state) || transaction === undefined || code.length === 0) {
        html(res, 400, problemPage('This link did not come from the pairing page this computer served.'))
        return
      }
      try {
        await ctx.teamAccountClient.complete(transaction, code)
      } catch (error) {
        // The state survives a failure on purpose. The authorization code is
        // already one-time at the Control Plane, so nothing is gained by
        // spending the state here as well, and spending it would turn a moment
        // of Control Plane trouble into a full restart for the member.
        html(res, 400, problemPage(`The binding could not be completed: ${describe(error)}`))
        return
      }
      // Cleared because the binding is done, not to stop a replay: the
      // authorization code is one-time at the Control Plane, which is what
      // refuses a second callback carrying it.
      pendingState = undefined
      pendingTransaction = undefined
      // A redirect here would arrive without the cookie: the navigation that
      // reached this endpoint was started by the Control Plane, and a browser
      // withholds a SameSite=Strict cookie from every request in a cross-site
      // navigation chain. The session issuer answers 200 with a page that
      // navigates itself, which is same-site and therefore carries the cookie.
      ctx.browserSession.issueSession(req, res, destination)
    },
  }

  for (const route of [start, open, callback]) {
    ctx.effect(() => ctx.webServer.register(route), `team-local-handoff: ${route.path}`)
  }
}

/**
 * The part of a failure that is safe to show a member on a local page.
 *
 * A protocol refusal is spelled out rather than reduced to a word: it is the
 * one failure the member can act on themselves, and "update this application"
 * is only useful if the page says it.
 */
function describe(error: unknown): string {
  if (error instanceof Error && error.name === 'ProtocolUnsupportedError') {
    return 'this application is too old for the company server. Update DSH and try again.'
  }
  return error instanceof Error && 'reason' in error ? String(error.reason) : 'the request did not succeed'
}
