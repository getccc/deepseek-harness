/**
 * The one page the Control Plane still renders on the server: a member
 * confirming that the computer asking to connect is theirs.
 *
 * It stays a server-rendered page because of where a member arrives from. The
 * link comes from the pairing page their own Runner served, and what they do
 * on arrival is compare a code and press one button — a browser application
 * would have to load before it could show them the thing they came to check.
 * Administration is a browser application; this is not.
 * @module @deepseek-ai/dsh-team-shell
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TransactionId } from '@deepseek-ai/dsh-device-authorization'
import type { AuditOutcome, AuditReason } from '@deepseek-ai/dsh-audit'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  csrfMatches,
  csrfToken,
  currentSession,
  hashToken,
  sameOrigin,
  type Signed,
} from '@deepseek-ai/dsh-team-browser-session'
import { CONFIRM_PREFIX, CONSOLE_PATH } from './paths.ts'
import { confirmPage, noticePage } from './pages.ts'

export { CONFIRM_PREFIX, CONSOLE_PATH } from './paths.ts'
export { SESSION_COOKIE } from '@deepseek-ai/dsh-team-browser-session'

/** Cordis plugin name. */
export const name = 'team-shell'
/** Services required before the page may register. */
export const inject = ['webServer', 'accountStore', 'audit', 'deviceAuthorization']

/** Plugin config: how much of a form this page will read. */
export interface Config {
  /** Largest form body accepted, in bytes. */
  maxRequestBodyBytes: number
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  maxRequestBodyBytes: z.natural().min(1).default(16 * 1024),
})

/** Write one HTML page. */
function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'content-type': 'text/html; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/** Send the browser somewhere else. */
function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { location, 'cache-control': 'no-store' })
  res.end()
}

/**
 * Read a submitted form, refusing one larger than this page accepts.
 * @param req - the incoming request.
 * @param limit - the largest body in bytes.
 * @returns the fields, or undefined when the body was too large.
 */
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
 * caller below hands the value to something that already refuses an empty one.
 * @param form - the submitted form or query.
 * @param name - the field to read.
 * @returns the value, or the empty string.
 */
function field(form: URLSearchParams, name: string): string {
  return form.get(name) ?? ''
}

/**
 * Mount the confirmation page.
 * @param ctx - the Control Plane context.
 * @param config - how much of a form this page will read.
 */
export function apply(ctx: Context, config: Config): void {
  /** Record one act on this page, naming who performed it. */
  const record = (
    signed: Signed,
    outcome: AuditOutcome,
    extra: { reason?: AuditReason } = {},
  ): Promise<unknown> => ctx.audit.record({
    orgId: signed.session.orgId,
    principalId: signed.session.userId,
    action: 'device.bind',
    outcome,
    ...extra,
  })

  /**
   * Answer a request that must carry a session, or send it to sign in.
   *
   * The console is where signing in happens, and it comes back here: a member
   * following a pairing link should land on the page they were sent, not on
   * an administration view they did not ask for.
   * @returns the session, or undefined when the caller already answered.
   */
  const requireSession = async (req: IncomingMessage, res: ServerResponse): Promise<Signed | undefined> => {
    const signed = await currentSession(ctx.accountStore, req)
    if (signed !== undefined) return signed
    /* v8 ignore next -- node:http always supplies url on server requests. */
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    redirect(res, `${CONSOLE_PATH}?next=${encodeURIComponent(url.pathname + url.search)}`)
    return undefined
  }

  /**
   * Accept the confirmation: it must carry a session, come from this site, and
   * echo the session's own CSRF token. All three, because a cookie alone
   * travels with a request a member never made.
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
          authenticationId: `session:${hashToken(accepted.signed.token)}`,
        })
        await record(accepted.signed, 'allowed')
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
          await record(accepted.signed, 'error')
          html(res, 500, noticePage('Something went wrong', 'This site could not answer. Try again shortly.'))
          return
        }
        // The seam's own word, not a guess: a record that named the wrong
        // reason would be worse than one that named none.
        await record(accepted.signed, 'denied', reason === 'expired' ? { reason } : {})
        html(res, 400, noticePage('Cannot continue', pairingProblem(reason)))
      }
    },
  }

  ctx.effect(() => ctx.webServer.register(confirm), `team-shell: ${CONFIRM_PREFIX}`)
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
