/**
 * The provider against a real webi deployment.
 *
 * Gated on `WEBI_BASE_URL` and `WEBI_API_KEY`, and self-skipping without
 * them, so a keyless run stays green; with them it proves the four routes the
 * unit fixtures pin are the routes the deployment serves. It reads and runs
 * what the deployment already holds and writes nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { UpstreamProject } from '@deepseek-ai/dsh-bi-source'
import WebiBiSource from '@deepseek-ai/dsh-bi-webi'

const BASE_URL = process.env['WEBI_BASE_URL']
const API_KEY = process.env['WEBI_API_KEY']
/** The project and chart the deployment is known to hold; override for another deployment. */
const PROJECT_NAME = process.env['WEBI_E2E_PROJECT'] ?? 'Demo YH'
const CHART_NAME = process.env['WEBI_E2E_CHART'] ?? '销售总览'

describe.skipIf(BASE_URL === undefined || API_KEY === undefined)('webi, live', () => {
  let ctx: Context

  beforeEach(async () => {
    ctx = new Context()
    // The credential seam is stood in for by the environment: what is under
    // test is the provider's reading of the deployment, not credential storage.
    ctx.provide('credentials', { resolve: () => Promise.resolve({ value: API_KEY ?? '', source: 'env' }) })
    await ctx.plugin(WebiBiSource, {
      sourceCode: 'e2e',
      baseUrl: BASE_URL ?? '',
      credentialRef: 'WEBI_API_KEY',
      maxRows: 5,
      maxCharts: 50,
    }).await()
  })

  afterEach(async () => { await ctx.fiber.dispose() })

  /** The known project, found by name so a fresh uuid does not break the run. */
  async function project(): Promise<UpstreamProject> {
    const projects = await ctx.biSource.listProjects()
    const match = projects.find(entry => entry.name === PROJECT_NAME)
    if (match === undefined) throw new Error(`the deployment lists no project named ${PROJECT_NAME}`)
    return match
  }

  it('lists projects with ids a reference can carry and a warehouse word', async () => {
    const found = await project()
    expect(found.upstreamId).toMatch(/^[0-9a-f-]{36}$/u)
    expect(found.projectType).toBe('DEFAULT')
    expect(found.warehouseType).not.toBe('')
  })

  it('lists a project’s charts with kinds of this build’s vocabulary', async () => {
    const listing = await ctx.biSource.listCharts({ upstreamId: (await project()).upstreamId })
    expect(listing.charts.length).toBeGreaterThan(0)
    // The listing is read one page wide: 50 of the deployment's 88 charts.
    expect(listing.truncated).toBe(true)
    const named = listing.charts.find(chart => chart.name === CHART_NAME)
    expect(named).toMatchObject({ kind: 'vertical_bar', spaceName: '销售分析' })
    expect(named?.updatedAt).toBeTypeOf('number')
  })

  it('places the chart in its project and runs it as it was saved', async () => {
    const owner = await project()
    const listing = await ctx.biSource.listCharts({ upstreamId: owner.upstreamId })
    const named = listing.charts.find(chart => chart.name === CHART_NAME)
    if (named === undefined) throw new Error(`the project lists no chart named ${CHART_NAME}`)
    const placement = await ctx.biSource.describeChart(named.upstreamChartId)
    expect(placement.upstreamId).toBe(owner.upstreamId)
    expect(placement.chart).toMatchObject({ name: CHART_NAME, kind: 'vertical_bar' })
    const run = await ctx.biSource.runChart({ upstreamId: owner.upstreamId, upstreamChartId: named.upstreamChartId, limit: 3 })
    expect(run.fields[0]?.role).toBe('dimension')
    expect(run.fields.some(field => field.role === 'metric')).toBe(true)
    expect(run.rows).toHaveLength(3)
    expect(run.rows[0]).toHaveLength(run.fields.length)
    expect(run.rowCount).toBeGreaterThan(3)
    expect(run.truncated).toBe(true)
  })

  it('reports a chart the deployment does not hold as unavailable', async () => {
    await expect(ctx.biSource.describeChart('00000000-0000-4000-8000-000000000000'))
      .rejects.toMatchObject({ reason: 'chart-unavailable' })
  })
})
