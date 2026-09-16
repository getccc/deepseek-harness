/**
 * What leaves a Runner, and what it makes of what comes back.
 *
 * The requests are asserted field by field because the guarantee is an absence:
 * no address, no credential, no tenant, no upstream id can be in a body that
 * has no place for one.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { KnowledgeDocRef, KnowledgeError, KnowledgeRef } from '@deepseek-ai/dsh-knowledge'
import {
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_DOCUMENTS_PATH,
  KNOWLEDGE_CATALOG_VERSION,
  KNOWLEDGE_DOCUMENTS_VERSION,
  KNOWLEDGE_DOCUMENT_VERSION,
  KNOWLEDGE_SEARCH_DOCUMENTS_VERSION,
  KNOWLEDGE_SEARCH_VERSION,
} from '@deepseek-ai/dsh-knowledge-gateway-http'
import TeamKnowledge from '@deepseek-ai/dsh-knowledge-team'

let ORIGIN = ''
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
let plane: Server

/**
 * A Control Plane that records each request and answers however a test says.
 *
 * A recording server rather than a stubbed `fetch`: the provider reaches the
 * Control Plane through Undici, so a global stub would leave these requests to
 * the real network. This is also what the company model transport's own test
 * does.
 */
function controlPlane(status: number, body: unknown): void {
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
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    })
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

/**
 * A Control Plane serving only version 1, the way a deployment that predates
 * the document routes answers: the version check runs before the route, so
 * every request declaring more is refused whatever it asks for.
 */
function oldDeployment(): void {
  calls = []
  plane.removeAllListeners('request')
  plane.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => { chunks.push(chunk as Buffer) })
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      calls.push({
        url: new URL(req.url ?? '/', ORIGIN).href,
        method: req.method ?? 'GET',
        headers: { ...req.headers } as Record<string, string>,
        body,
      })
      if (body['protocolVersion'] !== 1) {
        res.writeHead(426, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'knowledge', reason: 'update-required', minimum: 1, current: 1 }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(req.url === KNOWLEDGE_CATALOG_PATH ? directory() : results()))
    })
  })
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

beforeEach(async () => {
  plane = createServer()
  plane.listen(0, '127.0.0.1')
  await once(plane, 'listening')
  const address = plane.address()
  ORIGIN = `http://127.0.0.1:${String(typeof address === 'object' && address !== null ? address.port : 0)}`
  calls = []
})

afterEach(async () => {
  if (!plane.listening) return
  plane.close()
  await once(plane, 'close')
})

