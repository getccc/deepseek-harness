/**
 * What leaves a Runner for a web search, and what it makes of what comes
 * back. The request is asserted field by field because the guarantee is an
 * absence: no address, no credential, no tenant, no provider can be in a body
 * that has no place for one.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime, { WebError } from '@deepseek-ai/dsh-web'
import { WEB_SEARCH_PATH, WEB_SEARCH_PROTOCOL_VERSION } from '@deepseek-ai/dsh-web-search-gateway-http'
import * as teamSearch from '@deepseek-ai/dsh-web-search-team'
import { TEAM_PROVIDER_ID, readAnswer } from '@deepseek-ai/dsh-web-search-team'

let ORIGIN = ''
const TOKEN = 'device-access-token'

/** One captured outbound request. */
interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

let calls: Captured[] = []
let plane: Server

/**
 * A Control Plane that records each request and answers however a test says.
 * A recording server rather than a stubbed `fetch`: the provider reaches the
 * Control Plane through Undici, so a global stub would leave these requests to
 * the real network.
 */
function controlPlane(status: number, body: unknown, delayMs = 0): void {
  calls = []
  plane.removeAllListeners('request')
  plane.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      calls.push({
        url: new URL(req.url ?? '/', ORIGIN).href,
        method: req.method ?? 'GET',
        headers: { ...req.headers } as Record<string, string>,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      })
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(typeof body === 'string' ? body : JSON.stringify(body))
      }, delayMs)
    })
  })
}

/** Mount the provider over a signed-in account client and the real web seam. */
async function mount(token: string | Error = TOKEN): Promise<Context> {
  const ctx = new Context()
  ctx.provide('teamAccountClient', {
    accessToken: () => token instanceof Error ? Promise.reject(token) : Promise.resolve(token),
  })
  await ctx.plugin(WebRuntime, { searchProvider: TEAM_PROVIDER_ID }).await()
  await ctx.plugin(teamSearch, teamSearch.Config({ controlPlaneUrl: ORIGIN })).await()
  return ctx
}

/** A well-formed answer. */
function answer(): unknown {
  return {
    content: 'an answer',
    sources: [
      { url: 'https://a.test/x', title: 'A', snippet: 'about a', publishedAt: '2026-01-01' },
      { url: 'https://b.test/y', title: 7, snippet: null },
    ],
    truncated: false,
  }
}

async function failure(ctx: Context, signal?: AbortSignal): Promise<WebError> {
  try {
    await ctx.web.search({ query: '股价', maxResults: 3 }, signal)
  } catch (error) {
    if (error instanceof WebError) return error
    throw error
  }
  throw new Error('the search did not fail')
}

beforeEach(async () => {
  plane = createServer()
  plane.listen(0, '127.0.0.1')
  await once(plane, 'listening')
  const address = plane.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  ORIGIN = `http://127.0.0.1:${String(address.port)}`
})

afterEach(async () => {
  plane.close()
  await once(plane, 'close')
})

describe('what leaves the Runner', () => {
  it('sends the query and the bound with the device token, and nothing that could name a provider or a credential', async () => {
    controlPlane(200, answer())
    const ctx = await mount()
    const result = await ctx.web.search({ query: '股价', maxResults: 3 })
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.url).toBe(`${ORIGIN}${WEB_SEARCH_PATH}`)
    expect(call.method).toBe('POST')
    expect(call.headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(call.headers['content-type']).toBe('application/json')
    expect(call.body).toEqual({ protocolVersion: WEB_SEARCH_PROTOCOL_VERSION, query: '股价', maxResults: 3 })
    // Mistyped optional fields are dropped rather than passed on; the seam
    // itself applies the bound to the answer.
    expect(result).toEqual({
      content: 'an answer',
      sources: [
        { url: 'https://a.test/x', title: 'A', snippet: 'about a', publishedAt: '2026-01-01' },
        { url: 'https://b.test/y' },
      ],
      truncated: false,
    })
    await ctx.fiber.dispose()
  })

  it('omits the bound when the caller set none, and the content when the answer has none', async () => {
    controlPlane(200, { sources: [], truncated: true })
    const ctx = await mount()
    expect(await ctx.web.search({ query: '股价' })).toEqual({ sources: [], truncated: true })
    expect(calls[0]!.body).toEqual({ protocolVersion: WEB_SEARCH_PROTOCOL_VERSION, query: '股价' })
    await ctx.fiber.dispose()
  })

  it('is always usable locally: the Control Plane decides per call', async () => {
    controlPlane(200, answer())
    const ctx = await mount()
    expect(new teamSearch.TeamSearchProvider(ctx, ORIGIN, () => Promise.reject(new Error('unused'))).available()).toBe(true)
    await ctx.fiber.dispose()
  })
})

