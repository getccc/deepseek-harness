/**
 * Both ends of the governed wire against a stand-in capability, over real HTTP.
 *
 * The Control Plane end serves a handler from a local server and is called
 * with `fetch`; the Runner end calls a local server that replies as the test
 * scripts. Each refusal is observed as the status and body a peer reads. The
 * consumers' own suites exercise the same code through real gateways.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fetch as undiciFetch } from 'undici'
import type { OrgId, UserId } from '@deepseek-ai/dsh-account-store'
import {
  ACCESS_TOKEN_HEADER,
  COMMON_REFUSAL_REASONS,
  COMMON_REFUSAL_STATUS,
  governedClient,
  governedHandler,
  readCount,
  type GovernedProtocol,
  type OpenedRequest,
  type ParseRoute,
  type VerifiedClaims,
} from '@deepseek-ai/dsh-team-governed-wire'

type StandInReason = keyof typeof COMMON_REFUSAL_STATUS | 'thing-unavailable'

const PROTOCOL: GovernedProtocol<StandInReason> = {
  scope: 'thing',
  minimum: 2,
  current: 3,
  statusByReason: { ...COMMON_REFUSAL_STATUS, 'thing-unavailable': 409 },
}

const CLAIMS: VerifiedClaims = { orgId: 'org-1' as OrgId, principalId: 'user-1' as UserId, deviceId: 'device-1' }

/** The stand-in capability's own failure. */
class ThingError extends Error {
  constructor(readonly reason: StandInReason, message: string) {
    super(message)
  }
}

let server: Server
let origin: string

/** Listen on an ephemeral port with `listener`, and remember where. */
async function listen(listener: (req: IncomingMessage, res: ServerResponse) => void): Promise<void> {
  server = createServer(listener)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

/** Stop the local server, dropping connections a test left open. */
async function closeServer(): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
}

interface Answer {
  status: number
  headers: { get(name: string): string | null }
  body: unknown
}

/** What a request to the Control Plane end answered. */
async function post(body: string, headers: Record<string, string> = {}, method = 'POST'): Promise<Answer> {
  const response = await undiciFetch(origin, { method, headers, ...(method === 'POST' ? { body } : {}) })
  return { status: response.status, headers: response.headers, body: await response.json() }
}

const good = { [ACCESS_TOKEN_HEADER]: 'Bearer good' }
const withVersion = (extra: Record<string, unknown> = {}): string => JSON.stringify({ protocolVersion: 3, ...extra })

/** Serve `parse` under the stand-in protocol, verifying the token `good` and bounding bodies at `limit`. */
async function serve(parse: ParseRoute, limit = 1024): Promise<void> {
  const handler = governedHandler({
    reasonOf: error => error instanceof ThingError ? error.reason : undefined,
    protocol: PROTOCOL,
    limit,
    verify: token => Promise.resolve(token === 'good' ? CLAIMS : undefined),
  }, parse)
  await listen((req, res) => { void handler(req, res) })
}

