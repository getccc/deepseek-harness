/**
 * The Control Plane browser session: a random opaque token in a cookie, and
 * the hash of it in the account store.
 *
 * Nothing about who the member is travels in the cookie, so a stolen cookie
 * cannot be read and a revoked session stops working at once rather than when
 * a signed value happens to lapse.
 * @module @deepseek-ai/dsh-team-shell/session
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AccountStore, BrowserSessionRecord } from '@deepseek-ai/dsh-account-store'

/** The cookie the Control Plane session travels in. */
export const SESSION_COOKIE = 'dsh_cp_session'

/** Bytes of entropy behind a session token. */
const TOKEN_BYTES = 32

/** Mint one session token. */
export function newSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/**
 * Hash a session token for storage.
 * @param token - the plaintext token a browser carries.
 * @returns the base64url SHA-256 digest the store is keyed by.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/**
 * Read one cookie out of a request.
 * @param req - the incoming request.
 * @param name - the cookie to read.
 * @returns the value, or undefined when the request carries no such cookie.
 */
export function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return undefined
}

/**
 * The Set-Cookie value for a session.
 *
 * `SameSite=Lax` rather than `Strict`: a member reaches the confirmation page
 * by following a link from the pairing page their own Runner served, which is
 * a cross-site top-level navigation. Strict would withhold the session there
 * and the page would ask them to sign in again for no reason.
 * @param token - the plaintext token, or the empty string to clear the cookie.
 * @param maxAgeSeconds - the cookie lifetime; zero clears it.
 * @param secure - whether to mark the cookie Secure, which a deployment over HTTPS does.
 * @returns the header value.
 */
export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${String(maxAgeSeconds)}`]
  if (secure) attributes.push('Secure')
  return `${SESSION_COOKIE}=${token}; ${attributes.join('; ')}`
}

/**
 * The CSRF token for one session.
 *
 * Derived from the session token rather than stored beside it, so there is no
 * second record to keep in step, and it is a different value from the cookie so
 * that carrying the cookie is not by itself enough to submit a form.
 * @param sessionToken - the plaintext session token.
 * @returns the value a form must echo.
 */
export function csrfToken(sessionToken: string): string {
  return createHash('sha256').update(`csrf:${sessionToken}`).digest('base64url')
}

/**
 * Whether a submitted CSRF token belongs to this session.
 * @param sessionToken - the plaintext session token from the cookie.
 * @param submitted - the value the form carried.
 * @returns true only for the token this session derives.
 */
export function csrfMatches(sessionToken: string, submitted: string): boolean {
  const expected = Buffer.from(csrfToken(sessionToken), 'utf8')
  const actual = Buffer.from(submitted, 'utf8')
  return expected.byteLength === actual.byteLength && timingSafeEqual(expected, actual)
}

/** Who is signed in, and the token that says so. */
export interface Signed {
  readonly token: string
  readonly session: BrowserSessionRecord
}

/**
 * Resolve the session a request carries.
 * @param store - the account store holding sessions.
 * @param req - the incoming request.
 * @returns the session and its token, or undefined when the request carries none the store honours.
 */
export async function currentSession(store: AccountStore, req: IncomingMessage): Promise<Signed | undefined> {
  const token = readCookie(req, SESSION_COOKIE)
  if (token === undefined) return undefined
  const session = await store.resolveBrowserSession(hashToken(token))
  return session === undefined ? undefined : { token, session }
}

/**
 * Whether a write request came from this Control Plane's own pages.
 *
 * A normal Origin header is checked against the authority the request itself
 * names, so a deployment does not have to configure its own address twice.
 * An opaque browser context may send `Origin: null`; it is accepted only when
 * Fetch Metadata independently classifies the navigation as same-origin.
 * @param req - the incoming request.
 * @returns true only for a matching Origin or an opaque same-origin navigation.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  const host = req.headers.host
  if (host === undefined) return false
  if (origin === 'null') return req.headers['sec-fetch-site'] === 'same-origin'
  if (typeof origin !== 'string') return false
  try {
    return new URL(origin).host === host
  } catch {
    // An Origin that is not a URL is not this site's.
    return false
  }
}

/** Set or clear the session cookie on a response. */
export function writeSessionCookie(
  res: ServerResponse,
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): void {
  res.setHeader('set-cookie', sessionCookie(token, maxAgeSeconds, secure))
}
