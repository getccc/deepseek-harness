/**
 * How a document is named, dated, and gathered into the retrieval panel's
 * feed: pure arrangement, so the claim is about order and what is kept.
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeDocumentView, KnowledgeDocumentsView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import { FEED_LIMIT, dayText, feedOf, titleOf } from '../src/client/documents.ts'

const REF_A = 'weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'
const REF_B = 'weknora:prod:08f25606-8876-49cc-b509-70e84828db08'

/** One document as the controller answers it. */
function document(id: string, patch: Partial<KnowledgeDocumentView> = {}): KnowledgeDocumentView {
  return {
    docRef: `${REF_A}/${id}`,
    knowledgeRef: REF_A,
    title: id,
    description: '',
    fileName: `${id}.pdf`,
    fileType: 'pdf',
    byteSize: 1,
    state: 'ready',
    updatedAt: 1756857600000,
    ...patch,
  }
}

/** One document the source reported no timestamp for: the field absent, not undefined. */
function undated(id: string): KnowledgeDocumentView {
  const { updatedAt: _dropped, ...rest } = document(id)
  return rest
}

/** One listing page. */
function page(knowledgeRef: string, documents: KnowledgeDocumentView[]): KnowledgeDocumentsView {
  return { knowledgeRef, documents, page: 1, pageSize: 20, total: documents.length }
}

describe('naming and dating a document', () => {
  it('uses the file name when the source holds no title', () => {
    expect(titleOf(document('doc-1'))).toBe('doc-1')
    expect(titleOf(document('doc-1', { title: '' }))).toBe('doc-1.pdf')
  })

  it('writes the day from this computer calendar, zero-padded', () => {
    const at = new Date(2026, 0, 5, 12).getTime()
    expect(dayText(at)).toBe('2026-01-05')
  })
})

describe('gathering a feed', () => {
  it('interleaves knowledge bases by the day each document changed, undated last', () => {
    const feed = feedOf([
      page(REF_A, [document('old', { updatedAt: 1 }), undated('undated')]),
      page(REF_B, [document('new', { knowledgeRef: REF_B, updatedAt: 3 }), document('mid', { knowledgeRef: REF_B, updatedAt: 2 })]),
    ], [
      { knowledgeRef: REF_A, displayName: '临港知识库', description: '' },
      { knowledgeRef: REF_B, displayName: '南昌知识库', description: '' },
    ])
    expect(feed.map(item => item.document.title)).toEqual(['new', 'mid', 'old', 'undated'])
    expect(feed.map(item => item.knowledgeName)).toEqual(['南昌知识库', '南昌知识库', '临港知识库', '临港知识库'])
  })

  it('names nothing for a knowledge base the directory no longer holds, and keeps the first ones', () => {
    const many = Array.from({ length: FEED_LIMIT + 5 }, (_value, index) => document(`doc-${String(index)}`, { updatedAt: 1000 - index }))
    const feed = feedOf([page(REF_A, many)], [])
    expect(feed).toHaveLength(FEED_LIMIT)
    expect(feed[0]?.knowledgeName).toBe('')
    expect(feed.at(-1)?.document.title).toBe(`doc-${String(FEED_LIMIT - 1)}`)
  })
})
