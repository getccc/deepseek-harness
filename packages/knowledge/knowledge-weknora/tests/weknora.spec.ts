/**
 * The WeKnora contract, pinned against a live deployment's own responses.
 *
 * The envelopes, field names, and the two behaviors that shape this provider —
 * a `match_count` that context enrichment overshoots, and an unknown knowledge
 * base id the source silently ignores — are what a deployment actually answers,
 * not what its published Markdown says.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { KnowledgeError } from '@deepseek-ai/dsh-knowledge'
import WeknoraKnowledgeSource, {
  API_KEY_HEADER,
  ERROR_CODES,
  LIST_PATH,
  RESOURCE_PLACEHOLDER,
  hybridSearchPath,
  type Config,
} from '@deepseek-ai/dsh-knowledge-weknora'

const A = '690c0727-1af5-4b7a-8465-ebd2845f2266'
const B = '08f25606-8876-49cc-b509-70e84828db08'
const KEY = 'sk-space-key'

/** One captured upstream request, so a test can assert what left the process. */
interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
}

/** A fake WeKnora answering one scripted body per call, capturing requests. */
function fakeUpstream(bodies: readonly unknown[], status = 200): {
  calls: Captured[]
  fetch: typeof globalThis.fetch
} {
  const calls: Captured[] = []
  let index = 0
  const fetchImpl = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const raw = init?.body
    calls.push({
      url: input instanceof URL ? input.href : input,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof raw === 'string' ? JSON.parse(raw) as Record<string, unknown> : undefined,
    })
    const body = bodies[Math.min(index++, bodies.length - 1)]
    return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }))
  }
  return { calls, fetch: fetchImpl as unknown as typeof globalThis.fetch }
}

/** A root context whose credential resolution answers `value`. */
function rootWith(value: { value: string; source: string } | undefined): Context {
  const ctx = new Context()
  ctx.provide('credentials', { resolve: () => Promise.resolve(value) })
  return ctx
}

/** Load the provider, surfacing a configuration refusal as a rejection. */
async function load(ctx: Context, overrides: Partial<Config> = {}): Promise<void> {
  await ctx.plugin(WeknoraKnowledgeSource, {
    sourceCode: 'prod',
    baseUrl: 'http://127.0.0.1:8080',
    credentialRef: 'WEKNORA_KEY',
    ...overrides,
  }).await()
}

/** Mount the provider over a scripted upstream and a resolvable credential. */
async function mount(bodies: readonly unknown[], overrides: Partial<Config> = {}, status = 200): Promise<{
  ctx: Context
  calls: Captured[]
}> {
  const upstream = fakeUpstream(bodies, status)
  vi.stubGlobal('fetch', upstream.fetch)
  const ctx = rootWith({ value: KEY, source: 'env' })
  await load(ctx, overrides)
  return { ctx, calls: upstream.calls }
}

/** A listing entry as `GET /knowledge-bases` returns one. */
function wireBase(id: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: '临港知识库',
    description: '',
    type: 'document',
    knowledge_count: 1,
    chunk_count: 0,
    processing_count: 0,
    embedding_model_id: '7cb36a0d-83b2-490e-b887-d561b2fb3258',
    updated_at: '2026-08-30T10:00:00Z',
    ...patch,
  }
}

/** A search hit as `hybrid-search` returns one. */
function wireHit(upstreamId: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'chunk-1',
    content: '一级故障 30 分钟内响应。',
    knowledge_base_id: upstreamId,
    knowledge_title: '运维手册',
    knowledge_filename: '员工手册 v3.pdf',
    knowledge_source: 'file',
    chunk_type: 'text',
    chunk_index: 4,
    score: 0.338,
    seq: 1,
    ...patch,
  }
}

/** The success envelope both endpoints answer with. */
function ok(data: readonly unknown[]): unknown {
  return { data, success: true }
}

/** The failure envelope, which nests AppError rather than returning it flat. */
function fail(code: number): unknown {
  return { error: { code, details: null, message: 'connect ECONNREFUSED 10.0.0.4:8500' }, success: false }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('configuration fails at load, not at the first call', () => {
  it.each([
    ['a source code over the audit token bound', { sourceCode: 'a'.repeat(20) }],
    ['a source code holding a separator', { sourceCode: 'a:b' }],
    ['an empty source code', { sourceCode: '' }],
    ['a credential reference that is not one', { credentialRef: 'scope/id' }],
    ['a base URL that is not a URL', { baseUrl: 'not a url' }],
    ['a base URL on an unusable scheme', { baseUrl: 'ftp://kb.example.com' }],
  ])('refuses %s', async (_label, overrides) => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('should not be called')))
    await expect(load(rootWith({ value: KEY, source: 'env' }), overrides))
      .rejects.toThrow(/knowledge-weknora/u)
  })

  it('accepts the longest source code a reference can carry', async () => {
    const { ctx } = await mount([ok([])], { sourceCode: 'a'.repeat(19) })
    expect(ctx.knowledgeSource.sourceCode).toBe('a'.repeat(19))
    expect(ctx.knowledgeSource.providerKind).toBe('weknora')
  })
})

