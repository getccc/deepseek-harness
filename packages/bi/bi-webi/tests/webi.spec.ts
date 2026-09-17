/**
 * The webi contract as this provider reads it: the Lightdash routes the
 * deployment serves, their envelopes, and the two behaviors that shape the
 * provider — a run that is asynchronous upstream, and a content listing that
 * takes no keyword.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BiError } from '@deepseek-ai/dsh-bi'
import WebiBiSource, {
  API_KEY_SCHEME,
  AUTHORIZATION_HEADER,
  PROJECTS_PATH,
  chartKindOf,
  chartQueryPath,
  contentPath,
  queryCancelPath,
  queryResultsPath,
  savedChartPath,
  type Config,
} from '@deepseek-ai/dsh-bi-webi'

const PROJECT = '55d61de1-ed86-4ad4-b96e-205114de5245'
const CHART = 'aa064703-8940-4ada-9ef0-3fff1905faa2'
const QUERY = 'q-7f3b'
const KEY = '2c29cc0ce570313d4efc284fb5334caa'

/** One captured upstream request, so a test can assert what left the process. */
interface Captured {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | undefined
}

/** A fake webi answering one scripted body per call, capturing requests. */
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
  await ctx.plugin(WebiBiSource, {
    sourceCode: 'prod',
    baseUrl: 'http://127.0.0.1:8100',
    credentialRef: 'WEBI_API_KEY',
    pollIntervalMs: 1,
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

/** The success envelope every route answers with. */
function ok(results: unknown): unknown {
  return { status: 'ok', results }
}

/** The failure envelope, which nests the status beside upstream prose. */
function fail(statusCode: number): unknown {
  return { status: 'error', error: { statusCode, name: 'Error', message: 'connect ECONNREFUSED 10.0.0.4:5432' } }
}

/** One project as `GET /org/projects` returns it. */
function wireProject(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { projectUuid: PROJECT, name: 'Demo YH', type: 'DEFAULT', warehouseType: 'postgres', requireUserCredentials: false, ...patch }
}

/** One chart as the content listing returns it. */
function wireContent(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    contentType: 'chart', uuid: CHART, slug: 'sales', name: '销售总览', description: null,
    createdAt: '2026-07-01T00:00:00.000Z', lastUpdatedAt: '2026-09-10T08:00:00.000Z',
    project: { uuid: PROJECT, name: 'Demo YH' }, organization: { uuid: 'o', name: 'Acme' },
    space: { uuid: 's', name: '销售分析' }, pinnedList: null, views: 126, firstViewedAt: null,
    source: 'dbt_explore', chartKind: 'vertical_bar', dashboard: null, ...patch,
  }
}

/** A content page with the total the source reports. */
function contentPage(data: readonly unknown[], totalResults = data.length): unknown {
  return ok({ data, pagination: { page: 1, pageSize: 500, totalPageCount: 1, totalResults } })
}

/** One saved chart as `GET /saved/{uuid}` returns it. */
function wireSaved(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uuid: CHART, projectUuid: PROJECT, name: '销售总览', description: '按区域', tableName: 'orders',
    spaceName: '销售分析', updatedAt: '2026-09-10T08:00:00.000Z',
    chartConfig: { type: 'cartesian', config: { layout: { flipAxes: false }, eChartsConfig: { series: [{ type: 'bar' }] } } },
    metricQuery: { exploreName: 'orders', dimensions: ['orders_region'], metrics: ['orders_total'], filters: {}, sorts: [], limit: 500, tableCalculations: [] },
    ...patch,
  }
}

/** What starting a run answers. */
function wireStarted(patch: Record<string, unknown> = {}): unknown {
  return ok({
    queryUuid: QUERY,
    cacheMetadata: { cacheHit: false },
    parameterReferences: [],
    usedParametersValues: {},
    metricQuery: {
      exploreName: 'orders',
      dimensions: ['orders_region'],
      metrics: ['orders_total'],
      filters: {
        dimensions: { id: 'g1', and: [{ id: 'r1', target: { fieldId: 'orders_status' }, operator: 'equals', values: ['paid', 'shipped'] }] },
        metrics: { id: 'g2', or: [
          { id: 'r2', target: { fieldId: 'orders_total' }, operator: 'greaterThan', values: [100] },
          { id: 'r3', target: { fieldId: 'orders_total' }, operator: 'notNull' },
          { id: 'r4', target: { fieldId: 'orders_count' }, operator: 'equals', values: [1], disabled: true },
        ] },
      },
      sorts: [],
      limit: 500,
      tableCalculations: [{ name: 'share', displayName: '占比', sql: '' }],
    },
    fields: {
      orders_region: { fieldType: 'dimension', type: 'string', name: 'region', label: '区域', table: 'orders' },
      orders_total: { fieldType: 'metric', type: 'sum', name: 'total', label: '销售额', table: 'orders' },
      share: { name: 'share', displayName: '占比', sql: '' },
    },
    ...patch,
  })
}

