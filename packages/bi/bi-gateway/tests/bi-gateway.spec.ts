import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ResourceId } from '@deepseek-ai/dsh-access-control'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import { BiProjectRef, projectRefOf, type BiChartPage, type BiProjectEntry, type BiQueryResult } from '@deepseek-ai/dsh-bi'
import {
  BI_CATALOG_RESOURCE,
  BI_QUERY_ACTION,
  BI_RESOURCE_TYPE,
  BiGateway,
  type BiCatalogView,
  type BiPrincipal,
  type GovernedChartsRequest,
  type GovernedQueryRequest,
} from '@deepseek-ai/dsh-bi-gateway'

const REF = BiProjectRef('webi:prod:55d61de1-ed86-4ad4-b96e-205114de5245')

/** The smallest provider that satisfies the seam, for a mount test. */
class StubGateway extends BiGateway {
  enabled = true

  private view(): BiCatalogView {
    return {
      source: {
        sourceCode: 'prod', providerKind: 'stub', health: 'healthy',
        lastAttemptAt: 1, lastSuccessAt: 1, lastFailure: undefined,
      },
      entries: [{
        ref: REF, resourceId: 'r-1' as ResourceId, displayName: 'Demo YH', description: '', projectType: 'DEFAULT',
        warehouseType: 'postgres', adminEnabled: this.enabled, effectiveEnabled: this.enabled, lastDiscoveredAt: 1,
      }],
    }
  }

  sync(): Promise<BiCatalogView> {
    return Promise.resolve(this.view())
  }

  catalogView(): Promise<BiCatalogView> {
    return Promise.resolve(this.view())
  }

  setEnabled(_orgId: OrgId, _ref: BiProjectRef, enabled: boolean): Promise<void> {
    this.enabled = enabled
    return Promise.resolve()
  }

  directory(_principal: BiPrincipal): Promise<readonly BiProjectEntry[]> {
    return Promise.resolve(this.enabled ? [{ ref: REF, displayName: 'Demo YH' }] : [])
  }

  charts(request: GovernedChartsRequest): Promise<BiChartPage> {
    return Promise.resolve({ ref: request.ref, charts: [], page: request.page ?? 1, pageSize: 20, total: 0 })
  }

  query(request: GovernedQueryRequest): Promise<BiQueryResult> {
    return Promise.resolve({
      chartRef: request.chartRef, ref: projectRefOf(request.chartRef), name: '销售总览', kind: 'vertical_bar',
      description: '', fields: [], filters: '', rows: [], rowCount: 0, truncated: false, cellsTruncated: false,
    })
  }
}

describe('the seam', () => {
  it('names the catalog resource, its type, and the one permission it decides', () => {
    expect(BI_CATALOG_RESOURCE).toBe('urn:dsh:admin:bi-catalog')
    expect(BI_RESOURCE_TYPE).toBe('bi_project')
    expect(BI_QUERY_ACTION).toBe('bi.query')
  })

  it('mounts under ctx.biGateway and answers every operation', async () => {
    const ctx = new Context()
    await ctx.plugin(StubGateway)
    const principal: BiPrincipal = { orgId: 'org' as OrgId, principalId: 'alice' as never }
    expect((await ctx.biGateway.sync('org' as OrgId)).entries.map(entry => entry.ref)).toEqual([REF])
    expect((await ctx.biGateway.directory(principal)).map(entry => entry.displayName)).toEqual(['Demo YH'])
    await ctx.biGateway.setEnabled('org' as OrgId, REF, false)
    expect(await ctx.biGateway.directory(principal)).toEqual([])
    expect((await ctx.biGateway.catalogView('org' as OrgId)).entries[0]?.effectiveEnabled).toBe(false)
    const page = await ctx.biGateway.charts({ ...principal, ref: REF })
    expect(page.page).toBe(1)
    const result = await ctx.biGateway.query({ ...principal, chartRef: `${REF}/chart-1` as never })
    expect(result.ref).toBe(REF)
  })
})
