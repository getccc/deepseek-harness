/**
 * What leaves a Runner, and what it makes of what comes back.
 *
 * The requests are asserted field by field because the guarantee is an absence:
 * no address, no credential, no upstream id, no filter can be in a body that
 * has no place for one.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BiChartRef, BiError, BiProjectRef } from '@deepseek-ai/dsh-bi'
import {
  BI_CATALOG_PATH,
  BI_CHARTS_PATH,
  BI_PROTOCOL_VERSION,
  BI_QUERY_PATH,
} from '@deepseek-ai/dsh-bi-gateway-http'
import TeamBi from '@deepseek-ai/dsh-bi-team'

let ORIGIN = ''
const REF = 'webi:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'
const CHART = `${REF}/08f25606-8876-49cc-b509-70e84828db08`
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
  await ctx.plugin(TeamBi, { controlPlaneUrl: ORIGIN }).await()
  return ctx
}

/** A well-formed directory answer. */
function directory(): unknown {
  return { entries: [{ ref: REF, displayName: 'Demo YH' }] }
}

/** One chart page as the Control Plane answers it. */
function chartPage(patch: Record<string, unknown> = {}): unknown {
  return {
    ref: REF,
    charts: [{
      chartRef: CHART,
      ref: REF,
      name: '销售总览',
      spaceName: '经营看板',
      description: '按月的销售额与订单数。',
      kind: 'line',
      updatedAt: 1756857600000,
    }],
    page: 1,
    pageSize: 20,
    total: 7,
    ...patch,
  }
}