/** One results page, ready or not. */
function wirePage(status: string, rows: readonly unknown[] = [], patch: Record<string, unknown> = {}): unknown {
  return ok({ status, queryUuid: QUERY, rows, totalResults: rows.length, ...patch })
}

/** One row as a ready page carries it. */
function wireRow(region: string, total: number | null): unknown {
  return {
    orders_region: { value: { raw: region, formatted: region } },
    orders_total: { value: { raw: total, formatted: total === null ? '∅' : `¥${String(total)}` } },
    share: { value: { raw: 0.5, formatted: '50%' } },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('configuration fails at load, not at the first call', () => {
  it.each([
    ['a source code over the audit token bound', { sourceCode: 'a'.repeat(20) }],
    ['a source code holding a separator', { sourceCode: 'a:b' }],
    ['an empty source code', { sourceCode: '' }],
    ['a credential reference that is not one', { credentialRef: 'scope/id' }],
    ['a base URL that is not a URL', { baseUrl: 'not a url' }],
    ['a base URL on an unusable scheme', { baseUrl: 'ftp://bi.example.com' }],
  ])('refuses %s', async (_label, overrides) => {
    await expect(load(rootWith(undefined), overrides)).rejects.toThrow(/bi-webi:/u)
  })

  it('accepts the longest source code a reference can carry', async () => {
    const { ctx } = await mount([ok([])], { sourceCode: 'a'.repeat(19) })
    expect(ctx.biSource.sourceCode).toBe('a'.repeat(19))
    expect(ctx.biSource.providerKind).toBe('webi')
  })
})

describe('listing projects', () => {
  it('reads the fields the catalog needs and attaches the token under the ApiKey scheme', async () => {
    const { ctx, calls } = await mount([ok([wireProject()])])
    const projects = await ctx.biSource.listProjects()
    expect(projects).toEqual([{ upstreamId: PROJECT, name: 'Demo YH', projectType: 'DEFAULT', warehouseType: 'postgres' }])
    expect(calls[0]?.url).toBe(`http://127.0.0.1:8100${PROJECTS_PATH}`)
    expect(calls[0]?.method).toBe('GET')
    expect(calls[0]?.headers[AUTHORIZATION_HEADER]).toBe(`${API_KEY_SCHEME} ${KEY}`)
    expect(calls[0]?.headers['X-Request-ID']).toMatch(/^[0-9a-f-]{36}$/u)
  })

  it('fills in what a source omits rather than refusing the row', async () => {
    const { ctx } = await mount([ok([wireProject({ type: undefined, warehouseType: 7 })])])
    expect((await ctx.biSource.listProjects())[0]).toMatchObject({ projectType: '', warehouseType: '' })
  })

  it.each([
    ['a project with no id', [wireProject({ projectUuid: undefined })]],
    ['a project with no name', [wireProject({ name: 3 })]],
    ['a project id a reference cannot carry', [wireProject({ projectUuid: 'a:b' })]],
    ['a project that is not an object', ['x']],
    ['a listing that is not an array', { data: [] }],
  ])('refuses %s as unreadable', async (_label, results) => {
    const { ctx } = await mount([ok(results)])
    await expect(ctx.biSource.listProjects()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('listing one project’s charts', () => {
  it('asks one page as wide as its own bound and reads the fields a listing needs', async () => {
    const { ctx, calls } = await mount([contentPage([wireContent()])], { maxCharts: 50 })
    const listing = await ctx.biSource.listCharts({ upstreamId: PROJECT })
    expect(calls[0]?.url).toBe(`http://127.0.0.1:8100${contentPath(PROJECT, 50)}`)
    expect(listing.truncated).toBe(false)
    expect(listing.charts).toEqual([{
      upstreamChartId: CHART, name: '销售总览', spaceName: '销售分析', description: '',
      kind: 'vertical_bar', updatedAt: Date.parse('2026-09-10T08:00:00.000Z'),
    }])
  })

  it('says when the source holds more than the bound let it read', async () => {
    const { ctx } = await mount([contentPage([wireContent()], 88)])
    expect((await ctx.biSource.listCharts({ upstreamId: PROJECT })).truncated).toBe(true)
  })

  it.each([
    ['the source’s own misspelling', 'watefall', 'waterfall'],
    ['a kind this build knows', 'big_number', 'big_number'],
    ['a kind this build does not know', 'hologram', 'other'],
    ['no kind at all', undefined, 'other'],
  ])('reads %s as a kind of its own vocabulary', async (_label, chartKind, expected) => {
    const { ctx } = await mount([contentPage([wireContent({ chartKind })])])
    expect((await ctx.biSource.listCharts({ upstreamId: PROJECT })).charts[0]?.kind).toBe(expected)
  })

  it('falls back to the creation time and to an empty space', async () => {
    const { ctx } = await mount([contentPage([wireContent({ lastUpdatedAt: null, space: null, description: '看板' })])])
    const [chart] = (await ctx.biSource.listCharts({ upstreamId: PROJECT })).charts
    expect(chart).toMatchObject({ updatedAt: Date.parse('2026-07-01T00:00:00.000Z'), spaceName: '', description: '看板' })
  })

  it('reads a timestamp the source did not format as a date as no timestamp', async () => {
    const { ctx } = await mount([contentPage([wireContent({ lastUpdatedAt: 'yesterday', createdAt: 'earlier' })])])
    expect((await ctx.biSource.listCharts({ upstreamId: PROJECT })).charts[0]?.updatedAt).toBeUndefined()
  })

  it.each([
    ['a chart with no name', [wireContent({ name: null })]],
    ['a chart id a reference cannot carry', [wireContent({ uuid: 'a/b' })]],
    ['a chart that is not an object', [4]],
  ])('refuses %s as unreadable', async (_label, data) => {
    const { ctx } = await mount([contentPage(data)])
    await expect(ctx.biSource.listCharts({ upstreamId: PROJECT })).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('refuses a page with no data array', async () => {
    const { ctx } = await mount([ok({ pagination: {} })])
    await expect(ctx.biSource.listCharts({ upstreamId: PROJECT })).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('where a chart sits', () => {
  it('answers the project the record names, with the chart beside it', async () => {
    const { ctx, calls } = await mount([ok(wireSaved())])
    const placement = await ctx.biSource.describeChart(CHART)
    expect(calls[0]?.url).toBe(`http://127.0.0.1:8100${savedChartPath(CHART)}`)
    expect(placement).toEqual({
      upstreamId: PROJECT,
      chart: {
        upstreamChartId: CHART, name: '销售总览', spaceName: '销售分析', description: '按区域',
        kind: 'vertical_bar', updatedAt: Date.parse('2026-09-10T08:00:00.000Z'),
      },
    })
  })

  it('reports a chart the source does not hold as unavailable', async () => {
    const { ctx } = await mount([fail(404)], {}, 404)
    await expect(ctx.biSource.describeChart(CHART)).rejects.toMatchObject({ reason: 'chart-unavailable' })
  })

  it('refuses a record with no project, because there would be nothing to authorize', async () => {
    const { ctx } = await mount([ok(wireSaved({ projectUuid: '' }))])
    await expect(ctx.biSource.describeChart(CHART)).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('refuses a record the envelope does not carry as an object', async () => {
    const { ctx } = await mount([ok([wireSaved()])])
    await expect(ctx.biSource.describeChart(CHART)).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('the kind of picture a saved chart draws', () => {
  it.each([
    ['a table', { type: 'table' }, 'table'],
    ['a big number', { type: 'big_number', config: {} }, 'big_number'],
    ['a family this build does not know', { type: 'hologram' }, 'other'],
    ['no configuration at all', undefined, 'other'],
    ['a vertical bar', { type: 'cartesian', config: { layout: {}, eChartsConfig: { series: [{ type: 'bar' }] } } }, 'vertical_bar'],
    ['a horizontal bar', { type: 'cartesian', config: { layout: { flipAxes: true }, eChartsConfig: { series: [{ type: 'bar' }] } } }, 'horizontal_bar'],
    ['a waterfall', { type: 'cartesian', config: { layout: { isWaterfall: true }, eChartsConfig: { series: [{ type: 'bar' }] } } }, 'waterfall'],
    ['a line', { type: 'cartesian', config: { eChartsConfig: { series: [{ type: 'line' }] } } }, 'line'],
    ['a line drawn as an area', { type: 'cartesian', config: { eChartsConfig: { series: [{ type: 'line', areaStyle: {} }] } } }, 'area'],
    ['an area', { type: 'cartesian', config: { eChartsConfig: { series: [{ type: 'area' }] } } }, 'area'],
    ['a scatter', { type: 'cartesian', config: { eChartsConfig: { series: [{ type: 'scatter' }] } } }, 'scatter'],
    ['a bubble', { type: 'cartesian', config: { layout: { isBubble: true }, eChartsConfig: { series: [{ type: 'scatter' }] } } }, 'bubble'],
    ['mixed series', { type: 'cartesian', config: { eChartsConfig: { series: [{ type: 'bar' }, { type: 'line' }] } } }, 'mixed'],
    ['two lines, one an area', { type: 'cartesian', config: { eChartsConfig: { series: [{ type: 'line' }, { type: 'line', areaStyle: {} }] } } }, 'mixed'],
    ['a cartesian chart with no series', { type: 'cartesian', config: { eChartsConfig: {} } }, 'other'],
    ['a series type this build does not know', { type: 'cartesian', config: { eChartsConfig: { series: [{ type: 'candlestick' }] } } }, 'other'],
  ])('reads %s', (_label, chartConfig, expected) => {
    expect(chartKindOf(chartConfig)).toBe(expected)
  })
})

describe('running one saved chart', () => {
  it('starts the run naming the chart alone, polls until ready, and reads the page', async () => {
    const { ctx, calls } = await mount([
      wireStarted(),
      wirePage('pending'),
      wirePage('ready', [wireRow('华东', 1280.5), wireRow('华北', null)]),
    ], { maxRows: 100 })
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(calls[0]).toMatchObject({ method: 'POST', url: `http://127.0.0.1:8100${chartQueryPath(PROJECT)}`, body: { chartUuid: CHART } })
    expect(calls[1]?.url).toBe(`http://127.0.0.1:8100${queryResultsPath(PROJECT, QUERY, 20)}`)
    expect(calls).toHaveLength(3)
    expect(run.fields).toEqual([
      { id: 'orders_region', label: '区域', role: 'dimension', type: 'string' },
      { id: 'orders_total', label: '销售额', role: 'metric', type: 'sum' },
      { id: 'share', label: '占比', role: 'metric', type: '' },
    ])
    expect(run.rows).toEqual([['华东', 1280.5, 0.5], ['华北', null, 0.5]])
    expect(run).toMatchObject({ rowCount: 2, truncated: false, cellsTruncated: false })
  })

  it('renders the saved filters as one line, leaving out a rule the author switched off', async () => {
    const { ctx } = await mount([wireStarted(), wirePage('ready', [])])
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run.filters).toBe('orders_status equals paid, shipped and (orders_total greaterThan 100 or orders_total notNull)')
  })

  it('reads a run with no filters, no field map, and no query from the rows themselves', async () => {
    const { ctx } = await mount([
      ok({ queryUuid: QUERY }),
      wirePage('ready', [{ a: { value: { raw: true, formatted: 'yes' } }, b: { value: { raw: { nested: 1 }, formatted: 'obj' } } }]),
    ])
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run.filters).toBe('')
    expect(run.fields).toEqual([{ id: 'a', label: 'a', role: 'metric', type: '' }, { id: 'b', label: 'b', role: 'metric', type: '' }])
    expect(run.rows).toEqual([[true, 'obj']])
  })

  it('reads a ready page with no rows, no field map, and no query as an empty table', async () => {
    const { ctx } = await mount([ok({ queryUuid: QUERY }), wirePage('ready', [])])
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run).toMatchObject({ fields: [], rows: [], rowCount: 0, truncated: false })
  })

  it('reads a cell the row does not carry, a bare value, and an infinite number as empty', async () => {
    const { ctx } = await mount([
      ok({ queryUuid: QUERY, metricQuery: { dimensions: ['a', 'b', 'c'] } }),
      wirePage('ready', [{ a: 'bare', c: { value: { raw: Number.POSITIVE_INFINITY, formatted: '∞' } } }]),
    ])
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run.rows).toEqual([[null, null, null]])
  })

  it('renders a value the source formatted but did not type, and a filter group nobody can read', async () => {
    const { ctx } = await mount([
      ok({
        queryUuid: QUERY,
        metricQuery: { dimensions: ['d', 'e'], filters: { dimensions: { id: 'g', and: [{ id: 'r', target: {}, operator: 'equals' }] }, metrics: 'x' } },
      }),
      wirePage('ready', [{ d: { value: { raw: [1, 2], formatted: '12' } }, e: { value: { raw: [3] } } }]),
    ])
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run.rows).toEqual([['12', '[3]']])
    expect(run.filters).toBe('')
  })

  it('renders a rule with values that are not text, and a metric rule keyed by reference', async () => {
    const { ctx } = await mount([
      ok({
        queryUuid: QUERY,
        metricQuery: { filters: { metrics: { id: 'g', or: [
          { id: 'r', target: { fieldRef: 'orders.total' }, operator: 'inBetween', values: [1, { from: 2 }, false] },
        ] } } },
      }),
      wirePage('ready', []),
    ])
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run.filters).toBe('orders.total inBetween 1, false')
  })

  it('cuts a text cell to the bound and says so', async () => {
    const { ctx } = await mount([wireStarted(), wirePage('ready', [wireRow('华'.repeat(10), 1)])], { maxCellChars: 4 })
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run.rows[0]?.[0]).toBe('华华华华')
    expect(run.cellsTruncated).toBe(true)
  })

  it('bounds the rows by the caller and by this deployment, and reports the rows the source had', async () => {
    const { ctx, calls } = await mount([
      wireStarted(),
      wirePage('ready', [wireRow('华东', 1), wireRow('华北', 2), wireRow('华南', 3)], { totalResults: 90 }),
    ], { maxRows: 2 })
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(calls[1]?.url).toContain('pageSize=2')
    expect(run.rows).toHaveLength(2)
    expect(run).toMatchObject({ rowCount: 90, truncated: true })
  })

  it('reports truncation from the page alone when the source reports no total', async () => {
    const { ctx } = await mount([
      wireStarted(),
      wirePage('ready', [wireRow('华东', 1), wireRow('华北', 2)], { totalResults: undefined }),
    ], { maxRows: 1 })
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 })
    expect(run).toMatchObject({ rowCount: undefined, truncated: true })
  })

  it('reports a run the warehouse failed, and one the source cancelled, as the query failing', async () => {
    const failed = await mount([wireStarted(), wirePage('error', [], { error: 'relation "orders" does not exist' })])
    await expect(failed.ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 }))
      .rejects.toMatchObject({ reason: 'query-failed' })
    vi.unstubAllGlobals()
    const cancelled = await mount([wireStarted(), wirePage('cancelled')])
    await expect(cancelled.ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 }))
      .rejects.toMatchObject({ reason: 'query-failed' })
  })

  it('reports a chart the source will not start as unavailable', async () => {
    const { ctx } = await mount([fail(404)], {}, 404)
    await expect(ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 }))
      .rejects.toMatchObject({ reason: 'chart-unavailable' })
  })

  it.each([
    ['a start with no run id', [ok({ cacheMetadata: {} })]],
    ['a page with no status', [wireStarted(), ok({ queryUuid: QUERY })]],
    ['a ready page with no rows', [wireStarted(), ok({ status: 'ready', queryUuid: QUERY })]],
    ['a row that is not an object', [wireStarted(), wirePage('ready', ['x'])]],
  ])('refuses %s as unreadable', async (_label, bodies) => {
    const { ctx } = await mount(bodies)
    await expect(ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 }))
      .rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('gives up on a run that never becomes ready, stopping it upstream', async () => {
    const { ctx, calls } = await mount([wireStarted(), wirePage('pending')], { queryTimeoutMs: 1, pollIntervalMs: 1 })
    await expect(ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20 }))
      .rejects.toMatchObject({ reason: 'upstream-unavailable' })
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: `http://127.0.0.1:8100${queryCancelPath(PROJECT, QUERY)}` })
  })

  it('stops waiting when the caller does, and stops the run upstream even when the source refuses', async () => {
    const controller = new AbortController()
    const upstream = fakeUpstream([wireStarted(), wirePage('pending')])
    let reads = 0
    const gated: typeof globalThis.fetch = (input, init) => {
      reads += 1
      // The second results read never comes back ready; the caller gives up
      // while the provider is between reads, which is where a poll waits.
      if (reads === 3) {
        controller.abort()
        return Promise.reject(new Error('refused'))
      }
      return upstream.fetch(input, init)
    }
    vi.stubGlobal('fetch', gated)
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx, { pollIntervalMs: 1_000, queryTimeoutMs: 60_000 })
    setTimeout(() => { controller.abort() }, 5)
    await expect(ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20, signal: controller.signal }))
      .rejects.toMatchObject({ reason: 'cancelled' })
    expect(upstream.calls).toHaveLength(2)
  })
})

