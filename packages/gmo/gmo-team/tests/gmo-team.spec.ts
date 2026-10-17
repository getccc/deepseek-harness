/**
 * What leaves a Runner, and what it makes of what comes back.
 *
 * The requests are asserted field by field because the guarantee is an absence:
 * no address, no credential, no upstream id, no statement can be in a body that
 * has no place for one.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GmoCategoryRef, GmoResultRef } from '@deepseek-ai/dsh-gmo'
import {
  GMO_ASK_PATH,
  GMO_CATALOG_PATH,
  GMO_DESCRIBE_PATH,
  GMO_PROTOCOL_VERSION,
  GMO_RESULTS_PATH,
} from '@deepseek-ai/dsh-gmo-gateway-http'
import TeamGmo from '@deepseek-ai/dsh-gmo-team'

let ORIGIN = ''
const REF = 'exceltools:gmo:gb'
const RESULT = `${REF}/09032da5fb1e43968cb0d3ef422f90e2`
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
 * the real network.
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
  await ctx.plugin(TeamGmo, { controlPlaneUrl: ORIGIN }).await()
  return ctx
}

/** One result page as the Control Plane answers it. */
function resultPage(patch: Record<string, unknown> = {}): unknown {
  return {
    ref: REF,
    results: [{
      resultRef: RESULT, ref: REF, name: '一键分配', toolName: 'GB / GL 一键分配', period: '2026-W42', rows: 169_187,
      createdAt: '2026-10-16T14:50', stages: [{ key: 'net-gap', label: '3.净缺口', resultRef: `${RESULT}.net-gap` }],
    }],
    page: 1,
    pageSize: 20,
    total: 39,
    ...patch,
  }
}

/** One description as the Control Plane answers it. */
function description(patch: Record<string, unknown> = {}): unknown {
  return {
    resultRef: RESULT, ref: REF, categoryLabel: 'GB / GL 分配', name: '一键分配', toolName: 'GB / GL 一键分配', period: '2026-W42',
    rows: 169_187, createdAt: '2026-10-16T14:50', today: '2026-10-16', weekStart: '2026-10-12',
    stages: [{ key: 'net-gap', label: '3.净缺口', resultRef: `${RESULT}.net-gap` }],
    fields: [{ key: 'remaining_gap', label: '剩余缺口', type: 'number', filter: '', description: '分配之后仍未满足的需求' }],
    dashboard: {
      measure: 'remaining_gap', measureLabel: '剩余缺口', dateFields: [{ key: 'next', label: '下一层需求时间' }],
      dims: { gb_vendor: '来源' }, stackDims: ['gb_vendor'], rankDims: ['pn'], heatDims: ['pn'], flow: ['gb_vendor'],
      subDim: 'brand_l1', balance: false, structure: false,
    },
    sources: [{ name: 'UCT GB', slot: '供应商 GB 需求', rows: 3 }],
    glossary: '# 口径',
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
    controlPlane(200, { entries: [{ ref: REF, displayName: 'GB / GL 分配' }] })
    const ctx = await mount()
    expect(await ctx.gmo.catalog()).toEqual([{ ref: REF, displayName: 'GB / GL 分配' }])
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: `${ORIGIN}${GMO_CATALOG_PATH}`, method: 'POST' })
    expect(calls[0]?.headers['authorization']).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]?.body).toEqual({ protocolVersion: GMO_PROTOCOL_VERSION })
  })

  it('names a category and a page, and no address, key, or upstream id', async () => {
    controlPlane(200, resultPage())
    const ctx = await mount()
    await ctx.gmo.results({ ref: GmoCategoryRef(REF), page: 2, pageSize: 5 })
    expect(calls[0]).toMatchObject({ url: `${ORIGIN}${GMO_RESULTS_PATH}` })
    expect(calls[0]?.body).toEqual({ protocolVersion: GMO_PROTOCOL_VERSION, ref: REF, page: 2, pageSize: 5 })
  })

  it('omits what the caller did not name', async () => {
    controlPlane(200, resultPage())
    const ctx = await mount()
    await ctx.gmo.results({ ref: GmoCategoryRef(REF) })
    expect(calls[0]?.body).toEqual({ protocolVersion: GMO_PROTOCOL_VERSION, ref: REF })
  })

  it('names a result to describe, and nothing else', async () => {
    controlPlane(200, description())
    const ctx = await mount()
    await ctx.gmo.describe({ resultRef: GmoResultRef(RESULT) })
    expect(calls[0]).toMatchObject({ url: `${ORIGIN}${GMO_DESCRIBE_PATH}` })
    expect(calls[0]?.body).toEqual({ protocolVersion: GMO_PROTOCOL_VERSION, resultRef: RESULT })
  })

  it('sends the question as it was asked and no field of its own', async () => {
    controlPlane(200, { resultRef: RESULT, ref: REF, kind: 'aggregate', data: { total: 117 } })
    const ctx = await mount()
    const query = { kind: 'aggregate', metric: 'sum', groupBy: ['gb_vendor'], filters: { multi: { supplier: ['HUNGO'] } } } as const
    await ctx.gmo.ask({ resultRef: GmoResultRef(RESULT), query })
    expect(calls[0]).toMatchObject({ url: `${ORIGIN}${GMO_ASK_PATH}` })
    expect(calls[0]?.body).toEqual({ protocolVersion: GMO_PROTOCOL_VERSION, resultRef: RESULT, query })
  })
})

