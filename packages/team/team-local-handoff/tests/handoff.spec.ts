/**
 * REAL-composition coverage for the whole handoff: two cordis.yml trees booted
 * through the vendored Loader — a Control Plane and a Runner — connected only
 * by HTTP, driven the way a member's browser drives them.
 *
 * The point of composing both sides is the part no unit test can reach: the
 * Runner proving possession of a key the Control Plane only ever saw as a
 * digest, and the browser session surviving a cross-site arrival.
 */

import { connect } from 'node:net'
import { once } from 'node:events'
import { createServer, request as httpRequest, type Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import SqliteAccountStore from '@deepseek-ai/dsh-account-store-sqlite'
import SqliteDeviceAuthorization from '@deepseek-ai/dsh-device-authorization-sqlite'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import type { AccountStore } from '@deepseek-ai/dsh-account-store'
import type { DeviceAuthorization, TransactionId } from '@deepseek-ai/dsh-device-authorization'
import * as controlPlaneHttp from '@deepseek-ai/dsh-team-control-plane-http'
import TeamAccountClient from '@deepseek-ai/dsh-team-account-client'
import * as clientConnection from '@deepseek-ai/dsh-client-connection'
import * as handoff from '../src/index.ts'

/** One response, read the way a browser would see it. */
interface Landing {
  readonly status: number
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

/**
 * Make one request with headers exactly as given.
 *
 * `fetch` cannot serve here: it overrides `Sec-Fetch-Mode` with its own value,
 * so a test using it could never present what a real navigation presents — and
 * the handoff endpoints answer on exactly that header.
 */
function send(url: string | URL, headers: Record<string, string> = {}): Promise<Landing> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
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
    req.end()
  })
}

/**
 * Write one request line by line and read what comes back.
 *
 * `node:http` supplies a Host header of its own, so a request that names no
 * authority can only be made by writing the bytes.
 */
async function rawRequest(port: number, lines: string[]): Promise<string> {
  const socket = connect(port, '127.0.0.1')
  await once(socket, 'connect')
  const answered = once(socket, 'data')
  socket.write(`${lines.join('\r\n')}\r\n\r\n`)
  const [data] = await answered as [Buffer]
  socket.destroy()
  return data.toString('utf8')
}

/** What a browser sends when a person navigates to an address. */
const NAVIGATE = {
  'sec-fetch-mode': 'navigate',
  'sec-fetch-dest': 'document',
  'sec-fetch-site': 'cross-site',
}

/** Read one response header as a single value. */
function head(landing: Landing, name: string): string | undefined {
  const value = landing.headers[name]
  return Array.isArray(value) ? value[0] : value
}

let roots: string[] = []
let servers: Server[] = []
let contexts: Context[] = []

afterEach(async () => {
  for (const context of contexts.reverse()) await context.fiber.dispose()
  contexts = []
  for (const server of servers) server.close()
  servers = []
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots = []
})

/** Boot one cordis.yml through the real Loader with the given module table. */
async function boot(lines: string[], modules: Map<string, unknown>): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-handoff-'))
  roots.push(root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, `${lines.join('\n')}\n`)
  const context = new Context()
  contexts.push(context)
  context.baseUrl = `${pathToFileURL(root).href}/`
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  context.loader.internal = {
    version: 'v2',
    import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return Promise.resolve(modules.get(specifier))
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

/** The Control Plane: an account store, the binding seam, and the Runner-facing endpoints. */
async function bootControlPlane(): Promise<Context> {
  return boot([
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-account-store-sqlite'",
    '  config:',
    "    path: ':memory:'",
    "- name: '@deepseek-ai/dsh-device-authorization-sqlite'",
    '  config:',
    "    path: ':memory:'",
    '    transactionTtlMs: 300000',
    '    codeTtlMs: 60000',
    '    accessTokenTtlMs: 900000',
    '    refreshTokenTtlMs: 2592000000',
    "- name: '@deepseek-ai/dsh-team-control-plane-http'",
  ], new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-account-store-sqlite', SqliteAccountStore],
    ['@deepseek-ai/dsh-device-authorization-sqlite', SqliteDeviceAuthorization],
    ['@deepseek-ai/dsh-team-control-plane-http', controlPlaneHttp],
  ]))
}