describe('one operation has one deadline', () => {
  it('reports a call the caller abandons mid-flight as cancelled, not as the source failing', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', () => {
      controller.abort()
      return Promise.reject(new Error('aborted'))
    })
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx)
    await expect(ctx.biSource.listProjects(controller.signal)).rejects.toMatchObject({ reason: 'cancelled' })
  })

  it('stops a run the caller abandons while its last read was still in flight', async () => {
    const controller = new AbortController()
    const upstream = fakeUpstream([wireStarted(), wirePage('pending'), ok({})])
    let reads = 0
    const gated: typeof globalThis.fetch = (input, init) => {
      reads += 1
      // The results read answers normally, but the caller has stopped waiting
      // by the time it does; the poll must not sleep on their behalf.
      if (reads === 2) controller.abort()
      return upstream.fetch(input, init)
    }
    vi.stubGlobal('fetch', gated)
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx, { pollIntervalMs: 60_000 })
    await expect(ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 20, signal: controller.signal }))
      .rejects.toMatchObject({ reason: 'cancelled' })
    expect(upstream.calls.at(-1)?.url).toBe(`http://127.0.0.1:8100${queryCancelPath(PROJECT, QUERY)}`)
  })

  it('abandons a call the caller aborted before it left', async () => {
    const { ctx, calls } = await mount([ok([])])
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.biSource.listProjects(controller.signal)).rejects.toMatchObject({ reason: 'cancelled' })
    expect(calls).toHaveLength(0)
  })

  it('abandons a call the source leaves hanging past the timeout', async () => {
    vi.stubGlobal('fetch', (_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    }))
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx, { requestTimeoutMs: 5 })
    await expect(ctx.biSource.listProjects()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })
})