describe('what leaves this computer', () => {
  it('carries the protocol version, the token, and nothing else', async () => {
    controlPlane(200, directory())
    const ctx = await mount()
    await ctx.knowledge.catalog()
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}${KNOWLEDGE_CATALOG_PATH}`,
      method: 'POST',
      body: { protocolVersion: KNOWLEDGE_CATALOG_VERSION },
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
      protocolVersion: KNOWLEDGE_SEARCH_VERSION,
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
      protocolVersion: KNOWLEDGE_SEARCH_VERSION, query: '年假', scope: { mode: 'all' },
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

  it('reads a knowledge base’s document count and creation time when the answer carries them', async () => {
    controlPlane(200, {
      entries: [{
        ref: REF, displayName: '临港知识库', description: '', kind: 'document',
        documentCount: 3, createdAt: 1756857600000,
      }],
    })
    const ctx = await mount()
    expect((await ctx.knowledge.catalog())[0]).toMatchObject({ documentCount: 3, createdAt: 1756857600000 })
  })

  it.each([
    ['a count that is not a number', { documentCount: 'three', createdAt: 0 }],
    ['a negative count and a zero time', { documentCount: -1, createdAt: 0 }],
    ['a fractional count and a time that is text', { documentCount: 1.5, createdAt: 'yesterday' }],
  ])('reports %s as absent rather than as zero', async (_label, extra) => {
    controlPlane(200, { entries: [{ ref: REF, displayName: '临港知识库', kind: 'document', ...extra }] })
    const ctx = await mount()
    const entry = (await ctx.knowledge.catalog())[0]
    expect(entry).not.toHaveProperty('documentCount')
    expect(entry).not.toHaveProperty('createdAt')
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
    // The port this server just released: connecting there fails the way a
    // Control Plane that is down does, without waiting on a name to resolve.
    plane.close()
    await once(plane, 'close')
    const ctx = await mount()
    const error = await ctx.knowledge.catalog().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'control-plane-unreachable' })
    expect(String(error)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/u)
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

/** One document page as the Control Plane answers it. */
function documentPage(patch: Record<string, unknown> = {}): unknown {
  return {
    ref: REF,
    documents: [{
      docRef: `${REF}/doc-1`,
      ref: REF,
      title: '运维手册',
      description: '园区一级故障的响应时限与处置流程。',
      fileName: '运维手册.pdf',
      fileType: 'pdf',
      byteSize: 20480,
      state: 'ready',
      updatedAt: 1756857600000,
    }],
    page: 1,
    pageSize: 20,
    total: 7,
    ...patch,
  }
}

describe('listing one knowledge base’s documents', () => {
  it('names the knowledge base and the page, and nothing else', async () => {
    controlPlane(200, documentPage())
    const ctx = await mount()
    const page = await ctx.knowledge.documents({ ref: KnowledgeRef(REF), page: 2, pageSize: 5 })
    expect(calls[0]?.url).toBe(`${ORIGIN}${KNOWLEDGE_DOCUMENTS_PATH}`)
    expect(calls[0]?.body).toEqual({
      protocolVersion: KNOWLEDGE_DOCUMENTS_VERSION, ref: REF, page: 2, pageSize: 5,
    })
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(page.documents).toEqual([{
      docRef: `${REF}/doc-1`,
      ref: REF,
      title: '运维手册',
      description: '园区一级故障的响应时限与处置流程。',
      fileName: '运维手册.pdf',
      fileType: 'pdf',
      byteSize: 20480,
      state: 'ready',
      updatedAt: 1756857600000,
    }])
    expect(page.total).toBe(7)
  })

  it('sends no page fields when the caller names none', async () => {
    controlPlane(200, documentPage())
    const ctx = await mount()
    await ctx.knowledge.documents({ ref: KnowledgeRef(REF) })
    expect(calls[0]?.body).toEqual({ protocolVersion: KNOWLEDGE_DOCUMENTS_VERSION, ref: REF })
  })

  it('reads a document the answer holds less about, and a state it does not know, conservatively', async () => {
    controlPlane(200, documentPage({
      documents: [{ docRef: `${REF}/doc-2`, ref: REF, state: 'reticulating' }],
      total: 'many',
    }))
    const ctx = await mount()
    const page = await ctx.knowledge.documents({ ref: KnowledgeRef(REF) })
    expect(page.documents).toEqual([{
      docRef: `${REF}/doc-2`,
      ref: REF,
      title: '',
      description: '',
      fileName: '',
      fileType: '',
      byteSize: 0,
      state: 'unavailable',
      updatedAt: undefined,
    }])
    // An unreadable total is unknown, never zero.
    expect(page.total).toBeUndefined()
  })

  it.each([
    ['a document with no reference', { documents: [{ ref: REF }] }],
    ['a document whose reference is not one', { documents: [{ docRef: 'nope', ref: REF }] }],
    ['a document naming a knowledge base that is not one', { documents: [{ docRef: `${REF}/doc-1`, ref: 'nope' }] }],
    ['a page with no documents list', { documents: 'all of them' }],
    ['a page with no page number', { page: 'first' }],
    ['a page with no page size', { pageSize: null }],
    ['a document that is not an object', { documents: ['doc-1'] }],
  ])('refuses %s', async (_label, patch) => {
    controlPlane(200, documentPage(patch))
    const ctx = await mount()
    await expect(ctx.knowledge.documents({ ref: KnowledgeRef(REF) }))
      .rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('carries a refusal back as its closed reason', async () => {
    controlPlane(403, { error: 'knowledge', reason: 'not-allowed' })
    const ctx = await mount()
    await expect(ctx.knowledge.documents({ ref: KnowledgeRef(REF) }))
      .rejects.toMatchObject({ reason: 'not-allowed' })
  })
})

describe('reading one document', () => {
  it('names the document and the byte bound, and decodes the file it gets', async () => {
    controlPlane(200, {
      kind: 'bytes', docRef: `${REF}/doc-1`, fileName: '运维手册.pdf',
      contentType: 'application/pdf', base64: 'AQID',
    })
    const ctx = await mount()
    const content = await ctx.knowledge.documentContent({
      docRef: KnowledgeDocRef(`${REF}/doc-1`), maxBytes: 4096,
    })
    expect(calls[0]?.body).toEqual({
      protocolVersion: KNOWLEDGE_DOCUMENT_VERSION, docRef: `${REF}/doc-1`, maxBytes: 4096,
    })
    expect(content).toEqual({
      kind: 'bytes',
      docRef: `${REF}/doc-1`,
      fileName: '运维手册.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    })
  })

  it('reads parsed text as text, and a missing file name as empty', async () => {
    controlPlane(200, { kind: 'text', docRef: `${REF}/doc-1`, text: '一级故障 30 分钟内响应。', truncated: true })
    const ctx = await mount()
    const content = await ctx.knowledge.documentContent({ docRef: KnowledgeDocRef(`${REF}/doc-1`) })
    expect(calls[0]?.body).toEqual({ protocolVersion: KNOWLEDGE_DOCUMENT_VERSION, docRef: `${REF}/doc-1` })
    expect(content).toEqual({
      kind: 'text',
      docRef: `${REF}/doc-1`,
      fileName: '',
      text: '一级故障 30 分钟内响应。',
      truncated: true,
    })
  })

  it.each([
    ['an answer naming no kind', { docRef: `${REF}/doc-1`, base64: 'AQID' }],
    ['a byte answer with no base64', { kind: 'bytes', contentType: 'application/pdf' }],
    ['a byte answer with no content type', { kind: 'bytes', base64: 'AQID' }],
    ['a text answer with no text', { kind: 'text', truncated: false }],
  ])('refuses %s', async (_label, body) => {
    controlPlane(200, body)
    const ctx = await mount()
    await expect(ctx.knowledge.documentContent({ docRef: KnowledgeDocRef(`${REF}/doc-1`) }))
      .rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('carries the document-unavailable refusal back as itself', async () => {
    controlPlane(409, { error: 'knowledge', reason: 'document-unavailable' })
    const ctx = await mount()
    await expect(ctx.knowledge.documentContent({ docRef: KnowledgeDocRef(`${REF}/doc-1`) }))
      .rejects.toMatchObject({ reason: 'document-unavailable' })
  })
})

describe('a deployment older than this build', () => {
  it('keeps the directory and the search, and refuses only the newer route', async () => {
    oldDeployment()
    const ctx = await mount()
    expect((await ctx.knowledge.catalog()).map(entry => entry.displayName)).toEqual(['临港知识库'])
    expect((await ctx.knowledge.search({ query: '年假', scope: { mode: 'all' } })).passages).toHaveLength(1)
    await expect(ctx.knowledge.documents({ ref: KnowledgeRef(REF) }))
      .rejects.toMatchObject({ reason: 'update-required' })
    await expect(ctx.knowledge.documentContent({ docRef: KnowledgeDocRef(`${REF}/doc-1`) }))
      .rejects.toMatchObject({ reason: 'update-required' })
  })
})

describe('a search narrowed to documents', () => {
  it('sends the knowledge base and the documents, and reads the document off each hit', async () => {
    controlPlane(200, {
      query: '故障响应',
      searched: [{ ref: REF, displayName: '临港知识库', description: '', kind: 'document' }],
      passages: [
        { ref: REF, docRef: `${REF}/doc-1`, title: '运维手册', text: '一级故障 30 分钟内响应。', truncated: false, score: 0.8 },
        { ref: REF, docRef: 'not-a-reference', title: '值班制度', text: '二级故障 2 小时内响应。', truncated: false, score: 0.4 },
      ],
      truncated: false,
    })
    const ctx = await mount()
    const result = await ctx.knowledge.search({
      query: '故障响应',
      scope: { mode: 'documents', ref: KnowledgeRef(REF), docRefs: [KnowledgeDocRef(`${REF}/doc-1`)] },
    })
    // Narrowing declares its own version: a Control Plane that predates it
    // would search the whole knowledge base, so it has to refuse instead.
    expect(calls[0]?.body).toEqual({
      protocolVersion: KNOWLEDGE_SEARCH_DOCUMENTS_VERSION,
      query: '故障响应',
      scope: { mode: 'documents', ref: REF, docRefs: [`${REF}/doc-1`] },
    })
    expect(KNOWLEDGE_SEARCH_DOCUMENTS_VERSION).toBeGreaterThan(KNOWLEDGE_SEARCH_VERSION)
    // A document reference this build cannot read is dropped rather than
    // refused: the passage still names its knowledge base.
    expect(result.passages.map(row => row.docRef)).toEqual([`${REF}/doc-1`, undefined])
  })
})