describe('governedHandler', () => {
  afterEach(closeServer)

  it('answers a POST with a verified token under the version range, never cacheably', async () => {
    const seen: OpenedRequest[] = []
    await serve((opened) => {
      seen.push(opened)
      return () => Promise.resolve({ ok: true })
    })
    const answer = await post(withVersion({ name: 'x' }), good)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ ok: true })
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(answer.headers.get('content-type')).toBe('application/json; charset=utf-8')
    expect(seen).toEqual([{
      body: { protocolVersion: 3, name: 'x' },
      principal: { orgId: 'org-1', principalId: 'user-1', deviceId: 'device-1' },
    }])
  })

  it('refuses a method other than POST before reading the body', async () => {
    await serve(() => undefined)
    expect(await post('', good, 'GET')).toMatchObject({ status: 405, body: { error: 'method not allowed' } })
  })

  it.each([
    ['an oversized body', `{"protocolVersion":3,"pad":"${'x'.repeat(64)}"}`, 32],
    ['a body that is not JSON', '<html>bad gateway</html>', 1024],
    ['a JSON array', '[1]', 1024],
    ['a JSON scalar', '7', 1024],
    ['JSON null', 'null', 1024],
  ])('refuses %s as malformed', async (_label, text, limit) => {
    await serve(() => undefined, limit)
    expect(await post(text, good)).toMatchObject({ status: 400, body: { error: 'malformed' } })
  })

  it.each([
    ['absent', '{}'],
    ['not a number', '{"protocolVersion":"3"}'],
    ['older than the minimum', '{"protocolVersion":1}'],
    ['newer than the current', '{"protocolVersion":4}'],
  ])('tells a Runner whose version is %s to update, before it looks at the token', async (_label, text) => {
    await serve(() => undefined)
    expect(await post(text)).toMatchObject({
      status: 426,
      body: { error: 'thing', reason: 'update-required', minimum: 2, current: 3 },
    })
  })

  it.each([
    ['no authorization header', {}],
    ['another scheme', { [ACCESS_TOKEN_HEADER]: 'Basic good' }],
    ['two joined headers', { [ACCESS_TOKEN_HEADER]: 'Basic x, Bearer good' }],
    ['a token the verifier does not know', { [ACCESS_TOKEN_HEADER]: 'Bearer stale' }],
  ])('answers %s as unauthenticated', async (_label, headers) => {
    await serve(() => () => Promise.resolve({}))
    expect(await post(withVersion(), headers)).toMatchObject({
      status: 401,
      body: { error: 'thing', reason: 'unauthenticated' },
    })
  })

  it('answers a body the route cannot decode as malformed without running anything', async () => {
    await serve(() => undefined)
    expect(await post(withVersion(), good)).toMatchObject({ status: 400, body: { error: 'malformed' } })
  })

  it('answers a failure the capability owns with its reason and mapped status', async () => {
    await serve(() => () => Promise.reject(new ThingError('thing-unavailable', 'gone')))
    expect(await post(withVersion(), good)).toMatchObject({
      status: 409,
      body: { error: 'thing', reason: 'thing-unavailable' },
    })
  })

  it('answers any other failure as an internal error with no reason word', async () => {
    await serve(() => () => Promise.reject(new Error('disk full')))
    const answer = await post(withVersion(), good)
    expect(answer).toMatchObject({ status: 500, body: { error: 'internal' } })
    expect(answer.body).not.toHaveProperty('reason')
  })
})

describe('refusal table', () => {
  it('lists exactly the words it maps', () => {
    expect(COMMON_REFUSAL_REASONS).toEqual(Object.keys(COMMON_REFUSAL_STATUS))
  })
})

describe('readCount', () => {
  it.each([
    [undefined, undefined],
    [1, 1],
    [20, 20],
    [0, 'invalid'],
    [-3, 'invalid'],
    [1.5, 'invalid'],
    ['2', 'invalid'],
    [Number.MAX_SAFE_INTEGER + 1, 'invalid'],
  ])('reads %j as %j', (value, expected) => {
    expect(readCount(value)).toBe(expected)
  })
})

interface Sent {
  method: string | undefined
  url: string | undefined
  headers: IncomingMessage['headers']
  body: unknown
}

/** What the scripted Control Plane sends back for the next call. */
interface Reply {
  status: number
  type: string
  text: string
}