describe('listing a source', () => {
  it('reads the fields the catalog needs and attaches the space key', async () => {
    const { ctx, calls } = await mount([ok([wireBase(A), wireBase(B, { name: '南昌知识库', type: 'faq' })])])
    const bases = await ctx.knowledgeSource.list()
    expect(bases).toEqual([
      {
        upstreamId: A,
        name: '临港知识库',
        description: '',
        kind: 'document',
        documentCount: 1,
        chunkCount: 0,
        processingCount: 0,
        embeddingModelId: '7cb36a0d-83b2-490e-b887-d561b2fb3258',
        updatedAt: Date.parse('2026-08-30T10:00:00Z'),
      },
      expect.objectContaining({ upstreamId: B, name: '南昌知识库', kind: 'faq' }),
    ])
    expect(calls[0]?.url).toBe(`http://127.0.0.1:8080${LIST_PATH}`)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers[API_KEY_HEADER]).toBe(KEY)
  })

  it('fills in what a source omits rather than refusing the row', async () => {
    const { ctx } = await mount([ok([{ id: A, name: '库' }])])
    expect(await ctx.knowledgeSource.list()).toEqual([expect.objectContaining({
      description: '',
      documentCount: 0,
      embeddingModelId: '',
      updatedAt: undefined,
    })])
  })

  it.each([
    ['a row with no id', ok([{ name: '库' }])],
    ['a row that is not an object', ok(['库'])],
    ['an envelope that is not a success envelope', { data: [], success: false }],
    ['a body that is not an envelope', { knowledge_bases: [] }],
  ])('refuses %s as upstream-invalid', async (_label, body) => {
    const { ctx } = await mount([body])
    await expect(ctx.knowledgeSource.list()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('searching an authorized set', () => {
  it('puts an authorized id in the path and the whole set in the body', async () => {
    const { ctx, calls } = await mount([ok([wireHit(A)])])
    await ctx.knowledgeSource.search({ upstreamIds: [A, B], query: '年假', maxResults: 5 })
    expect(calls[0]?.url).toBe(`http://127.0.0.1:8080${hybridSearchPath(A)}`)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toEqual({ query_text: '年假', match_count: 5, knowledge_base_ids: [A, B] })
  })

  it('forwards content, score, title, and the base — and nothing else', async () => {
    const { ctx } = await mount([ok([wireHit(A)])])
    const [passage] = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 5 })
    expect(passage).toEqual({
      upstreamId: A,
      title: '运维手册',
      text: '一级故障 30 分钟内响应。',
      truncated: false,
      score: 0.338,
    })
    // The filename and source the upstream returned are deliberately absent.
    expect(Object.keys(passage ?? {}).sort()).toEqual(['score', 'text', 'title', 'truncated', 'upstreamId'])
  })

  it('bounds results itself, because enrichment overshoots match_count', async () => {
    // Asking for ten answers with eleven: the endpoint returns the top matches
    // plus their parent, nearby, and relation chunks.
    const hits = Array.from({ length: 11 }, () => wireHit(A))
    const { ctx } = await mount([ok(hits)])
    const passages = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 10 })
    expect(passages).toHaveLength(10)
  })

  it('applies its own configured ceiling under a larger caller bound', async () => {
    const { ctx, calls } = await mount([ok(Array.from({ length: 9 }, () => wireHit(A)))], { maxSearchResults: 3 })
    const passages = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 50 })
    expect(passages).toHaveLength(3)
    expect(calls[0]?.body?.['match_count']).toBe(3)
  })

  it('drops a hit from a base the request did not name', async () => {
    // The upstream ignores an id it does not know rather than refusing, so a
    // provider that trusted the response could attribute text to a base
    // nobody authorized.
    const { ctx } = await mount([ok([wireHit(A), wireHit('00000000-0000-0000-0000-000000000000')])])
    const passages = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 5 })
    expect(passages.map(passage => passage.upstreamId)).toEqual([A])
  })

  it('drops a non-text chunk, whose payload this delivery cannot redeem', async () => {
    const { ctx } = await mount([ok([
      wireHit(A, { chunk_type: 'image', image_info: '{"url":"resource://x"}' }),
      wireHit(A),
    ])])
    expect(await ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 5 })).toHaveLength(1)
  })

  it('neutralizes source references and never emits a loadable URL', async () => {
    const { ctx } = await mount([ok([wireHit(A, { content: '见附件 resource://kb/1/img.png 的说明' })])])
    const [passage] = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '附件', maxResults: 5 })
    expect(passage?.text).toBe(`见附件 ${RESOURCE_PLACEHOLDER} 的说明`)
    expect(passage?.text).not.toMatch(/https?:\/\//u)
  })

  it('cuts an overlong passage and says so', async () => {
    const { ctx } = await mount([ok([wireHit(A, { content: 'x'.repeat(50) })])], { maxPassageChars: 10 })
    const [passage] = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 5 })
    expect(passage).toMatchObject({ text: 'x'.repeat(10), truncated: true })
  })

  it('refuses an empty scope rather than letting the path id decide it', async () => {
    const { ctx, calls } = await mount([ok([])])
    await expect(ctx.knowledgeSource.search({ upstreamIds: [], query: '年假', maxResults: 5 }))
      .rejects.toMatchObject({ reason: 'upstream-invalid' })
    expect(calls).toHaveLength(0)
  })

  it('refuses a hit with no attributable base', async () => {
    const { ctx } = await mount([ok([{ content: 'text' }])])
    await expect(ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 5 }))
      .rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('a partial upstream row still yields a usable passage', () => {
  it('defaults a missing score and treats an unlabelled chunk as text', async () => {
    const { ctx } = await mount([ok([{ knowledge_base_id: A, content: '正文' }])])
    const [passage] = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '正文', maxResults: 5 })
    expect(passage).toMatchObject({ score: 0, title: '', text: '正文' })
  })

  it('ignores a score that is not a finite number', async () => {
    const { ctx } = await mount([ok([wireHit(A, { score: 'high' })])])
    const [passage] = await ctx.knowledgeSource.search({ upstreamIds: [A], query: '年假', maxResults: 5 })
    expect(passage?.score).toBe(0)
  })

  it('ignores an update timestamp the source did not format as a date', async () => {
    const { ctx } = await mount([ok([wireBase(A, { updated_at: 'whenever' })])])
    expect((await ctx.knowledgeSource.list())[0]?.updatedAt).toBeUndefined()
  })
})