describe('what it makes of a refusal', () => {
  it.each([
    ['unauthenticated', 401, 'WEB_PROVIDER_CREDENTIAL_MISSING', /not signed in/u],
    ['not-allowed', 403, 'WEB_PROVIDER_ERROR', /administrator has not allowed/u],
    ['upstream-unavailable', 502, 'WEB_PROVIDER_UNAVAILABLE', /not available right now/u],
    ['upstream-invalid', 502, 'WEB_PROVIDER_ERROR', /answered with an error/u],
    ['update-required', 426, 'WEB_PROVIDER_ERROR', /too old/u],
    ['cancelled', 499, 'WEB_ABORTED', /cancelled/u],
  ])('maps %s to the code the tool can act on', async (reason, status, code, message) => {
    controlPlane(status, { error: 'web', reason })
    const ctx = await mount()
    const error = await failure(ctx)
    expect(error.code).toBe(code)
    expect(error.message).toMatch(message)
    expect(error.message).toContain(`HTTP ${String(status)}`)
    await ctx.fiber.dispose()
  })

  it('treats a reason it does not know, and a refusal without one, as the Control Plane being unavailable', async () => {
    for (const body of [{ error: 'web', reason: 'teapot' }, { error: 'proxy' }]) {
      controlPlane(503, body)
      const ctx = await mount()
      expect((await failure(ctx)).code).toBe('WEB_PROVIDER_UNAVAILABLE')
      await ctx.fiber.dispose()
    }
  })

  it('reports an unbound or refused computer as a missing credential without calling the Control Plane', async () => {
    controlPlane(200, answer())
    const ctx = await mount(new Error('not-bound'))
    const error = await failure(ctx)
    expect(error.code).toBe('WEB_PROVIDER_CREDENTIAL_MISSING')
    expect(calls).toEqual([])
    await ctx.fiber.dispose()
  })
})

describe('what it makes of an answer it cannot read', () => {
  it('treats an answer that is not JSON, or not an object, as the Control Plane being unavailable', async () => {
    for (const body of ['<html>502</html>', [1, 2]]) {
      controlPlane(200, body)
      const ctx = await mount()
      expect((await failure(ctx)).code).toBe('WEB_PROVIDER_UNAVAILABLE')
      await ctx.fiber.dispose()
    }
  })

  it.each([
    ['sources that are not a list', { sources: 'none', truncated: false }],
    ['a truncated flag that is not a boolean', { sources: [], truncated: 'no' }],
    ['a content that is not text', { sources: [], truncated: false, content: 4 }],
    ['a source that is not an object', { sources: ['https://a.test'], truncated: false }],
    ['a source without a URL', { sources: [{ title: 'A' }], truncated: false }],
  ])('refuses %s as a provider error', (_label, body) => {
    expect(() => readAnswer(body)).toThrow(WebError)
    try {
      readAnswer(body)
    } catch (error) {
      expect((error as WebError).code).toBe('WEB_PROVIDER_ERROR')
    }
  })

  it('reports a Control Plane it cannot reach as unavailable', async () => {
    const ctx = new Context()
    ctx.provide('teamAccountClient', { accessToken: () => Promise.resolve(TOKEN) })
    await ctx.plugin(WebRuntime, { searchProvider: TEAM_PROVIDER_ID }).await()
    await ctx.plugin(teamSearch, teamSearch.Config({ controlPlaneUrl: 'http://127.0.0.1:9' })).await()
    expect((await failure(ctx)).code).toBe('WEB_PROVIDER_UNAVAILABLE')
    await ctx.fiber.dispose()
  })

  it('reports the caller\'s own cancellation as aborted', async () => {
    controlPlane(200, answer(), 2_000)
    const ctx = await mount()
    const controller = new AbortController()
    const pending = failure(ctx, controller.signal)
    await new Promise(resolve => setTimeout(resolve, 50))
    controller.abort()
    expect((await pending).code).toBe('WEB_ABORTED')
    await ctx.fiber.dispose()
  })
})
