/**
 * What leaves a Runner, and what it makes of what comes back.
 *
 * The requests are asserted field by field because the guarantee is an absence:
 * no address, no credential, no tenant, no upstream id can be in a body that
 * has no place for one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { KnowledgeError, KnowledgeRef } from '@deepseek-ai/dsh-knowledge'
import {
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_PROTOCOL_VERSION,
} from '@deepseek-ai/dsh-knowledge-gateway-http'
import TeamKnowledge from '@deepseek-ai/dsh-knowledge-team'

const ORIGIN = 'https://dsh.example.com'
const REF = 'weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'
const TOKEN = 'device-access-token'

/** One captured outbound request. */
interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

let calls: Captured[] = []

/** Answer every call with one scripted status and body. */
function controlPlane(status: number, body: unknown): void {
  calls = []
  vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
    calls.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: JSON.parse(init?.body as string) as Record<string, unknown>,
    })
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  })
}

/** Mount the provider over a signed-in account client. */
async function mount(token: string | Error = TOKEN): Promise<Context> {
  const ctx = new Context()
  ctx.provide('teamAccountClient', {
    accessToken: () => token instanceof Error ? Promise.reject(token) : Promise.resolve(token),
  })
  await ctx.plugin(TeamKnowledge, { controlPlaneUrl: ORIGIN }).await()
  return ctx
}

/** A well-formed directory answer. */
function directory(): unknown {
  return { entries: [{ ref: REF, displayName: '临港知识库', description: '', kind: 'document' }] }
}