describe('governedClient', () => {
  afterEach(closeServer)

  let sent: Sent[]
  let reply: Reply
  let reset: boolean

  beforeEach(async () => {
    sent = []
    reply = { status: 200, type: 'application/json', text: '{}' }
    reset = false
    await listen((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      req.on('end', () => {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        sent.push({ method: req.method, url: req.url, headers: req.headers, body })
        if (reset) {
          req.socket.destroy()
          return
        }
        res.writeHead(reply.status, { 'content-type': reply.type })
        res.end(reply.text)
      })
    })
  })

  /** A Runner bound to the scripted Control Plane. */
  function runner(account: { accessToken(): Promise<string> } = { accessToken: () => Promise.resolve('tok') }) {
    return governedClient<StandInReason>({
      fail: (reason, message) => new ThingError(reason, message),
      reasons: [...COMMON_REFUSAL_REASONS, 'thing-unavailable'],
      fetch: (url, init) => undiciFetch(url, init),
      baseUrl: `${origin}/base/`,
      account,
    })
  }

  /** The error a rejected call carries. */
  async function failure(promise: Promise<unknown>): Promise<ThingError> {
    return await promise.then(() => { throw new Error('expected the call to fail') }, (error: unknown) => error as ThingError)
  }

  it('posts the version and fields with the current token and returns the decoded answer', async () => {
    reply.text = '{"entries":[]}'
    await expect(runner()('/team/thing/catalog', 7, { ref: 'r' }, undefined)).resolves.toEqual({ entries: [] })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ method: 'POST', url: '/team/thing/catalog', body: { protocolVersion: 7, ref: 'r' } })
    expect(sent[0]?.headers[ACCESS_TOKEN_HEADER]).toBe('Bearer tok')
    expect(sent[0]?.headers['content-type']).toBe('application/json')
  })

  it('stops the call when the caller has already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await failure(runner()('/p', 1, {}, controller.signal))).toMatchObject({ reason: 'control-plane-unreachable' })
    expect(sent).toEqual([])
  })

  it('reads the token again on every call', async () => {
    const tokens = ['first', 'second']
    const call = runner({ accessToken: () => Promise.resolve(tokens.shift() ?? 'none') })
    await call('/p', 1, {}, undefined)
    await call('/p', 1, {}, undefined)
    expect(sent.map(request => request.headers[ACCESS_TOKEN_HEADER])).toEqual(['Bearer first', 'Bearer second'])
  })

  it('is unauthenticated, without calling out, when no token can be read', async () => {
    const call = runner({ accessToken: () => Promise.reject(new Error('not bound')) })
    expect(await failure(call('/p', 1, {}, undefined))).toMatchObject({ reason: 'unauthenticated' })
    expect(sent).toEqual([])
  })

  it('is unreachable when the connection fails', async () => {
    reset = true
    expect(await failure(runner()('/p', 1, {}, undefined))).toMatchObject({
      reason: 'control-plane-unreachable',
      message: 'the Control Plane did not answer',
    })
  })

  it('is unreachable when the answer is not JSON', async () => {
    reply = { status: 502, type: 'text/html', text: '<html>bad gateway</html>' }
    expect(await failure(runner()('/p', 1, {}, undefined))).toMatchObject({
      reason: 'control-plane-unreachable',
      message: 'the answer was not a Control Plane answer',
    })
  })

  it.each([['null', 'null'], ['an array', '[]'], ['a number', '7']])('is unreachable when the answer is %s', async (_label, text) => {
    reply.text = text
    expect(await failure(runner()('/p', 1, {}, undefined))).toMatchObject({
      reason: 'control-plane-unreachable',
      message: 'the answer was not an object',
    })
  })

  it.each([...COMMON_REFUSAL_REASONS, 'thing-unavailable'])('carries the refusal word %s the Control Plane sent', async (reason) => {
    reply = { status: 409, type: 'application/json', text: JSON.stringify({ error: 'thing', reason }) }
    expect(await failure(runner()('/p', 1, {}, undefined))).toMatchObject({
      reason,
      message: 'the Control Plane answered HTTP 409',
    })
  })

  it.each([
    ['a word this build does not know', '{"reason":"maintenance"}'],
    ['a reason that is not a word', '{"reason":5}'],
    ['no reason', '{"error":"internal"}'],
  ])('treats %s as unreachable rather than inventing a meaning', async (_label, text) => {
    reply = { status: 500, type: 'application/json', text }
    expect(await failure(runner()('/p', 1, {}, undefined))).toMatchObject({ reason: 'control-plane-unreachable' })
  })
})