describe('one operation has one deadline', () => {
  /** A source that never answers, rejecting when its signal aborts — as fetch does. */
  function hangingFetch(): typeof globalThis.fetch {
    return ((_input: string | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init?.signal
      const abort = (): void => { reject(new Error('aborted')) }
      if (signal?.aborted === true) abort()
      else signal?.addEventListener('abort', abort)
    })) as typeof globalThis.fetch
  }

  it('abandons a call the caller aborts', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx)
    const caller = new AbortController()
    const search = ctx.knowledgeSource.search({
      upstreamIds: [A], query: '年假', maxResults: 5, signal: caller.signal,
    })
    caller.abort()
    await expect(search).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })

  it('abandons a call the source leaves hanging past the timeout', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx, { requestTimeoutMs: 5 })
    await expect(ctx.knowledgeSource.list()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })
})

describe('failures carry a closed reason and no upstream prose', () => {
  it.each([
    ['a refused path id', ERROR_CODES.notFound, 'upstream-invalid'],
    ['a rejected key', ERROR_CODES.unauthorized, 'upstream-unavailable'],
    ['a rate limit', ERROR_CODES.tooManyRequests, 'upstream-unavailable'],
    ['an upstream fault', ERROR_CODES.internalServer, 'upstream-unavailable'],
    ['a validation refusal', ERROR_CODES.validation, 'upstream-invalid'],
  ])('maps %s', async (_label, code, reason) => {
    const { ctx } = await mount([fail(code)], {}, code === ERROR_CODES.internalServer ? 500 : 400)
    const error = await ctx.knowledgeSource.list().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(KnowledgeError)
    expect(error).toMatchObject({ reason })
    // The upstream message named an internal address; it does not travel.
    expect(String(error)).not.toMatch(/ECONNREFUSED|10\.0\.0\.4/u)
  })

  it('maps a failure envelope with no code by status', async () => {
    const server = await mount([{ success: false }], {}, 503)
    await expect(server.ctx.knowledgeSource.list()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
    const client = await mount([{ success: false }], {}, 400)
    await expect(client.ctx.knowledgeSource.list()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('refuses a body that is not JSON at all', async () => {
    const { ctx } = await mount(['<html>502 Bad Gateway</html>'], {}, 502)
    const error = await ctx.knowledgeSource.list().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'upstream-invalid' })
    expect(String(error)).not.toMatch(/html|Gateway/u)
  })

  it('reports an unreachable source without naming its address', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.4:8500')))
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx, { baseUrl: 'http://10.0.0.4:8500' })
    const error = await ctx.knowledgeSource.list().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'upstream-unavailable' })
    expect(String(error)).not.toMatch(/10\.0\.0\.4|ECONNREFUSED/u)
  })

  it('reports a missing credential as the source being unavailable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('should not be called')))
    const ctx = rootWith(undefined)
    await load(ctx)
    await expect(ctx.knowledgeSource.list()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })
})
