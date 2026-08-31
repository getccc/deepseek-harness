/** The Runner-local account form and its navigation-only entry paths. */

import { request as httpRequest, type ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as login from '../src/index.ts'

interface Answer {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

let ctx: Context
let origin: string
let authenticated: boolean
let signIn: ReturnType<typeof vi.fn>
let signOut: ReturnType<typeof vi.fn>

/** Send one request with exactly the browser facts under test. */
function send(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${origin}${path}`, {
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => { chunks.push(chunk as Buffer) })
      res.on('end', () => {
        resolve({
          status: res.statusCode as number,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(HttpServer, { host: '127.0.0.1', port: 0 }).await()
  authenticated = false
  signIn = vi.fn(() => Promise.resolve({ bound: true }))
  signOut = vi.fn(() => Promise.resolve())
  ctx.provide('teamAccountClient', {
    signIn,
    signOut,
    state: () => Promise.resolve({
      bound: true,
      member: { loginName: 'alice', displayName: 'Alice' },
    }),
  })
  ctx.provide('browserSession', {
    isAuthenticated: () => authenticated,
    issueSession: (_req: unknown, res: ServerResponse, destination: string) => {
      res.writeHead(200, { 'set-cookie': 'runner=session', 'content-type': 'text/html' })
      res.end(`<a href="${destination}">Continue</a>`)
      return true
    },
    endSession: (_req: unknown, res: ServerResponse, destination: string) => {
      authenticated = false
      res.writeHead(303, { location: destination, 'set-cookie': 'runner=; Max-Age=0; Path=/' })
      res.end()
      return true
    },
  })
  await ctx.plugin(login, login.Config({ applicationPath: '/app' } as never)).await()
  origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
})

afterEach(async () => {
  await ctx.fiber.dispose()
})

describe('the local entry', () => {
  it('sends a locked browser to the local login page, never to the Control Plane', async () => {
    const opened = await send(login.OPEN_PATH)
    expect(opened.status).toBe(303)
    expect(opened.headers.location).toBe(login.LOGIN_PATH)

    const page = await send(login.LOGIN_PATH)
    expect(page.status).toBe(200)
    expect(page.body).toContain('action="/team/login"')
    expect(page.body).toContain('class="login-card"')
    expect(page.body).toContain('autocomplete="username"')
    expect(page.body).not.toContain('3095')
  })

  it('opens the application directly only for an authenticated local browser', async () => {
    authenticated = true
    const opened = await send(login.OPEN_PATH)
    expect(opened.status).toBe(303)
    expect(opened.headers.location).toBe('/app')
  })
})

describe('the local account identity', () => {
  it('serves the bound member only to an authenticated local browser', async () => {
    const locked = await send(login.ACCOUNT_PATH)
    expect(locked.status).toBe(401)

    authenticated = true
    const account = await send(login.ACCOUNT_PATH)
    expect(account.status).toBe(200)
    expect(JSON.parse(account.body)).toEqual({ loginName: 'alice', displayName: 'Alice' })
  })
})

describe('submitting the account form', () => {
  it('binds the Runner and issues the local browser session', async () => {
    const body = new URLSearchParams({ loginName: 'alice', secret: 'correct horse' }).toString()
    const landed = await send(login.LOGIN_PATH, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })

    expect(signIn).toHaveBeenCalledWith('alice', 'correct horse')
    expect(landed.status).toBe(200)
    expect(landed.headers['set-cookie']).toEqual(['runner=session'])
    expect(landed.body).toContain('href="/app"')
  })

  it('uses one message for every account refusal', async () => {
    signIn.mockRejectedValue(new Error('unknown member'))
    const landed = await send(login.LOGIN_PATH, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ loginName: 'nobody', secret: 'wrong' }).toString(),
    })
    expect(landed.status).toBe(401)
    expect(landed.body).toContain('The account or password was not accepted.')
    expect(landed.body).not.toContain('unknown member')
  })

  it('refuses a form submitted by another origin', async () => {
    const landed = await send(login.LOGIN_PATH, {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ loginName: 'alice', secret: 'password' }).toString(),
    })
    expect(landed.status).toBe(403)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('accepts an opaque Origin only with same-origin Fetch Metadata', async () => {
    const body = new URLSearchParams({ loginName: 'alice', secret: 'correct horse' }).toString()
    const accepted = await send(login.LOGIN_PATH, {
      method: 'POST',
      headers: {
        origin: 'null',
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    })
    expect(accepted.status).toBe(200)

    for (const headers of [
      { origin: 'null', 'sec-fetch-site': 'cross-site' },
      { origin: 'null' },
    ]) {
      signIn.mockClear()
      const refused = await send(login.LOGIN_PATH, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })
      expect(refused.status).toBe(403)
      expect(signIn).not.toHaveBeenCalled()
    }
  })
})

describe('signing out', () => {
  it('forgets the team credential, clears the local session, and returns to sign-in', async () => {
    authenticated = true
    const landed = await send(login.LOGOUT_PATH)
    expect(signOut).toHaveBeenCalledOnce()
    expect(landed.status).toBe(303)
    expect(landed.headers.location).toBe(login.LOGIN_PATH)
    expect(landed.headers['set-cookie']).toEqual(['runner=; Max-Age=0; Path=/'])
  })

  it('does not clear the process credential for an unauthenticated navigation', async () => {
    const landed = await send(login.LOGOUT_PATH)
    expect(signOut).not.toHaveBeenCalled()
    expect(landed.status).toBe(303)
    expect(landed.headers.location).toBe(login.LOGIN_PATH)
  })
})
