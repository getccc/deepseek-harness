/**
 * The governed seam is an interface plus the two constants a Control Plane
 * composition and an administration route both have to agree on.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ResourceId } from '@deepseek-ai/dsh-access-control'
import { OrgId } from '@deepseek-ai/dsh-account-store'
import { KnowledgeRef, type KnowledgeBaseEntry, type KnowledgeSearchResult } from '@deepseek-ai/dsh-knowledge'
import {
  KNOWLEDGE_CATALOG_RESOURCE,
  KNOWLEDGE_RESOURCE_TYPE,
  KnowledgeGateway,
  type GovernedSearchRequest,
  type KnowledgeCatalogView,
} from '@deepseek-ai/dsh-knowledge-gateway'

const REF = KnowledgeRef('stub:prod:kb-1')

/** The smallest gateway that satisfies the seam. */
class StubGateway extends KnowledgeGateway {
  sync(): Promise<KnowledgeCatalogView> {
    return this.catalogView()
  }

  catalogView(): Promise<KnowledgeCatalogView> {
    return Promise.resolve({
      source: {
        sourceCode: 'prod',
        providerKind: 'stub',
        health: 'healthy',
        lastAttemptAt: 1,
        lastSuccessAt: 1,
        lastFailure: undefined,
      },
      entries: [{
        ref: REF,
        resourceId: ResourceId('res-1'),
        displayName: '临港知识库',
        description: '',
        kind: 'document',
        documentCount: 1,
        chunkCount: 0,
        processingCount: 0,
        embeddingModelId: 'emb-1',
        adminEnabled: true,
        remotePresent: true,
        effectiveEnabled: true,
        lastDiscoveredAt: 1,
        upstreamUpdatedAt: undefined,
      }],
    })
  }

  setEnabled(): Promise<void> {
    return Promise.resolve()
  }

  directory(): Promise<readonly KnowledgeBaseEntry[]> {
    return Promise.resolve([{ ref: REF, displayName: '临港知识库', description: '', kind: 'document' }])
  }

  search(request: GovernedSearchRequest): Promise<KnowledgeSearchResult> {
    return Promise.resolve({ query: request.query, searched: [], passages: [], truncated: false })
  }
}

describe('the governed seam', () => {
  it('governs the catalog and each knowledge base as the same resource type', () => {
    // Sharing the type is why every member-facing path enumerates the durable
    // catalog rather than the resources of this type.
    expect(KNOWLEDGE_RESOURCE_TYPE).toBe('knowledge_scope')
    expect(KNOWLEDGE_CATALOG_RESOURCE).toBe('urn:dsh:admin:knowledge-catalog')
  })

  it('mounts under ctx.knowledgeGateway and answers both audiences', async () => {
    const ctx = new Context()
    await ctx.plugin(StubGateway)
    const gateway = ctx.get('knowledgeGateway') as KnowledgeGateway
    const org = OrgId('org-1')
    expect((await gateway.sync(org)).entries.map(entry => entry.ref)).toEqual([REF])
    expect((await gateway.directory({ orgId: org, principalId: 'u' as never })).map(e => e.ref)).toEqual([REF])
    await expect(gateway.setEnabled(org, REF, false)).resolves.toBeUndefined()
    const result = await gateway.search({
      orgId: org, principalId: 'u' as never, scope: { mode: 'all' }, query: '年假',
    })
    expect(result.query).toBe('年假')
  })
})