describe('what this reads back', () => {
  it('reads a result page, each result addressed by reference, with its steps', async () => {
    controlPlane(200, resultPage())
    const page = await (await mount()).gmo.results({ ref: GmoCategoryRef(REF) })
    expect(page).toMatchObject({ ref: REF, page: 1, pageSize: 20, total: 39 })
    expect(page.results[0]).toMatchObject({ resultRef: RESULT, toolName: 'GB / GL 一键分配', rows: 169_187 })
    expect(page.results[0]?.stages).toEqual([{ key: 'net-gap', label: '3.净缺口', resultRef: `${RESULT}.net-gap` }])
  })

  it('reads a description with its field meanings and dashboard', async () => {
    controlPlane(200, description())
    const described = await (await mount()).gmo.describe({ resultRef: GmoResultRef(RESULT) })
    expect(described).toMatchObject({
      resultRef: RESULT, ref: REF, categoryLabel: 'GB / GL 分配', today: '2026-10-16', weekStart: '2026-10-12', glossary: '# 口径',
    })
    expect(described.fields).toEqual([{ key: 'remaining_gap', label: '剩余缺口', type: 'number', filter: '', description: '分配之后仍未满足的需求' }])
    expect(described.dashboard).toMatchObject({ measure: 'remaining_gap', measureLabel: '剩余缺口', balance: false, structure: false })
    expect(described.sources).toEqual([{ name: 'UCT GB', slot: '供应商 GB 需求', rows: 3 }])
  })

  it('reads a description without a dashboard as having none', async () => {
    controlPlane(200, description({ dashboard: undefined }))
    expect((await (await mount()).gmo.describe({ resultRef: GmoResultRef(RESULT) })).dashboard).toBeUndefined()
  })

  it('reads figures and text the Control Plane left out as empty rather than refusing the page', async () => {
    controlPlane(200, resultPage({ total: undefined, results: [{ resultRef: RESULT, ref: REF, name: 5, rows: -1 }] }))
    const page = await (await mount()).gmo.results({ ref: GmoCategoryRef(REF) })
    expect(page.total).toBe(0)
    expect(page.results[0]).toMatchObject({ name: '', rows: 0, stages: [] })
  })

  it('reads a sparse description as empty lists and zero rows, naming a column by its key when it has no label', async () => {
    controlPlane(200, description({
      rows: undefined, stages: 'none', sources: undefined, fields: [{ key: 'pn' }],
      dashboard: { dims: 'none', balance: true, structure: true },
    }))
    const described = await (await mount()).gmo.describe({ resultRef: GmoResultRef(RESULT) })
    expect(described).toMatchObject({ rows: 0, stages: [], sources: [] })
    expect(described.fields).toEqual([{ key: 'pn', label: 'pn', type: '', filter: '', description: '' }])
    expect(described.dashboard).toMatchObject({ dims: {}, dateFields: [], balance: true, structure: true })
  })

  it('passes the caller’s abort signal to the request', async () => {
    controlPlane(200, { entries: [] })
    expect(await (await mount()).gmo.catalog(new AbortController().signal)).toEqual([])
  })

  it('reads an answer, keeping the figures the Control Plane forwarded', async () => {
    controlPlane(200, { resultRef: RESULT, ref: REF, kind: 'aggregate', data: { total: 117, data: [{ group: { gb_vendor: 'AMEC WO' }, value: 101 }] } })
    const answer = await (await mount()).gmo.ask({ resultRef: GmoResultRef(RESULT), query: { kind: 'aggregate', metric: 'sum' } })
    expect(answer).toEqual({
      resultRef: RESULT, ref: REF, kind: 'aggregate', data: { total: 117, data: [{ group: { gb_vendor: 'AMEC WO' }, value: 101 }] },
    })
  })

  it.each([
    ['a directory that is not a list', GMO_CATALOG_PATH, { entries: 'x' }],
    ['a directory entry with no reference', GMO_CATALOG_PATH, { entries: [{ displayName: 'x' }] }],
    ['a result page with no list', GMO_RESULTS_PATH, { page: 1, pageSize: 1 }],
    ['a result with a reference that is not one', GMO_RESULTS_PATH, resultPage({ results: [{ resultRef: 'nope', ref: REF }] })],
    ['a description with no category', GMO_DESCRIBE_PATH, description({ ref: undefined })],
    ['a step with no reference', GMO_DESCRIBE_PATH, description({ stages: [{ key: 'net-gap', label: 'x' }] })],
    ['a column that is not an object', GMO_DESCRIBE_PATH, description({ fields: ['remaining_gap'] })],
    ['a field with no key', GMO_DESCRIBE_PATH, description({ fields: [{ label: 'x' }] })],
    ['an answer with no data', GMO_ASK_PATH, { resultRef: RESULT, ref: REF, kind: 'aggregate' }],
    ['an answer with a category that is not one', GMO_ASK_PATH, { resultRef: RESULT, ref: 'nope', kind: 'aggregate', data: {} }],
  ])('refuses %s as unreadable', async (_label, path, body) => {
    controlPlane(200, body)
    const gmo = (await mount()).gmo
    const attempt = path === GMO_CATALOG_PATH
      ? gmo.catalog()
      : path === GMO_RESULTS_PATH
        ? gmo.results({ ref: GmoCategoryRef(REF) })
        : path === GMO_DESCRIBE_PATH
          ? gmo.describe({ resultRef: GmoResultRef(RESULT) })
          : gmo.ask({ resultRef: GmoResultRef(RESULT), query: { kind: 'rows' } })
    await expect(attempt).rejects.toMatchObject({ reason: 'upstream-invalid' })
  })
})