describe('failures carry a closed reason and no upstream prose', () => {
  it.each([
    ['a refused credential', 401, 'upstream-unavailable'],
    ['a forbidden token', 403, 'upstream-unavailable'],
    ['a rate limit', 429, 'upstream-unavailable'],
    ['a server failure', 500, 'upstream-unavailable'],
    ['a bad request', 400, 'upstream-invalid'],
    ['a missing route', 404, 'upstream-invalid'],
  ])('maps %s', async (_label, status, reason) => {
    const { ctx } = await mount([fail(status)], {}, status)
    const error = await ctx.biSource.listProjects().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(BiError)
    expect(error).toMatchObject({ reason })
    expect((error as Error).message).not.toMatch(/ECONNREFUSED|10\.0\.0\.4/u)
  })

  it('maps a failure envelope with no status by the response status', async () => {
    const { ctx } = await mount([{ status: 'error' }], {}, 503)
    await expect(ctx.biSource.listProjects()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
  })

  it('refuses a body that is not JSON at all', async () => {
    const { ctx } = await mount(['<html>502 Bad Gateway</html>'], {}, 502)
    await expect(ctx.biSource.listProjects()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })

  it('reports an unreachable source without naming its address', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:8100')))
    const ctx = rootWith({ value: KEY, source: 'env' })
    await load(ctx)
    const error = await ctx.biSource.listProjects().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'upstream-unavailable' })
    expect((error as Error).message).not.toMatch(/127\.0\.0\.1|8100/u)
  })

  it('reports a missing credential as the source being unavailable, without calling it', async () => {
    const upstream = fakeUpstream([ok([])])
    vi.stubGlobal('fetch', upstream.fetch)
    const ctx = rootWith(undefined)
    await load(ctx)
    await expect(ctx.biSource.listProjects()).rejects.toMatchObject({ reason: 'upstream-unavailable' })
    expect(upstream.calls).toHaveLength(0)
  })
})
