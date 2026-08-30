/**
 * The session module on its own: reading a cookie out of a header a browser
 * actually sends, deciding whether a write came from this site, and the two
 * cookie forms.
 */

import type { IncomingMessage } from 'node:http'
import { describe, expect, it } from 'vitest'
import {
  SESSION_COOKIE,
  csrfMatches,
  csrfToken,
  hashToken,
  newSessionToken,
  readCookie,
  sameOrigin,
  sessionCookie,
} from '../src/index.ts'

/** A request carrying exactly these headers. */
function request(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

describe('reading a cookie', () => {
  it('finds the named cookie among others, whatever the spacing', () => {
    const req = request({ cookie: `other=1; ${SESSION_COOKIE}=abc ;last=2` })
    expect(readCookie(req, SESSION_COOKIE)).toBe('abc')
  })

  it('answers nothing when the header is absent, or names something else', () => {
    expect(readCookie(request({}), SESSION_COOKIE)).toBeUndefined()
    expect(readCookie(request({ cookie: 'other=1' }), SESSION_COOKIE)).toBeUndefined()
  })

  it('skips a fragment that is not a name and a value', () => {
    expect(readCookie(request({ cookie: `broken; ${SESSION_COOKIE}=abc` }), SESSION_COOKIE)).toBe('abc')
  })
})

describe('the session token', () => {
  it('is 32 bytes of entropy, stored only as a digest', () => {
    const token = newSessionToken()
    expect(Buffer.from(token, 'base64url')).toHaveLength(32)
    expect(hashToken(token)).not.toContain(token)
    expect(new Set(Array.from({ length: 32 }, () => newSessionToken())).size).toBe(32)
  })

  it('derives a CSRF token that is not the session token', () => {
    const token = newSessionToken()
    expect(csrfToken(token)).not.toBe(token)
    expect(csrfMatches(token, csrfToken(token))).toBe(true)
    expect(csrfMatches(token, csrfToken(newSessionToken()))).toBe(false)
    expect(csrfMatches(token, '')).toBe(false)
  })
})

describe('the cookie attributes', () => {
  it('is Lax, so the confirmation link from a Runner still carries it', () => {
    // The member reaches the confirmation page from a page their own Runner
    // served, which is a cross-site top-level navigation. Strict would withhold
    // the session there and ask them to sign in again for no reason.
    expect(sessionCookie('t', 60, false)).toContain('SameSite=Lax')
    expect(sessionCookie('t', 60, false)).toContain('HttpOnly')
    expect(sessionCookie('t', 60, false)).not.toContain('Secure')
    expect(sessionCookie('t', 60, true)).toContain('Secure')
  })

  it('clears itself with a zero lifetime', () => {
    expect(sessionCookie('', 0, true)).toContain('Max-Age=0')
  })
})

describe('deciding a write came from this site', () => {
  it('accepts an Origin naming the same authority the request does', () => {
    expect(sameOrigin(request({ origin: 'https://dsh.company.com', host: 'dsh.company.com' }))).toBe(true)
    expect(sameOrigin(request({ origin: 'http://127.0.0.1:3095', host: '127.0.0.1:3095' }))).toBe(true)
  })

  it('accepts an opaque Origin only with same-origin Fetch Metadata', () => {
    expect(sameOrigin(request({ origin: 'null', host: '127.0.0.1:3095', 'sec-fetch-site': 'same-origin' })))
      .toBe(true)
    expect(sameOrigin(request({ origin: 'null', host: '127.0.0.1:3095', 'sec-fetch-site': 'cross-site' })))
      .toBe(false)
    expect(sameOrigin(request({ origin: 'null', host: '127.0.0.1:3095' }))).toBe(false)
  })

  it('refuses another site, a missing Origin, a missing Host, and one that is not a URL', () => {
    expect(sameOrigin(request({ origin: 'https://evil.example', host: 'dsh.company.com' }))).toBe(false)
    expect(sameOrigin(request({ host: 'dsh.company.com', 'sec-fetch-site': 'same-origin' }))).toBe(false)
    expect(sameOrigin(request({ host: 'dsh.company.com' }))).toBe(false)
    expect(sameOrigin(request({ origin: 'https://dsh.company.com' }))).toBe(false)
    expect(sameOrigin(request({ origin: 'null', 'sec-fetch-site': 'same-origin' }))).toBe(false)
    expect(sameOrigin(request({ origin: 'not a url', host: 'dsh.company.com' }))).toBe(false)
  })
})
