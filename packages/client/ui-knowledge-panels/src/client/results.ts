/**
 * What a retrieval answer looks like once it is arranged for reading: its
 * passages gathered under the document each came from, its scores written for
 * a member, and the runs of text its query matched.
 *
 * Pure projections over one `KnowledgeSearchView`, so the panel holds no
 * derived state and the arrangement can be read without a browser.
 * @module @deepseek-ai/dsh-client-ui-knowledge-panels/results
 */

import type { KnowledgePassageView, KnowledgeSearchView } from '@deepseek-ai/dsh-api-knowledge-controller/types'

/** One document's passages, in the order the provider ranked them. */
export interface DocumentGroup {
  /** Stable key for a rendered list. */
  readonly key: string
  /** The document's title, empty when the upstream supplies none. */
  readonly title: string
  /** The knowledge base the document is in. */
  readonly knowledgeRef: string
  /** The document itself, absent when the answer named none. */
  readonly docRef?: string
  /** That knowledge base's display name, empty when the answer did not name it. */
  readonly knowledgeName: string
  /** The best score among this document's passages, which is also its position. */
  readonly best: number
  /** The best-ranked passage, which is what a discussion opens with. */
  readonly lead: KnowledgePassageView
  readonly passages: readonly KnowledgePassageView[]
}

/**
 * Gather one answer's passages under their documents.
 *
 * A passage that names its document groups by that reference; one that does
 * not falls back to its title inside its knowledge base, which is as precise
 * as such a passage gets. Groups and passages both keep the order they arrived
 * in, which is the order the provider ranked them; nothing is re-sorted here.
 * @param view - one retrieval answer.
 * @returns the groups, best-ranked first.
 */
export function groupByDocument(view: KnowledgeSearchView): readonly DocumentGroup[] {
  const groups = new Map<string, DocumentGroup & { passages: KnowledgePassageView[] }>()
  for (const passage of view.passages) {
    const key = passage.docRef ?? `${passage.knowledgeRef}\u0000${passage.title}`
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, {
        key,
        title: passage.title,
        knowledgeRef: passage.knowledgeRef,
        ...(passage.docRef === undefined ? {} : { docRef: passage.docRef }),
        knowledgeName: passage.knowledgeName,
        best: passage.score,
        lead: passage,
        passages: [passage],
      })
      continue
    }
    group.passages.push(passage)
  }
  return [...groups.values()]
}

/**
 * Write one score for a member.
 *
 * Two significant figures, because the number is only comparable within one
 * answer: it orders the rows and says how far apart they are, and more digits
 * would suggest a precision that does not survive the next query. Significant
 * figures rather than fixed decimals, because a fused ranking score is a small
 * number — `0.016` and `0.015` must not both read as `0.02`.
 * @param score - the upstream relevance score.
 * @returns the score as displayed text.
 */
export function formatScore(score: number): string {
  return score >= 0.1 || score === 0 ? score.toFixed(2) : score.toPrecision(2)
}

/** One run of passage text, and whether it matched the query. */
export interface TextRun {
  readonly text: string
  readonly match: boolean
}

/**
 * Split passage text into the runs a member's query matched and the rest.
 *
 * The query is read as its whitespace-separated terms, each matched
 * case-insensitively wherever it appears. That is the whole rule: a Chinese
 * query with no spaces is one term and matches only where it appears whole,
 * because splitting it into characters would light up half a passage and say
 * nothing about why it ranked.
 * @param text - the passage text.
 * @param query - the query the answer belongs to.
 * @returns the runs in order; one unmatched run when nothing matched.
 */
export function highlight(text: string, query: string): readonly TextRun[] {
  const terms = [...new Set(query.split(/\s+/u).filter(term => term !== ''))]
  if (terms.length === 0 || text === '') return [{ text, match: false }]
  // Longer terms first, so one term that contains another is matched whole.
  const pattern = new RegExp(`(${terms.sort((a, b) => b.length - a.length).map(escape).join('|')})`, 'giu')
  return text.split(pattern)
    .filter(part => part !== '')
    .map(part => ({ text: part, match: terms.some(term => term.toLowerCase() === part.toLowerCase()) }))
}

/** A term as literal text inside a regular expression. */
function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