/** One run answer as the Control Plane answers it. */
function run(patch: Record<string, unknown> = {}): unknown {
  return {
    chartRef: CHART,
    ref: REF,
    name: '销售总览',
    kind: 'line',
    description: '按月的销售额与订单数。',
    fields: [
      { id: 'orders_month', label: '月份', role: 'dimension', type: 'date' },
      { id: 'orders_amount', label: '销售额', role: 'metric', type: 'number' },
    ],
    filters: '订单状态 = 已完成',
    rows: [['2026-01', 1200.5], ['2026-02', 980]],
    rowCount: 2,
    truncated: false,
    cellsTruncated: false,
    ...patch,
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
  it('carries the protocol version, the token, and nothing else for a directory read', async () => {
    controlPlane(200, directory())
    const ctx = await mount()
    await ctx.bi.catalog()
    expect(calls[0]).toMatchObject({
      url: `${ORIGIN}${BI_CATALOG_PATH}`,
      method: 'POST',
      body: { protocolVersion: BI_PROTOCOL_VERSION },
    })
    expect(Object.keys(calls[0]?.body ?? {})).toEqual(['protocolVersion'])
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
  })

  it('names the project, the keyword, and the page for a listing, and no address, credential, or upstream id', async () => {
    controlPlane(200, chartPage())
    const ctx = await mount()
    await ctx.bi.charts({ ref: BiProjectRef(REF), query: '销售', page: 2, pageSize: 5 })
    expect(calls[0]?.url).toBe(`${ORIGIN}${BI_CHARTS_PATH}`)
    expect(calls[0]?.body).toEqual({
      protocolVersion: BI_PROTOCOL_VERSION, ref: REF, query: '销售', page: 2, pageSize: 5,
    })
    const sent = JSON.stringify(calls[0])
    for (const forbidden of ['baseUrl', 'apiKey', 'ApiKey', 'projectUuid', 'upstreamId', 'metricQuery']) {
      expect(sent, forbidden).not.toContain(forbidden)
    }
  })

  it('sends no listing fields the caller left unset, so the deployment decides', async () => {
    controlPlane(200, chartPage())
    const ctx = await mount()
    await ctx.bi.charts({ ref: BiProjectRef(REF) })
    expect(calls[0]?.body).toEqual({ protocolVersion: BI_PROTOCOL_VERSION, ref: REF })
  })

  it('names the chart and the row bound for a run, and nothing about the query itself', async () => {
    controlPlane(200, run())
    const ctx = await mount()
    await ctx.bi.query({ chartRef: BiChartRef(CHART), limit: 50 })
    expect(calls[0]?.url).toBe(`${ORIGIN}${BI_QUERY_PATH}`)
    expect(calls[0]?.body).toEqual({ protocolVersion: BI_PROTOCOL_VERSION, chartRef: CHART, limit: 50 })
  })

  it('leaves an unbounded run unbounded', async () => {
    controlPlane(200, run())
    const ctx = await mount()
    await ctx.bi.query({ chartRef: BiChartRef(CHART) })
    expect(calls[0]?.body).toEqual({ protocolVersion: BI_PROTOCOL_VERSION, chartRef: CHART })
  })

  it('reads the token per operation, so a refresh lands on the next call', async () => {
    controlPlane(200, directory())
    let issued = 0
    const ctx = new Context()
    ctx.provide('teamAccountClient', { accessToken: () => Promise.resolve(`token-${String(++issued)}`) })
    await ctx.plugin(TeamBi, { controlPlaneUrl: ORIGIN }).await()
    await ctx.bi.catalog()
    await ctx.bi.catalog()
    expect(calls.map(call => call.headers['authorization']))
      .toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  it('forwards the caller’s signal', async () => {
    controlPlane(200, directory())
    const ctx = await mount()
    const controller = new AbortController()
    await ctx.bi.catalog(controller.signal)
    // The provider passes the signal straight to fetch; there is no second
    // deadline here, because the Control Plane owns the operation's own bound.
    expect(calls).toHaveLength(1)
  })
})

describe('what it makes of a directory', () => {
  it('reads a directory back', async () => {
    controlPlane(200, directory())
    const ctx = await mount()
    expect(await ctx.bi.catalog()).toEqual([{ ref: REF, displayName: 'Demo YH' }])
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
    await expect(ctx.bi.catalog()).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('what it makes of a chart page', () => {
  it('reads the charts and the total back', async () => {
    controlPlane(200, chartPage())
    const ctx = await mount()
    const page = await ctx.bi.charts({ ref: BiProjectRef(REF) })
    expect(page).toEqual({
      ref: REF,
      charts: [{
        chartRef: CHART,
        ref: REF,
        name: '销售总览',
        spaceName: '经营看板',
        description: '按月的销售额与订单数。',
        kind: 'line',
        updatedAt: 1756857600000,
      }],
      page: 1,
      pageSize: 20,
      total: 7,
    })
  })

  it('reads a chart the answer holds less about, and a kind it does not know, conservatively', async () => {
    controlPlane(200, chartPage({
      charts: [{ chartRef: CHART, ref: REF, kind: 'hologram', updatedAt: 'yesterday' }],
      total: 'many',
    }))
    const ctx = await mount()
    const page = await ctx.bi.charts({ ref: BiProjectRef(REF) })
    expect(page.charts).toEqual([{
      chartRef: CHART, ref: REF, name: '', spaceName: '', description: '', kind: 'other', updatedAt: undefined,
    }])
    // An unreadable total is unknown, never zero.
    expect(page.total).toBeUndefined()
  })

  it.each([
    ['a chart with no reference', { charts: [{ ref: REF }] }],
    ['a chart whose reference is not one', { charts: [{ chartRef: 'nope', ref: REF }] }],
    ['a chart naming a project that is not one', { charts: [{ chartRef: CHART, ref: 'nope' }] }],
    ['a page with no charts list', { charts: 'all of them' }],
    ['a page with no page number', { page: 'first' }],
    ['a page with no page size', { pageSize: null }],
    ['a chart that is not an object', { charts: ['chart-1'] }],
  ])('refuses %s', async (_label, patch) => {
    controlPlane(200, chartPage(patch))
    const ctx = await mount()
    await expect(ctx.bi.charts({ ref: BiProjectRef(REF) })).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('what it makes of a run', () => {
  it('reads the columns and the rows back', async () => {
    controlPlane(200, run())
    const ctx = await mount()
    expect(await ctx.bi.query({ chartRef: BiChartRef(CHART) })).toEqual({
      chartRef: CHART,
      ref: REF,
      name: '销售总览',
      kind: 'line',
      description: '按月的销售额与订单数。',
      fields: [
        { id: 'orders_month', label: '月份', role: 'dimension', type: 'date' },
        { id: 'orders_amount', label: '销售额', role: 'metric', type: 'number' },
      ],
      filters: '订单状态 = 已完成',
      rows: [['2026-01', 1200.5], ['2026-02', 980]],
      rowCount: 2,
      truncated: false,
      cellsTruncated: false,
    })
  })

  it('squares every row to the columns, reading a cell it cannot as empty', async () => {
    controlPlane(200, run({
      fields: [{ id: 'a', role: 'dimension' }, { id: 'b', role: 'anything' }],
      rows: [['x'], ['y', { nested: true }, 'extra'], [true, -0.5]],
      rowCount: -3,
      truncated: 'yes',
    }))
    const ctx = await mount()
    const result = await ctx.bi.query({ chartRef: BiChartRef(CHART) })
    // A field with no label is labelled by its id, and a role that is not
    // `dimension` is a metric: those are the only two roles a chart has.
    expect(result.fields).toEqual([
      { id: 'a', label: 'a', role: 'dimension', type: '' },
      { id: 'b', label: 'b', role: 'metric', type: '' },
    ])
    expect(result.rows).toEqual([['x', null], ['y', null], [true, -0.5]])
    expect(result.rowCount).toBeUndefined()
    // A truncation flag that is not `true` is not a truncation.
    expect(result.truncated).toBe(false)
    expect(result.cellsTruncated).toBe(false)
  })

  it.each([
    ['no project reference', { ref: undefined }],
    ['a project reference that is not one', { ref: 'nope' }],
    ['no fields list', { fields: 'columns' }],
    ['no rows list', { rows: 'data' }],
    ['a field with no id', { fields: [{ label: '月份' }] }],
    ['a field that is not an object', { fields: ['orders_month'] }],
    ['a row that is not a list', { rows: ['2026-01'] }],
  ])('refuses a run answer with %s', async (_label, patch) => {
    controlPlane(200, run(patch))
    const ctx = await mount()
    await expect(ctx.bi.query({ chartRef: BiChartRef(CHART) })).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('failures a member can act on', () => {
  it.each([
    ['not-allowed', 403],
    ['scope-unavailable', 409],
    ['chart-unavailable', 409],
    ['query-failed', 502],
    ['upstream-unavailable', 502],
    ['upstream-invalid', 502],
    ['update-required', 426],
    ['cancelled', 499],
  ] as const)('passes through %s', async (reason, status) => {
    controlPlane(status, { error: 'bi', reason })
    const ctx = await mount()
    const error = await ctx.bi.catalog().catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(BiError)
    expect(error).toMatchObject({ reason })
  })

  it('treats a reason this build does not know as the Control Plane being unreachable', async () => {
    // A Control Plane speaking words this Runner cannot act on is one it cannot
    // act on; inventing a meaning would send a member after the wrong fix.
    controlPlane(403, { error: 'bi', reason: 'quota-exhausted' })
    const ctx = await mount()
    await expect(ctx.bi.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
  })

  it.each([
    ['a refusal with no reason at all', 500, { error: 'internal' }],
    ['a proxy error page', 502, '<html>502 Bad Gateway</html>'],
  ])('answers %s as unreachable', async (_label, status, body) => {
    controlPlane(status, body)
    const ctx = await mount()
    const error = await ctx.bi.catalog().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'control-plane-unreachable' })
    expect(String(error)).not.toMatch(/Bad Gateway/u)
  })

  it('answers a JSON array as unreachable, which is not a Control Plane answer', async () => {
    controlPlane(200, [])
    const ctx = await mount()
    await expect(ctx.bi.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
  })

  it('answers an unreachable network as unreachable, without naming the origin', async () => {
    // The port this server just released: connecting there fails the way a
    // Control Plane that is down does, without waiting on a name to resolve.
    plane.close()
    await once(plane, 'close')
    const ctx = await mount()
    const error = await ctx.bi.catalog().catch((thrown: unknown) => thrown)
    expect(error).toMatchObject({ reason: 'control-plane-unreachable' })
    expect(String(error)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1/u)
  })

  it('answers a computer that is not signed in as unauthenticated, before any request', async () => {
    controlPlane(200, directory())
    const ctx = await mount(new Error('NotBoundError'))
    await expect(ctx.bi.catalog()).rejects.toMatchObject({ reason: 'unauthenticated' })
    expect(calls).toHaveLength(0)
  })
})