/** A well-formed search answer. */
function results(): unknown {
  return {
    query: '年假',
    searched: [{ ref: REF, displayName: '临港知识库', description: '', kind: 'document' }],
    passages: [{ ref: REF, title: '运维手册', text: '一级故障 30 分钟内响应。', truncated: false, score: 0.3 }],
    truncated: false,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('what leaves this computer', () => {
  it('carries the protocol version, the token, and nothing else', async () => {
    controlPlane(200, directory())
    const ctx = await mount()
    await ctx.knowledge.catalog()
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}${KNOWLEDGE_CATALOG_PATH}`,
      method: 'POST',
      body: { protocolVersion: KNOWLEDGE_PROTOCOL_VERSION },
    })
    expect(Object.keys(calls[0]?.body ?? {})).toEqual(['protocolVersion'])
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('sends a query and a scope, and no address, credential, or upstream id', async () => {
    controlPlane(200, results())
    const ctx = await mount()
    await ctx.knowledge.search({
      query: '年假', scope: { mode: 'selected', refs: [KnowledgeRef(REF)] }, maxResults: 5,
    })
    expect(calls[0]?.body).toEqual({
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION,
      query: '年假',
      scope: { mode: 'selected', refs: [REF] },
      maxResults: 5,
    })
    const sent = JSON.stringify(calls[0])
    for (const forbidden of ['baseUrl', 'apiKey', 'tenant', 'upstreamId', 'X-API-Key']) {
      expect(sent, forbidden).not.toContain(forbidden)
    }
  })

  it('leaves an unbounded search unbounded, so the deployment decides', async () => {
    controlPlane(200, results())
    const ctx = await mount()
    await ctx.knowledge.search({ query: '年假', scope: { mode: 'all' } })
    expect(calls[0]?.body).toEqual({
      protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, query: '年假', scope: { mode: 'all' },
    })
  })

  it('reads the token per operation, so a refresh lands on the next call', async () => {
    controlPlane(200, directory())
    let issued = 0
    const ctx = new Context()
    ctx.provide('teamAccountClient', { accessToken: () => Promise.resolve(`token-${String(++issued)}`) })
    await ctx.plugin(TeamKnowledge, { controlPlaneUrl: ORIGIN }).await()
    await ctx.knowledge.catalog()
    await ctx.knowledge.catalog()
    expect(calls.map(call => call.headers['authorization']))
      .toEqual(['Bearer token-1', 'Bearer token-2'])
  })
})

describe('what it makes of an answer', () => {
  it('reads a directory back', async () => {
    controlPlane(200, directory())
    const ctx = await mount()
    expect(await ctx.knowledge.catalog()).toEqual([
      { ref: REF, displayName: '临港知识库', description: '', kind: 'document' },
    ])
  })

  it('reads an FAQ base back as one', async () => {
    controlPlane(200, { entries: [{ ref: REF, displayName: '常见问题', kind: 'faq' }] })
    const ctx = await mount()
    expect((await ctx.knowledge.catalog())[0]).toMatchObject({ kind: 'faq' })
  })

  it('reads passages back, filling in what the answer omits', async () => {
    controlPlane(200, {
      searched: [{ ref: REF, displayName: '库' }],
      passages: [{ ref: REF, text: '正文' }],
      truncated: false,
    })
    const ctx = await mount()
    const result = await ctx.knowledge.search({ query: '年假', scope: { mode: 'all' } })
    expect(result.passages).toEqual([{ ref: REF, title: '', text: '正文', truncated: false, score: 0 }])
    expect(result.searched).toEqual([{ ref: REF, displayName: '库', description: '', kind: 'document' }])
    // The query is this Runner's own, echoed rather than trusted from the wire.
    expect(result.query).toBe('年假')
  })

  it.each([
    ['a directory that is not a list', { entries: 'nope' }],
    ['an entry that is not an object', { entries: ['x'] }],
    ['an entry with no reference', { entries: [{ displayName: 'x' }] }],
    ['an entry whose reference is malformed', { entries: [{ ref: 'nope', displayName: 'x' }] }],
    ['an entry with no name', { entries: [{ ref: REF }] }],
  ])('refuses %s as upstream-invalid', async (_label, body) => {
    controlPlane(200, body)
    const ctx = await mount()
    await expect(ctx.knowledge.catalog()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it.each([
    ['no searched list', { passages: [], truncated: false }],
    ['no passages list', { searched: [], truncated: false }],
    ['no truncation flag', { searched: [], passages: [] }],
    ['a passage with no text', { searched: [], passages: [{ ref: REF }], truncated: false }],
    ['a passage whose reference is malformed', { searched: [], passages: [{ ref: 'x', text: 'y' }], truncated: false }],
  ])('refuses a search answer with %s', async (_label, body) => {
    controlPlane(200, body)
    const ctx = await mount()
    await expect(ctx.knowledge.search({ query: 'q', scope: { mode: 'all' } }))
      .rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('failures a member can act on', () => {
  it.each([
    ['not-allowed', 403],
    ['scope-incompatible', 409],
    ['upstream-unavailable', 502],
    ['update-required', 426],
  ] as const)('passes through %s', async (reason, status) => {
    controlPlane(status, { error: 'knowledge', reason })
    const ctx = await mount()
    const error = await ctx.knowledge.catalog().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect(error).toMatchObject({ reason })
  })

  it('treats a reason this build does not know as the Control Plane being unreachable', async () => {
    // A Control Plane speaking words this Runner cannot act on is one it cannot
    // act on; inventing a meaning would send a member after the wrong fix.
    controlPlane(403, { error: 'knowledge', reason: 'quota-exhausted' })
    const ctx = await mount()
    await expect(ctx.knowledge.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
  })

  it.each([
    ['a refusal with no reason at all', 500, { error: 'internal' }],
    ['a proxy error page', 502, '<html>502 Bad Gateway</html>'],
  ])('answers %s as unreachable', async (_label, status, body) => {
    controlPlane(status, body)
    const ctx = await mount()
    const error = await ctx.knowledge.catalog().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'control-plane-unreachable' })
    expect(String(error)).not.toMatch(/Bad Gateway/u)
  })

  it('answers a JSON array as unreachable, which is not a Control Plane answer', async () => {
    controlPlane(200, [])
    const ctx = await mount()
    await expect(ctx.knowledge.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
  })

  it('answers an unreachable network as unreachable, without naming the origin', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('getaddrinfo ENOTFOUND dsh.example.com')))
    const ctx = await mount()
    const error = await ctx.knowledge.catalog().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'control-plane-unreachable' })
    expect(String(error)).not.toMatch(/ENOTFOUND|dsh\.example\.com/u)
  })

  it('answers a computer that is not signed in as unauthenticated, before any request', async () => {
    controlPlane(200, directory())
    const ctx = await mount(new Error('NotBoundError'))
    await expect(ctx.knowledge.catalog()).rejects.toMatchObject({ reason: 'unauthenticated' })
    expect(calls).toHaveLength(0)
  })

  it('forwards the caller’s signal', async () => {
    controlPlane(200, directory())
    const ctx = await mount()
    const controller = new AbortController()
    await ctx.knowledge.catalog(controller.signal)
    // The provider passes the signal straight to fetch; there is no second
    // deadline here, because the Control Plane owns the operation's own bound.
    expect(calls).toHaveLength(1)
  })
})
