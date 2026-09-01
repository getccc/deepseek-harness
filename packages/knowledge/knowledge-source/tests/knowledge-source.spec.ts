/**
 * The upstream seam is an interface plus two guarantees a provider owes the
 * gateway: it says which product and source it speaks for, and it never
 * decides who may search.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  KnowledgeSource,
  type UpstreamKnowledgeBase,
  type UpstreamPassage,
  type UpstreamSearchRequest,
} from '@deepseek-ai/dsh-knowledge-source'

/** The smallest provider that satisfies the seam. */
class StubSource extends KnowledgeSource {
  override readonly providerKind = 'stub'
  override readonly sourceCode = 'prod'

  list(): Promise<readonly UpstreamKnowledgeBase[]> {
    return Promise.resolve([{
      upstreamId: 'kb-1',
      name: '临港知识库',
      description: '',
      kind: 'document',
      documentCount: 1,
      chunkCount: 4,
      processingCount: 0,
      embeddingModelId: 'emb-1',
      updatedAt: undefined,
    }])
  }

  search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]> {
    return Promise.resolve(request.upstreamIds.map(upstreamId => ({
      upstreamId,
      title: '运维手册',
      text: request.query,
      truncated: false,
      score: 1,
    })))
  }
}

describe('the upstream seam', () => {
  it('mounts under ctx.knowledgeSource and names the reference segments it owns', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSource)
    expect(ctx.knowledgeSource.providerKind).toBe('stub')
    expect(ctx.knowledgeSource.sourceCode).toBe('prod')
  })

  it('answers in upstream terms, leaving the mapping to the catalog', async () => {
    const ctx = new Context()
    await ctx.plugin(StubSource)
    const [base] = await ctx.knowledgeSource.list()
    // An upstream id, not a KnowledgeRef: a provider that minted governed
    // identities would be deciding what the catalog governs.
    expect(base?.upstreamId).toBe('kb-1')
    expect(base?.embeddingModelId).toBe('emb-1')
    const passages = await ctx.knowledgeSource.search({
      upstreamIds: ['kb-1', 'kb-2'], query: '年假', maxResults: 5,
    })
    expect(passages.map(passage => passage.upstreamId)).toEqual(['kb-1', 'kb-2'])
  })
})
