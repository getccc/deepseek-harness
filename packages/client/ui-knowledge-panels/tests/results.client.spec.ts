/**
 * How a retrieval answer is arranged for reading.
 *
 * The claim worth testing is that the arrangement adds no opinion: groups and
 * passages keep the order the provider ranked them in, and a score is written
 * without being rescaled.
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgePassageView, KnowledgeSearchView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import { formatScore, groupByDocument } from '../src/client/results.ts'

const REF_A = 'weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'
const REF_B = 'weknora:prod:08f25606-8876-49cc-b509-70e84828db08'

/** One passage as the controller answers it. */
function passage(patch: Partial<KnowledgePassageView> = {}): KnowledgePassageView {
  return {
    knowledgeRef: REF_A,
    knowledgeName: '临港知识库',
    title: '运维手册',
    text: '一级故障 30 分钟内响应。',
    truncated: false,
    score: 0.81,
    ...patch,
  }
}

/** One answer carrying the given passages. */
function view(passages: readonly KnowledgePassageView[]): KnowledgeSearchView {
  return { query: '故障响应', searched: [], passages, truncated: false }
}

describe('grouping an answer by document', () => {
  it('keeps the provider ranking for groups and for passages inside one', () => {
    const groups = groupByDocument(view([
      passage({ score: 0.81 }),
      passage({ title: '值班制度', score: 0.62 }),
      passage({ score: 0.44, text: '二级故障 2 小时内响应。' }),
    ]))
    expect(groups.map(group => [group.title, group.best])).toEqual([['运维手册', 0.81], ['值班制度', 0.62]])
    expect(groups[0]?.passages.map(row => row.score)).toEqual([0.81, 0.44])
  })

  it('separates one title that appears in two knowledge bases', () => {
    const groups = groupByDocument(view([
      passage(),
      passage({ knowledgeRef: REF_B, knowledgeName: '南昌知识库' }),
    ]))
    expect(groups).toHaveLength(2)
    expect(groups.map(group => group.knowledgeName)).toEqual(['临港知识库', '南昌知识库'])
  })

  it('answers nothing for an answer with no passages', () => {
    expect(groupByDocument(view([]))).toEqual([])
  })
})

describe('writing a score', () => {
  it.each([[0.8123, '0.81'], [0.4, '0.40'], [1, '1.00'], [0, '0.00']])('writes %s as %s', (score, text) => {
    expect(formatScore(score)).toBe(text)
  })
})
