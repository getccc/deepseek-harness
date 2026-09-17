import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  BiSource,
  type UpstreamChartListing,
  type UpstreamChartPlacement,
  type UpstreamChartsRequest,
  type UpstreamProject,
  type UpstreamRun,
  type UpstreamRunRequest,
} from '@deepseek-ai/dsh-bi-source'

const PROJECT = '55d61de1-ed86-4ad4-b96e-205114de5245'
const CHART = 'aa064703-8940-4ada-9ef0-3fff1905faa2'

/** The smallest provider that satisfies the seam, for a mount test. */
class StubSource extends BiSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'prod'

  listProjects(): Promise<readonly UpstreamProject[]> {
    return Promise.resolve([{ upstreamId: PROJECT, name: 'Demo YH', description: '', projectType: 'DEFAULT', warehouseType: 'postgres' }])
  }

  listCharts(request: UpstreamChartsRequest): Promise<UpstreamChartListing> {
    return Promise.resolve({
      charts: request.upstreamId === PROJECT
        ? [{ upstreamChartId: CHART, name: '销售总览', spaceName: '销售分析', description: '', kind: 'vertical_bar', updatedAt: undefined }]
        : [],
      truncated: false,
    })
  }

  describeChart(upstreamChartId: string): Promise<UpstreamChartPlacement> {
    return Promise.resolve({
      upstreamId: PROJECT,
      chart: { upstreamChartId, name: '销售总览', spaceName: '销售分析', description: '', kind: 'vertical_bar', updatedAt: undefined },
    })
  }

  runChart(request: UpstreamRunRequest): Promise<UpstreamRun> {
    return Promise.resolve({
      fields: [{ id: 'orders_region', label: '区域', role: 'dimension', type: 'string' }],
      filters: '',
      rows: [['华东']].slice(0, request.limit),
      rowCount: 1,
      truncated: false,
      cellsTruncated: false,
    })
  }
}

describe('the seam', () => {
  it('mounts under ctx.biSource and answers every operation in upstream terms', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSource)
    expect(ctx.biSource.providerKind).toBe('stub')
    expect(ctx.biSource.sourceCode).toBe('prod')
    const projects = await ctx.biSource.listProjects()
    expect(projects.map(project => project.upstreamId)).toEqual([PROJECT])
    const listing = await ctx.biSource.listCharts({ upstreamId: PROJECT })
    expect(listing.charts.map(chart => chart.upstreamChartId)).toEqual([CHART])
    const placement = await ctx.biSource.describeChart(CHART)
    expect(placement.upstreamId).toBe(PROJECT)
    const run = await ctx.biSource.runChart({ upstreamId: PROJECT, upstreamChartId: CHART, limit: 10 })
    expect(run.rows).toEqual([['华东']])
  })
})
