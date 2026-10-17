/**
 * The excel-tools contract as this provider reads it: the gateway routes the
 * deployment serves, their JSON, and the translations that shape the provider —
 * stage ids that must fit the reference alphabet, status codes that become
 * closed reasons, and bounds on what goes out and comes back.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GmoError } from '@deepseek-ai/dsh-gmo'
import ExcelToolsGmoSource, { CATEGORIES_PATH, RESULTS_PATH, type Config } from '@deepseek-ai/dsh-gmo-excel-tools'

const RESULT = '09032da5fb1e43968cb0d3ef422f90e2'
const TOKEN = 'etg_test-token-0123456789abcdef0123456789abcdef'

/** One captured upstream request, so a test can assert what left the process. */
interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
}

/** A fake excel-tools answering one scripted body per call, capturing requests. */
function fakeUpstream(bodies: readonly unknown[], status = 200): { calls: Captured[]; fetch: typeof globalThis.fetch } {
  const calls: Captured[] = []
  let index = 0
  const fetchImpl: typeof globalThis.fetch = (input, init) => {
    const raw = init?.body
    calls.push({
      url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
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
  return { calls, fetch: fetchImpl }
}

/** A root context whose credential resolution answers `value`. */
function rootWith(value: { value: string; source: string } | undefined): Context {
  const ctx = new Context()
  ctx.provide('credentials', { resolve: () => Promise.resolve(value) })
  return ctx
}

/** Load the provider, surfacing a configuration refusal as a rejection. */
async function load(ctx: Context, overrides: Partial<Config> = {}): Promise<void> {
  await ctx.plugin(ExcelToolsGmoSource, {
    sourceCode: 'gmo',
    baseUrl: 'http://10.1.120.90:8700',
    credentialRef: 'EXCEL_TOOLS_TOKEN',
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
  const ctx = rootWith({ value: TOKEN, source: 'env' })
  await load(ctx, overrides)
  return { ctx, calls: upstream.calls }
}

afterEach(() => { vi.unstubAllGlobals() })

/** One result as the listing returns it, recorded from the gateway. */
function wireResult(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RESULT, tool_id: 'gb-pipeline', tool_name: 'GB / GL 一键分配', name: 'GB / GL 一键分配 · 2026-W42 · #4',
    period: '2026-W42', total_rows: 169_187, created_at: '2026-10-16T14:50',
    stages: [
      { key: 'total', label: '2.Total Demand & Total Supply', id: `${RESULT}~total`, total_rows: 170_000 },
      { key: 'net-gap', label: '3.净缺口', id: `${RESULT}~net-gap`, total_rows: 170_000 },
      { key: 'allocation', label: '4.分配', id: RESULT, total_rows: 169_187 },
    ],
    ...patch,
  }
}

describe('configuration', () => {
  it('refuses a source code the reference grammar cannot carry', async () => {
    await expect(load(rootWith(undefined), { sourceCode: 'a b' })).rejects.toThrow(/sourceCode/u)
    await expect(load(rootWith(undefined), { sourceCode: 'x'.repeat(20) })).rejects.toThrow(/1-19/u)
  })

  it('refuses a credential reference that is not one', async () => {
    await expect(load(rootWith(undefined), { credentialRef: 'not a ref' })).rejects.toThrow(/credentialRef/u)
  })

  it.each(['not a url', 'ftp://10.1.120.90:8700'])('refuses the base URL %s', async (baseUrl) => {
    await expect(load(rootWith(undefined), { baseUrl })).rejects.toThrow(/baseUrl/u)
  })

  it('names itself for the reference grammar', async () => {
    const { ctx } = await mount([{}])
    expect(ctx.gmoSource.providerKind).toBe('exceltools')
    expect(ctx.gmoSource.sourceCode).toBe('gmo')
  })
})

describe('categories', () => {
  it('lists categories with keys a reference can carry', async () => {
    const { ctx, calls } = await mount([{ categories: [{ key: 'gb', label: 'GB / GL 分配', result_count: 39, tools: [] }] }])
    expect(await ctx.gmoSource.listCategories()).toEqual([{ upstreamId: 'gb', name: 'GB / GL 分配', resultCount: 39 }])
    expect(calls[0]).toMatchObject({ method: 'GET', url: `http://10.1.120.90:8700${CATEGORIES_PATH}` })
  })

  it('sends the gateway token as a bearer credential and nothing else that identifies a person', async () => {
    const { ctx, calls } = await mount([{ categories: [] }])
    await ctx.gmoSource.listCategories()
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(Object.keys(calls[0]?.headers ?? {}).sort()).toEqual(['X-Request-ID', 'authorization'])
  })

  it('refuses a key the reference grammar cannot carry, so the catalog never mints a bad reference', async () => {
    const { ctx } = await mount([{ categories: [{ key: 'g b', label: 'x', result_count: 0 }] }])
    await expect(ctx.gmoSource.listCategories()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('reads a missing count as unknown rather than zero', async () => {
    const { ctx } = await mount([{ categories: [{ key: 'gb', label: 'GB' }] }])
    expect((await ctx.gmoSource.listCategories())[0]?.resultCount).toBeUndefined()
  })
})

describe('results', () => {
  it('lists a page, translating the upstream stage separator into one the reference grammar accepts', async () => {
    const { ctx, calls } = await mount([{ category: 'gb', total: 39, results: [wireResult()] }])
    const listing = await ctx.gmoSource.listResults({ upstreamId: 'gb', page: 3, pageSize: 10 })
    expect(calls[0]?.url).toBe(`http://10.1.120.90:8700${CATEGORIES_PATH}/gb/results?limit=10&offset=20`)
    expect(listing).toMatchObject({ total: 39, pageSize: 10 })
    expect(listing.results[0]).toEqual({
      upstreamResultId: RESULT,
      name: 'GB / GL 一键分配 · 2026-W42 · #4',
      toolName: 'GB / GL 一键分配',
      period: '2026-W42',
      rows: 169_187,
      createdAt: '2026-10-16T14:50',
      stages: [
        { key: 'total', label: '2.Total Demand & Total Supply', upstreamResultId: `${RESULT}.total` },
        { key: 'net-gap', label: '3.净缺口', upstreamResultId: `${RESULT}.net-gap` },
        { key: 'allocation', label: '4.分配', upstreamResultId: RESULT },
      ],
    })
  })

  it('applies its own page-size bound before asking', async () => {
    const { ctx, calls } = await mount([{ total: 0, results: [] }], { maxItems: 5 })
    const listing = await ctx.gmoSource.listResults({ upstreamId: 'gb', page: 1, pageSize: 500 })
    expect(calls[0]?.url).toContain('limit=5&offset=0')
    expect(listing.pageSize).toBe(5)
  })

  it('reads a listing with no total, no row count, and no steps as empty figures', async () => {
    const { ctx } = await mount([{ category: 'gb', results: [wireResult({ total_rows: undefined, stages: undefined })] }])
    const listing = await ctx.gmoSource.listResults({ upstreamId: 'gb', page: 1, pageSize: 10 })
    expect(listing.total).toBe(0)
    expect(listing.results[0]).toMatchObject({ rows: 0, stages: [] })
  })

  it('reads a listing whose results are not a list as unreadable', async () => {
    const { ctx } = await mount([{ category: 'gb', total: 1, results: 'none' }])
    await expect(ctx.gmoSource.listResults({ upstreamId: 'gb', page: 1, pageSize: 10 })).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('refuses a result whose id is not text', async () => {
    const { ctx } = await mount([{ total: 1, results: [wireResult({ id: 7 })] }])
    await expect(ctx.gmoSource.listResults({ upstreamId: 'gb', page: 1, pageSize: 10 })).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('refuses a result id this build could not govern', async () => {
    const { ctx } = await mount([{ total: 1, results: [wireResult({ id: 'not-a-hex-id' })] }])
    await expect(ctx.gmoSource.listResults({ upstreamId: 'gb', page: 1, pageSize: 10 })).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('placement and description', () => {
  it('places a result in its category without reading figures', async () => {
    const { ctx, calls } = await mount([{ category: 'gb', id: RESULT }])
    expect(await ctx.gmoSource.placeResult(`${RESULT}.net-gap`)).toEqual({ upstreamId: 'gb' })
    expect(calls[0]?.url).toBe(`http://10.1.120.90:8700${RESULTS_PATH}/${RESULT}~net-gap/placement`)
  })

  it('refuses an id it did not mint before any request leaves', async () => {
    const { ctx, calls } = await mount([{}])
    for (const id of ['../admin/users', `${RESULT}/x`, 'ABC', `${RESULT}~total`, `${RESULT}.`]) {
      await expect(ctx.gmoSource.placeResult(id)).rejects.toMatchObject({ reason: 'result-unavailable' })
    }
    expect(calls).toHaveLength(0)
  })

  it('describes a result with its field meanings, dashboard, dates, and rules', async () => {
    const { ctx } = await mount([{
      category: 'gb', category_label: 'GB / GL 分配', id: RESULT, tool: { id: 'gb-pipeline', name: 'GB / GL 一键分配' },
      name: '一键分配', period: '2026-W42', total_rows: 169_187, created_at: '2026-10-16T14:50',
      stages: [{ key: 'net-gap', label: '3.净缺口', id: `${RESULT}~net-gap`, total_rows: 1 }],
      today: '2026-10-16', week_start: '2026-10-12',
      fields: [
        { key: 'remaining_gap', label: '剩余缺口', type: 'number', filter: null, description: '分配之后仍未满足的需求' },
        { key: 'supplier', label: 'Demand供应商', type: 'string', filter: 'multi', description: '' },
      ],
      sources: [{ name: 'UCT GB', slot: '供应商 GB 需求', rows: 3, file_name: 'uct.xlsx' }],
      glossary: '# GB / GL 分配：业务口径',
      dashboard: {
        measure: 'remaining_gap', measure_label: '剩余缺口', date_fields: [{ key: 'next', label: '下一层需求时间' }],
        dims: { gb_vendor: '来源（GB/GL Vendor）' }, stack_dims: ['gb_vendor'], rank_dims: ['pn'], heat_dims: ['pn'],
        flow: ['gb_vendor'], sub_dim: 'brand_l1', balance: false, structure: false,
      },
    }])
    const described = await ctx.gmoSource.describeResult(RESULT)
    expect(described).toMatchObject({
      upstreamId: 'gb', upstreamResultId: RESULT, categoryLabel: 'GB / GL 分配', toolName: 'GB / GL 一键分配', rows: 169_187,
      today: '2026-10-16', weekStart: '2026-10-12', glossary: '# GB / GL 分配：业务口径',
    })
    expect(described.stages).toEqual([{ key: 'net-gap', label: '3.净缺口', upstreamResultId: `${RESULT}.net-gap` }])
    expect(described.fields[0]).toEqual({ key: 'remaining_gap', label: '剩余缺口', type: 'number', filter: '', description: '分配之后仍未满足的需求' })
    expect(described.sources).toEqual([{ name: 'UCT GB', slot: '供应商 GB 需求', rows: 3 }])
    expect(described.dashboard).toMatchObject({ measure: 'remaining_gap', measureLabel: '剩余缺口', balance: false, structure: false })
  })

  it('describes a result with no dashboard by leaving it out', async () => {
    const { ctx } = await mount([{ category: 'gb', id: RESULT, tool: {}, fields: [] }])
    expect((await ctx.gmoSource.describeResult(RESULT)).dashboard).toBeUndefined()
  })
})

describe('questions', () => {
  /** An answer in the gateway's shape: the figures beside the category that answered. */
  const answer = (data: Record<string, unknown>): unknown => ({ category: 'gb', ...data })

  it('asks a free-form aggregation with the gateway’s own parameter names and a bounded limit', async () => {
    const { ctx, calls } = await mount([answer({ total: 117, data: [] })], { maxItems: 50 })
    const response = await ctx.gmoSource.ask({
      upstreamId: 'gb',
      upstreamResultId: RESULT,
      query: {
        kind: 'aggregate', metric: 'sum', field: 'remaining_gap', groupBy: ['gb_vendor'], dateGrain: 'week',
        orderBy: 'value_desc', limit: 500, filters: { multi: { supplier: ['HUNGO'] } },
      },
    })
    expect(calls[0]).toMatchObject({ method: 'POST', url: `http://10.1.120.90:8700${RESULTS_PATH}/${RESULT}/aggregate` })
    expect(calls[0]?.body).toEqual({
      metric: 'sum', field: 'remaining_gap', group_by: ['gb_vendor'], date_grain: 'week', order_by: 'value_desc', limit: 50,
      filters: { multi: { supplier: ['HUNGO'] } },
    })
    expect(response).toEqual({ upstreamId: 'gb', data: { total: 117, data: [] } })      // the category is reported, not forwarded
  })

  it('sends an empty filter set when the question carries none', async () => {
    const { ctx, calls } = await mount([answer({})])
    await ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'aggregate', metric: 'count' } })
    expect(calls[0]?.body).toEqual({ metric: 'count', limit: 200, filters: {} })
  })

  it('routes a ready-made dashboard to the insights route and bounds its ranking', async () => {
    const { ctx, calls } = await mount([answer({ buckets: [] })], { maxItems: 30 })
    await ctx.gmoSource.ask({
      upstreamId: 'gb',
      upstreamResultId: `${RESULT}.net-gap`,
      query: { kind: 'overview', widget: 'ranking', dim: 'pn', metric: 'qty', top: 100, filters: { empty: ['pn'] } },
    })
    expect(calls[0]).toMatchObject({ method: 'POST', url: `http://10.1.120.90:8700${RESULTS_PATH}/${RESULT}~net-gap/insights/ranking` })
    expect(calls[0]?.body).toEqual({ filters: { empty: ['pn'] }, dim: 'pn', metric: 'qty', top: 30 })
  })

  it('routes the balance views to their own routes, with the keyword and material url-encoded', async () => {
    const { ctx, calls } = await mount([answer({})])
    const ask = (query: Parameters<typeof ctx.gmoSource.ask>[0]['query']) =>
      ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query })
    await ask({ kind: 'overview', widget: 'balance', search: 'a b&c' })
    await ask({ kind: 'overview', widget: 'balance_analysis', dim: 'vendor' })
    await ask({ kind: 'overview', widget: 'balance_material', material: '713-00041-000-000' })
    expect(calls.map(call => [call.method, call.url.replace(`http://10.1.120.90:8700${RESULTS_PATH}/${RESULT}`, '')])).toEqual([
      ['GET', '/balance?q=a%20b%26c'],
      ['GET', '/balance/analysis?dim=vendor'],
      ['GET', '/balance/material?material=713-00041-000-000'],
    ])
  })

  it('refuses a material view that names no material, without a request', async () => {
    const { ctx, calls } = await mount([answer({})])
    await expect(ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'overview', widget: 'balance_material' } }))
      .rejects.toMatchObject({ reason: 'invalid-query' })
    expect(calls).toHaveLength(0)
  })

  it('pages detail rows with a bounded page size', async () => {
    const { ctx, calls } = await mount([answer({ total: 6, rows: [] })], { maxItems: 20 })
    await ctx.gmoSource.ask({
      upstreamId: 'gb',
      upstreamResultId: RESULT,
      query: { kind: 'rows', sort: { field: 'remaining_gap', dir: 'desc' }, page: 2, pageSize: 1000 },
    })
    expect(calls[0]?.url).toBe(`http://10.1.120.90:8700${RESULTS_PATH}/${RESULT}/query`)
    expect(calls[0]?.body).toEqual({ filters: {}, sort: { field: 'remaining_gap', dir: 'desc' }, page: 2, page_size: 20 })
  })

  it('forwards every optional key of a dashboard question under the gateway’s own names', async () => {
    const { ctx, calls } = await mount([answer({})])
    await ctx.gmoSource.ask({
      upstreamId: 'gb',
      upstreamResultId: RESULT,
      query: {
        kind: 'overview', widget: 'timeline', dateField: 'next', stack: 'supplier', sub: 'project', grain: 'month',
        metric: 'rows', dim: 'pn', top: 5,
      },
    })
    expect(calls[0]?.body).toEqual({
      filters: {}, date_field: 'next', stack: 'supplier', sub: 'project', grain: 'month', metric: 'rows', dim: 'pn', top: 5,
    })
  })

  it('sends only the filters when a dashboard question carries nothing else', async () => {
    const { ctx, calls } = await mount([answer({})])
    await ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'overview', widget: 'kpi' } })
    expect(calls[0]?.body).toEqual({ filters: {} })
  })

  it('asks the balance views their defaults when the question names no keyword or dimension', async () => {
    const { ctx, calls } = await mount([answer({})])
    await ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'overview', widget: 'balance' } })
    await ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'overview', widget: 'balance_analysis' } })
    expect(calls.map(call => call.url.replace(`http://10.1.120.90:8700${RESULTS_PATH}/${RESULT}`, ''))).toEqual([
      '/balance?q=',
      '/balance/analysis?dim=brand_l1',
    ])
  })

  it('refuses a dashboard this build does not know, without a request', async () => {
    const { ctx, calls } = await mount([answer({})])
    // The type system keeps an unknown widget out; a decoded wire value could still carry one.
    const query = { kind: 'overview' as const, widget: 'bogus' as never }
    await expect(ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query })).rejects.toMatchObject({ reason: 'invalid-query' })
    expect(calls).toHaveLength(0)
  })

  it('pages the first page at the deployment bound when the question names no sort, page, or size', async () => {
    const { ctx, calls } = await mount([answer({ rows: [] })], { maxItems: 40 })
    await ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'rows' } })
    expect(calls[0]?.body).toEqual({ filters: {}, page: 1, page_size: 40 })
  })

  it('refuses an answer that does not name its category', async () => {
    const { ctx } = await mount([{ total: 1 }])
    await expect(ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'aggregate', metric: 'count' } }))
      .rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('failures', () => {
  /** Run one operation against a scripted refusal and report its reason. */
  async function reasonOf(status: number, operation: 'ask' | 'place' = 'ask'): Promise<string> {
    const { ctx } = await mount([{ detail: 'connect ECONNREFUSED 10.0.0.4:5432' }], {}, status)
    try {
      if (operation === 'place') await ctx.gmoSource.placeResult(RESULT)
      else await ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'aggregate', metric: 'count' } })
    } catch (error) {
      expect(error).toBeInstanceOf(GmoError)
      expect((error as GmoError).message).not.toContain('10.0.0.4')       // upstream prose never leaves the provider
      return (error as GmoError).reason
    }
    return 'resolved'
  }

  it.each([
    [400, 'invalid-query'],
    [422, 'invalid-query'],
    [404, 'result-unavailable'],
    [409, 'unsupported'],
    [413, 'too-large'],
    [401, 'upstream-unavailable'],
    [403, 'upstream-unavailable'],
    [429, 'upstream-unavailable'],
    [503, 'upstream-unavailable'],
    [418, 'upstream-invalid'],
  ])('reads HTTP %i as %s', async (status, reason) => {
    expect(await reasonOf(status)).toBe(reason)
  })

  it('reads a missing result on the placement route as unavailable too', async () => {
    expect(await reasonOf(404, 'place')).toBe('result-unavailable')
  })

  it('reads a category listing that is missing as unreadable, not as a missing result', async () => {
    const { ctx } = await mount([{}], {}, 404)
    await expect(ctx.gmoSource.listCategories()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('reads a body that is not JSON as unreadable', async () => {
    const { ctx } = await mount(['<html>502</html>'])
    await expect(ctx.gmoSource.listCategories()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('reads an answer that is not an object as unreadable', async () => {
    const { ctx } = await mount(['[1, 2]'])
    await expect(ctx.gmoSource.listCategories()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('reads an answer over its own byte bound as too large, before parsing it', async () => {
    const { ctx } = await mount([{ categories: [], padding: 'x'.repeat(200) }], { maxResponseBytes: 100 })
    await expect(ctx.gmoSource.listCategories()).rejects.toMatchObject({ reason: 'too-large' })
  })

  it('reads a refused connection as the source not answering, without the network error text', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('connect ECONNREFUSED 10.0.0.4:8700')))
    const ctx = rootWith({ value: TOKEN, source: 'env' })
    await load(ctx)
    const failure = await ctx.gmoSource.listCategories().catch((error: unknown) => error)
    expect(failure).toMatchObject({ reason: 'upstream-unavailable' })
    expect((failure as Error).message).not.toContain('10.0.0.4')
  })

  it('reports an absent credential as the source being unavailable', async () => {
    vi.stubGlobal('fetch', fakeUpstream([{}]).fetch)
    const ctx = rootWith(undefined)
    await load(ctx)
    await expect(ctx.gmoSource.listCategories()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })

  it('resolves the credential per operation, so a rotation lands on the next call', async () => {
    const upstream = fakeUpstream([{ categories: [] }])
    vi.stubGlobal('fetch', upstream.fetch)
    let current = 'etg_first-token-0123456789abcdef0123456789abcdef'
    const ctx = new Context()
    ctx.provide('credentials', { resolve: () => Promise.resolve({ value: current, source: 'env' }) })
    await load(ctx)
    await ctx.gmoSource.listCategories()
    current = 'etg_second-token-0123456789abcdef0123456789abcdef'
    await ctx.gmoSource.listCategories()
    expect(upstream.calls.map(call => call.headers['authorization'])).toEqual(['Bearer etg_first-token-0123456789abcdef0123456789abcdef', `Bearer ${current}`])
  })

  it('answers a caller that already aborted without resolving a credential or sending anything', async () => {
    const { ctx, calls } = await mount([{}])
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.gmoSource.listCategories(controller.signal)).rejects.toMatchObject({ reason: 'cancelled' })
    expect(calls).toHaveLength(0)
  })

  it('reports a caller that aborts mid-flight as cancelled, not as an outage', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', (_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
      controller.abort()
    }))
    const ctx = rootWith({ value: TOKEN, source: 'env' })
    await load(ctx)
    await expect(ctx.gmoSource.listCategories(controller.signal)).rejects.toMatchObject({ reason: 'cancelled' })
  })

  it('abandons a call that outlives its deadline as the source not answering', async () => {
    vi.stubGlobal('fetch', (_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')) })
    }))
    const ctx = rootWith({ value: TOKEN, source: 'env' })
    await load(ctx, { requestTimeoutMs: 5 })
    await expect(ctx.gmoSource.listCategories()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })
})
