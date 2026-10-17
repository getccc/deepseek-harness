/**
 * The provider against a real excel-tools deployment.
 *
 * Gated on `EXCEL_TOOLS_BASE_URL` and `EXCEL_TOOLS_TOKEN`, and self-skipping
 * without them, so a keyless run stays green; with them it proves the routes
 * the unit fixtures pin are the routes the deployment serves. It reads what
 * the deployment already holds and writes nothing. The token is a gateway
 * token created on the deployment's 管理 → 对话网关 page.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { UpstreamResult } from '@deepseek-ai/dsh-gmo-source'
import ExcelToolsGmoSource from '@deepseek-ai/dsh-gmo-excel-tools'

const BASE_URL = process.env['EXCEL_TOOLS_BASE_URL']
const TOKEN = process.env['EXCEL_TOOLS_TOKEN']
/** The category the deployment is known to hold results in; override for another deployment. */
const CATEGORY = process.env['EXCEL_TOOLS_E2E_CATEGORY'] ?? 'gb'

describe.skipIf(BASE_URL === undefined || TOKEN === undefined)('excel-tools, live', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = new Context()
    // The credential service is stood in for by the environment: what is under
    // test is the provider's reading of the deployment, not credential storage.
    ctx.provide('credentials', { resolve: () => Promise.resolve({ value: TOKEN ?? '', source: 'env' }) })
    await ctx.plugin(ExcelToolsGmoSource, {
      sourceCode: 'e2e',
      baseUrl: BASE_URL ?? '',
      credentialRef: 'EXCEL_TOOLS_TOKEN',
      maxItems: 20,
    }).await()
  })

  afterEach(async () => { await ctx.fiber.dispose() })

  /** The newest result of the known category. */
  async function newest(): Promise<UpstreamResult> {
    const listing = await ctx.gmoSource.listResults({ upstreamId: CATEGORY, page: 1, pageSize: 5 })
    const first = listing.results[0]
    if (first === undefined) throw new Error(`the deployment holds no result in category ${CATEGORY}`)
    return first
  }

  it('lists the known category with a name and keys a reference can carry', async () => {
    const categories = await ctx.gmoSource.listCategories()
    const found = categories.find(category => category.upstreamId === CATEGORY)
    expect(found?.name).not.toBe('')
    expect(categories.every(category => /^[A-Za-z0-9._@-]+$/u.test(category.upstreamId))).toBe(true)
  })

  it('lists results newest first with ids in the reference alphabet, steps spelled with a dot', async () => {
    const listing = await ctx.gmoSource.listResults({ upstreamId: CATEGORY, page: 1, pageSize: 5 })
    expect(listing.total).toBeGreaterThan(0)
    expect(listing.results.length).toBeLessThanOrEqual(5)
    for (const result of listing.results) {
      expect(result.upstreamResultId).toMatch(/^[0-9a-f]{32}$/u)
      for (const stage of result.stages) expect(stage.upstreamResultId).toMatch(/^[0-9a-f]{32}(?:\.[a-z0-9-]+)?$/u)
    }
  })

  it('places a result in its category and describes it with column meanings and the rules', async () => {
    const result = await newest()
    expect(await ctx.gmoSource.placeResult(result.upstreamResultId)).toEqual({ upstreamId: CATEGORY })
    const described = await ctx.gmoSource.describeResult(result.upstreamResultId)
    expect(described.upstreamId).toBe(CATEGORY)
    expect(described.fields.length).toBeGreaterThan(0)
    expect(described.fields.some(field => field.description !== '')).toBe(true)
    expect(described.today).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    expect(described.glossary).not.toBe('')
  })

  it('answers an aggregation whose groups add up to its total', async () => {
    const result = await newest()
    // Any column the result lets a question filter by also groups, so the run does not depend on one tool's column names.
    const described = await ctx.gmoSource.describeResult(result.upstreamResultId)
    const column = described.fields.find(field => field.type === 'string' && field.filter !== '')
    if (column === undefined) throw new Error(`result ${result.name} has no string column to group by`)
    const answer = await ctx.gmoSource.ask({
      upstreamId: CATEGORY,
      upstreamResultId: result.upstreamResultId,
      query: { kind: 'aggregate', metric: 'count', groupBy: [column.key], limit: 200 },
    })
    expect(answer.upstreamId).toBe(CATEGORY)
    const groups = answer.data['data']
    expect(Array.isArray(groups)).toBe(true)
    if (Array.isArray(groups) && answer.data['truncated'] === false) {
      let sum = 0
      for (const group of groups) {
        if (typeof group === 'object' && group !== null && !Array.isArray(group) && typeof group['value'] === 'number') sum += group['value']
      }
      expect(sum).toBe(Number(answer.data['total']))
    }
  })

  it('reports a result the deployment does not hold as unavailable', async () => {
    await expect(ctx.gmoSource.placeResult('0'.repeat(32))).rejects.toMatchObject({ reason: 'result-unavailable' })
  })

  it('refuses a column the result does not have as an invalid question', async () => {
    const result = await newest()
    await expect(ctx.gmoSource.ask({
      upstreamId: CATEGORY,
      upstreamResultId: result.upstreamResultId,
      query: { kind: 'aggregate', metric: 'sum', groupBy: ['no_such_column'] },
    })).rejects.toMatchObject({ reason: 'invalid-query' })
  })

  it('answers a view a result lacks as unsupported', async () => {
    const result = await newest()
    const dashboard = (await ctx.gmoSource.describeResult(result.upstreamResultId)).dashboard
    // Pick a view this result lacks: the deployment's newest result decides which, and one that has every view has nothing to assert.
    const widget = dashboard === undefined ? 'kpi' : !dashboard.structure ? 'structure' : !dashboard.balance ? 'balance' : undefined
    if (widget === undefined) return
    await expect(ctx.gmoSource.ask({
      upstreamId: CATEGORY,
      upstreamResultId: result.upstreamResultId,
      query: { kind: 'overview', widget },
    })).rejects.toMatchObject({ reason: 'unsupported' })
  })
})