/** The Runner: local credentials, the browser session, the account client, and the handoff. */
async function bootRunner(controlPlaneUrl: string): Promise<Context> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-runner-home-'))
  roots.push(home)
  return boot([
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: '${join(home, 'credentials.json')}'`,
    `    dshHome: '${home}'`,
    '    watch: false',
    "- name: '@deepseek-ai/dsh-client-connection'",
    "- name: '@deepseek-ai/dsh-team-account-client'",
    '  config:',
    `    controlPlaneUrl: '${controlPlaneUrl}'`,
    "    callbackUri: 'http://127.0.0.1:0/team/callback'",
    "    runnerVersion: '2.4.1'",
    "- name: '@deepseek-ai/dsh-team-local-handoff'",
  ], new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-client-connection', clientConnection],
    ['@deepseek-ai/dsh-team-account-client', TeamAccountClient],
    ['@deepseek-ai/dsh-team-local-handoff', handoff],
  ]))
}

/** Pull the pairing code and the confirmation link out of the local pairing page. */
function readPairingPage(body: string): { pairingCode: string; confirmUrl: string } {
  const code = /letter-spacing: 0\.1em">([A-Z0-9-]+)</u.exec(body)
  const link = /<a href="([^"]*\/team\/confirm\/[^"]*)"/u.exec(body)
  expect(code?.[1], 'pairing code on the page').toBeDefined()
  expect(link?.[1], 'confirmation link on the page').toBeDefined()
  return {
    pairingCode: code?.[1] as string,
    confirmUrl: (link?.[1] as string).replace(/&amp;/gu, '&').replace(/&#39;/gu, "'"),
  }
}

describe('a member connects this computer', () => {
  it('carries the browser from the company site into the local application', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const cpUrl = `http://127.0.0.1:${String(cp.webServer.port)}`
    const runner = await bootRunner(cpUrl)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`

    const store = cp.get('accountStore') as AccountStore
    const auth = cp.get('deviceAuthorization') as DeviceAuthorization
    const org = await store.createOrganization('Acme')
    const alice = await store.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })

    // The member opens the local pairing page. Nothing is bound yet.
    const startResponse = await send(`${runnerUrl}/team/start`, NAVIGATE)
    expect(startResponse.status).toBe(200)
    const { pairingCode, confirmUrl } = readPairingPage(startResponse.body)
    expect(pairingCode).toMatch(/^[BCDFGHJKMNPQRSTVWXZ23456789]{4}-[BCDFGHJKMNPQRSTVWXZ23456789]{4}$/u)

    // The Control Plane shows the same code, which is what the member compares.
    const confirm = new URL(confirmUrl)
    const transactionId = (confirm.pathname.split('/').pop() as string) as TransactionId
    expect((await auth.describe(transactionId)).pairingCode).toBe(pairingCode)

    // The member confirms. The Team Shell serves this page; here the seam call
    // that the page makes stands in for the click.
    const issued = await auth.confirm(transactionId, {
      orgId: org.id, userId: alice.id, browserSessionId: 'browser-session',
    })

    // The Control Plane sends the browser back. This arrival is cross-site.
    const callback = new URL(`${runnerUrl}/team/callback`)
    callback.searchParams.set('state', confirm.searchParams.get('state') as string)
    callback.searchParams.set('code', issued.code)
    const landed = await send(callback, NAVIGATE)

    // 200 and a page that navigates itself, not a redirect: a SameSite=Strict
    // cookie would not survive a redirect inside a cross-site navigation chain.
    expect(landed.status).toBe(200)
    expect(head(landed, 'content-type')).toContain('text/html')
    const cookie = head(landed, 'set-cookie')
    expect(cookie).toContain('SameSite=Strict')
    expect(landed.body).toContain('location.replace("/")')

    // The device is bound, to this member, on this platform.
    const [device] = await auth.listDevices(org.id)
    expect(device).toMatchObject({ ownerId: alice.id, status: 'active' })

    // With the session, the daily entry redirects straight into the application.
    const jar = (cookie as string).split(';')[0] as string
    const opened = await send(`${runnerUrl}/team/open`, { ...NAVIGATE, cookie: jar })
    expect(opened.status).toBe(303)
    expect(head(opened, 'location')).toBe('/')
  })

  it('re-issues the session for a bound computer without another pairing code', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    const store = cp.get('accountStore') as AccountStore
    const auth = cp.get('deviceAuthorization') as DeviceAuthorization
    const org = await store.createOrganization('Acme')
    const alice = await store.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })

    const started = await send(`${runnerUrl}/team/start`, NAVIGATE)
    const { confirmUrl } = readPairingPage(started.body)
    const confirm = new URL(confirmUrl)
    const transactionId = (confirm.pathname.split('/').pop() as string) as TransactionId
    const issued = await auth.confirm(transactionId, {
      orgId: org.id, userId: alice.id, browserSessionId: 'browser-session',
    })
    const callback = new URL(`${runnerUrl}/team/callback`)
    callback.searchParams.set('state', confirm.searchParams.get('state') as string)
    callback.searchParams.set('code', issued.code)
    await send(callback, NAVIGATE)

    // A locked browser on a bound computer: the session comes back with no
    // Control Plane round trip and no code for anyone to compare.
    const reopened = await send(`${runnerUrl}/team/open`, NAVIGATE)
    expect(reopened.status).toBe(200)
    expect(head(reopened, 'set-cookie')).toContain('SameSite=Strict')
  })

  it('sends an unbound computer to the pairing page', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const opened = await send(`http://127.0.0.1:${String(runner.webServer.port)}/team/open`, NAVIGATE)
    expect(opened.status).toBe(303)
    expect(head(opened, 'location')).toBe('/team/start')
  })

  it('refuses a callback that does not carry the state this computer minted', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    const store = cp.get('accountStore') as AccountStore
    const auth = cp.get('deviceAuthorization') as DeviceAuthorization
    const org = await store.createOrganization('Acme')
    const alice = await store.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })

    const started = await send(`${runnerUrl}/team/start`, NAVIGATE)
    const { confirmUrl } = readPairingPage(started.body)
    const confirm = new URL(confirmUrl)
    const issued = await auth.confirm(
      (confirm.pathname.split('/').pop() as string) as TransactionId,
      { orgId: org.id, userId: alice.id, browserSessionId: 'browser-session' },
    )

    const forged = new URL(`${runnerUrl}/team/callback`)
    forged.searchParams.set('state', 'not-the-state-this-computer-minted')
    forged.searchParams.set('code', issued.code)
    const refused = await send(forged, NAVIGATE)
    expect(refused.status).toBe(400)
    expect(head(refused, 'set-cookie')).toBeUndefined()
    expect(await auth.listDevices(org.id)).toEqual([])
  })

  it('keeps the pairing page usable when a callback fails, and refuses a completed one twice', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    const store = cp.get('accountStore') as AccountStore
    const auth = cp.get('deviceAuthorization') as DeviceAuthorization
    const org = await store.createOrganization('Acme')
    const alice = await store.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })

    const started = await send(`${runnerUrl}/team/start`, NAVIGATE)
    const { confirmUrl } = readPairingPage(started.body)
    const confirm = new URL(confirmUrl)
    const state = confirm.searchParams.get('state') as string

    // A callback carrying the right state and a code the Control Plane never
    // issued: refused, and the pairing page still works afterwards.
    const wrong = new URL(`${runnerUrl}/team/callback`)
    wrong.searchParams.set('state', state)
    wrong.searchParams.set('code', 'a-code-nobody-issued')
    expect((await send(wrong, NAVIGATE)).status).toBe(400)

    const issued = await auth.confirm(
      (confirm.pathname.split('/').pop() as string) as TransactionId,
      { orgId: org.id, userId: alice.id, browserSessionId: 'browser-session' },
    )
    const good = new URL(`${runnerUrl}/team/callback`)
    good.searchParams.set('state', state)
    good.searchParams.set('code', issued.code)
    expect((await send(good, NAVIGATE)).status).toBe(200)

    // The same link a second time is refused. What refuses it is the Control
    // Plane's one-time code, which is why this holds even for a Runner that
    // never saw the first callback.
    const replayed = await send(good, NAVIGATE)
    expect(replayed.status).toBe(400)
    expect(head(replayed, 'set-cookie')).toBeUndefined()
  })

  it('refuses a callback replayed after the binding completed', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    const store = cp.get('accountStore') as AccountStore
    const auth = cp.get('deviceAuthorization') as DeviceAuthorization
    const org = await store.createOrganization('Acme')
    const alice = await store.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })

    const started = await send(`${runnerUrl}/team/start`, NAVIGATE)
    const { confirmUrl } = readPairingPage(started.body)
    const confirm = new URL(confirmUrl)
    const issued = await auth.confirm(
      (confirm.pathname.split('/').pop() as string) as TransactionId,
      { orgId: org.id, userId: alice.id, browserSessionId: 'browser-session' },
    )
    const callback = new URL(`${runnerUrl}/team/callback`)
    callback.searchParams.set('state', confirm.searchParams.get('state') as string)
    callback.searchParams.set('code', issued.code)
    expect((await send(callback, NAVIGATE)).status).toBe(200)

    const replayed = await send(callback, NAVIGATE)
    expect(replayed.status).toBe(400)
    expect(head(replayed, 'set-cookie')).toBeUndefined()
  })

  it('refuses a request that is not a top-level navigation', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    for (const path of ['/team/start', '/team/open', '/team/callback']) {
      const fetched = await send(`${runnerUrl}${path}`, {
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
      })
      expect(fetched.status, path).toBe(405)
    }
  })
})

