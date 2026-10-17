import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  GmoSource,
  type UpstreamAnswer,
  type UpstreamAskRequest,
  type UpstreamCategory,
  type UpstreamDescription,
  type UpstreamPlacement,
  type UpstreamResultListing,
  type UpstreamResultsRequest,
} from '@deepseek-ai/dsh-gmo-source'

const RESULT = '09032da5fb1e43968cb0d3ef422f90e2'

/** The smallest provider that satisfies the seam, for a mount test. */
class StubSource extends GmoSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'gmo'

  listCategories(): Promise<readonly UpstreamCategory[]> {
    return Promise.resolve([{ upstreamId: 'gb', name: 'GB / GL 分配', resultCount: 1 }])
  }

  listResults(request: UpstreamResultsRequest): Promise<UpstreamResultListing> {
    return Promise.resolve({
      results: request.upstreamId === 'gb'
        ? [{
          upstreamResultId: RESULT, name: '一键分配', toolName: 'GB / GL 一键分配', period: '2026-W42', rows: 3,
          createdAt: '2026-10-16T14:50', stages: [],
        }]
        : [],
      pageSize: request.pageSize,
      total: 1,
    })
  }

  placeResult(): Promise<UpstreamPlacement> {
    return Promise.resolve({ upstreamId: 'gb' })
  }

  describeResult(upstreamResultId: string): Promise<UpstreamDescription> {
    return Promise.resolve({
      upstreamId: 'gb', upstreamResultId, categoryLabel: 'GB / GL 分配', name: '一键分配', toolName: 'GB / GL 一键分配',
      period: '2026-W42', rows: 3, createdAt: '2026-10-16T14:50', today: '2026-10-16', weekStart: '2026-10-12',
      stages: [], fields: [], sources: [], glossary: '',
    })
  }

  ask(request: UpstreamAskRequest): Promise<UpstreamAnswer> {
    return Promise.resolve({ upstreamId: request.upstreamId, data: { kind: request.query.kind, total: 117 } })
  }
}

describe('the seam', () => {
  it('mounts under ctx.gmoSource and answers every operation in upstream terms', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSource)
    expect(ctx.gmoSource.providerKind).toBe('stub')
    expect(ctx.gmoSource.sourceCode).toBe('gmo')
    expect((await ctx.gmoSource.listCategories()).map(category => category.upstreamId)).toEqual(['gb'])
    const listing = await ctx.gmoSource.listResults({ upstreamId: 'gb', page: 1, pageSize: 20 })
    expect(listing.results.map(result => result.upstreamResultId)).toEqual([RESULT])
    expect(await ctx.gmoSource.placeResult(RESULT)).toEqual({ upstreamId: 'gb' })
    expect((await ctx.gmoSource.describeResult(RESULT)).upstreamId).toBe('gb')
    const answer = await ctx.gmoSource.ask({ upstreamId: 'gb', upstreamResultId: RESULT, query: { kind: 'aggregate', metric: 'sum' } })
    expect(answer.data).toEqual({ kind: 'aggregate', total: 117 })
  })
})