describe('refusals', () => {
  it.each([
    ['unauthenticated'], ['not-allowed'], ['result-unavailable'], ['unsupported'], ['invalid-query'], ['too-large'],
    ['upstream-unavailable'], ['upstream-invalid'], ['scope-unavailable'], ['update-required'], ['cancelled'],
  ])('carries the %s reason through unchanged', async (reason) => {
    controlPlane(409, { error: 'gmo', reason })
    await expect((await mount()).gmo.catalog()).rejects.toMatchObject({ reason })
  })

  it('reads a reason this build does not know as the Control Plane being unreachable', async () => {
    controlPlane(418, { error: 'gmo', reason: 'a-newer-reason' })
    await expect((await mount()).gmo.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
  })

  it('reads a body that is not JSON, or not an object, as the Control Plane being unreachable', async () => {
    controlPlane(502, '<html>bad gateway</html>')
    await expect((await mount()).gmo.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
    controlPlane(200, '[1]')
    await expect((await mount()).gmo.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
  })

  it('reads a Control Plane that is down as unreachable', async () => {
    const ctx = await mount()
    plane.close()
    await once(plane, 'close')
    await expect(ctx.gmo.catalog()).rejects.toMatchObject({ reason: 'control-plane-unreachable' })
  })

  it('reports a computer that is not signed in as unauthenticated, sending nothing', async () => {
    controlPlane(200, { entries: [] })
    const ctx = await mount(new Error('not bound'))
    await expect(ctx.gmo.catalog()).rejects.toMatchObject({ reason: 'unauthenticated' })
    expect(calls).toHaveLength(0)
  })
})