describe('when things do not work', () => {
  it('shows a member what happened when the Control Plane cannot be reached', { timeout: 60_000 }, async () => {
    // A Control Plane that answers nothing useful: the pairing page cannot be
    // built, and the member is told that rather than shown an empty page.
    const runner = await bootRunner('http://127.0.0.1:1')
    const shown = await send(`http://127.0.0.1:${String(runner.webServer.port)}/team/start`, NAVIGATE)
    expect(shown.status).toBe(502)
    expect(shown.body).toContain('Cannot continue')
  })

  it('tells a member their own application is what is too old', { timeout: 60_000 }, async () => {
    // A Control Plane that has stopped answering this Runner's protocol
    // version. The refusal is the one a member can act on themselves, so the
    // page has to say so instead of reducing it to a reason word.
    const refusing = createServer((_req, res) => {
      res.writeHead(426, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        error: 'refused', reason: 'protocol-unsupported', minimum: 2, current: 2,
      }))
    })
    refusing.listen(0, '127.0.0.1')
    await once(refusing, 'listening')
    servers.push(refusing)

    const runner = await bootRunner(`http://127.0.0.1:${String((refusing.address() as { port: number }).port)}`)
    const shown = await send(`http://127.0.0.1:${String(runner.webServer.port)}/team/start`, NAVIGATE)
    expect(shown.status).toBe(502)
    expect(shown.body).toContain('too old for the company server')
  })

  it('treats a request from a browser that reports nothing as a navigation', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    // An older browser sends no Sec-Fetch headers at all. Rejecting those would
    // lock those members out of an endpoint that is safe without the hint.
    const opened = await send(`http://127.0.0.1:${String(runner.webServer.port)}/team/open`)
    expect(opened.status).toBe(303)
    expect(head(opened, 'location')).toBe('/team/start')
  })

  it('refuses a callback carrying no code at all', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    const started = await send(`${runnerUrl}/team/start`, NAVIGATE)
    const { confirmUrl } = readPairingPage(started.body)
    const bare = new URL(`${runnerUrl}/team/callback`)
    bare.searchParams.set('state', new URL(confirmUrl).searchParams.get('state') as string)
    expect((await send(bare, NAVIGATE)).status).toBe(400)
  })

  it('refuses a state of the right length but the wrong value', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    const started = await send(`${runnerUrl}/team/start`, NAVIGATE)
    const { confirmUrl } = readPairingPage(started.body)
    const real = new URL(confirmUrl).searchParams.get('state') as string
    // Same length, one character different: the comparison must not stop at the
    // length, and must not leak where it stopped either.
    const nearMiss = `${real.slice(0, -1)}${real.endsWith('A') ? 'B' : 'A'}`
    expect(nearMiss).toHaveLength(real.length)
    const forged = new URL(`${runnerUrl}/team/callback`)
    forged.searchParams.set('state', nearMiss)
    forged.searchParams.set('code', 'anything')
    expect((await send(forged, NAVIGATE)).status).toBe(400)
  })

  it('refuses a request that reports one Sec-Fetch fact but not the other', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const half = await send(
      `http://127.0.0.1:${String(runner.webServer.port)}/team/open`,
      { 'sec-fetch-dest': 'document' },
    )
    expect(half.status).toBe(405)
  })

  it('refuses a callback carrying neither state nor code', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const bare = await send(`http://127.0.0.1:${String(runner.webServer.port)}/team/callback`, NAVIGATE)
    expect(bare.status).toBe(400)
  })

  it('refuses to issue a session to a request that names no host', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const runnerUrl = `http://127.0.0.1:${String(runner.webServer.port)}`
    const store = cp.get('accountStore') as AccountStore
    const auth = cp.get('deviceAuthorization') as DeviceAuthorization
    const org = await store.createOrganization('Acme')
    const alice = await store.createUser({ orgId: org.id, loginName: 'alice', displayName: 'Alice' })
    const started = await send(`${runnerUrl}/team/start`, NAVIGATE)
    const { confirmUrl } = readPairingPage(started.body)
    const confirm = new URL(confirmUrl)
    const issued = await auth.confirm(
      (confirm.pathname.split('/').pop() as string) as TransactionId,
      { orgId: org.id, userId: alice.id, browserSessionId: 'browser-session' },
    )
    const callback = new URL(`${runnerUrl}/team/callback`)
    callback.searchParams.set('state', confirm.searchParams.get('state') as string)
    callback.searchParams.set('code', issued.code)
    await send(callback, NAVIGATE)

    // The cookie is bound to the authority it was issued for, so a request that
    // names none cannot be given one.
    const raw = await rawRequest(runner.webServer.port, [
      'GET /team/open HTTP/1.0',
      'Sec-Fetch-Mode: navigate',
      'Sec-Fetch-Dest: document',
    ])
    expect(raw).toContain('401')
    expect(raw).not.toContain('Set-Cookie')
  })

  it('refuses a callback before any pairing page was served', { timeout: 60_000 }, async () => {
    const cp = await bootControlPlane()
    const runner = await bootRunner(`http://127.0.0.1:${String(cp.webServer.port)}`)
    const cold = new URL(`http://127.0.0.1:${String(runner.webServer.port)}/team/callback`)
    cold.searchParams.set('state', 'anything')
    cold.searchParams.set('code', 'anything')
    expect((await send(cold, NAVIGATE)).status).toBe(400)
  })
})
