/**
 * How a document is named, dated, and gathered for reading: the pure pieces
 * both panels draw a document card from.
 *
 * Kept apart from the components so the arrangement of a feed can be read and
 * tested without a browser.
 * @module @deepseek-ai/dsh-client-ui-knowledge-panels/documents
 */

import type { KnowledgeChoice, KnowledgeDocumentsView, KnowledgeDocumentView } from '@deepseek-ai/dsh-api-knowledge-controller/types'

/** The most documents the retrieval panel's feed shows before a member searches. */
export const FEED_LIMIT = 30

/** One document in the retrieval panel's feed, with the knowledge base it came from named. */
export interface FeedDocument {
  readonly document: KnowledgeDocumentView
  /** The knowledge base's display name, empty when the directory no longer names it. */
  readonly knowledgeName: string
}

/**
 * What a document card calls a document.
 * @param document - the document as the listing answered it.
 * @returns its title, or its file name when the source holds no title.
 */
export function titleOf(document: KnowledgeDocumentView): string {
  return document.title === '' ? document.fileName : document.title
}

/**
 * The day a document last changed, as the calendar reads it here.
 *
 * Written out from the local parts rather than through `Intl`, so the same
 * timestamp reads the same in both dictionaries and a test can name the day it
 * expects.
 * @param at - epoch milliseconds the source reported.
 * @returns the day as `YYYY-MM-DD`.
 */
export function dayText(at: number): string {
  const when = new Date(at)
  const month = String(when.getMonth() + 1).padStart(2, '0')
  const day = String(when.getDate()).padStart(2, '0')
  return `${String(when.getFullYear())}-${month}-${day}`
}

/**
 * Gather the first page of several knowledge bases into one feed, newest first.
 *
 * Each listing is in its source's own order; across knowledge bases the only
 * order a member can read is time, so the feed sorts by the day each document
 * last changed, with an undated document after every dated one, and keeps the
 * first {@link FEED_LIMIT}.
 * @param pages - one listing answer per knowledge base in scope.
 * @param entries - the authorized directory, for naming each document's knowledge base.
 * @returns the feed, at most {@link FEED_LIMIT} long.
 */
export function feedOf(pages: readonly KnowledgeDocumentsView[], entries: readonly KnowledgeChoice[]): readonly FeedDocument[] {
  const names = new Map(entries.map(entry => [entry.knowledgeRef, entry.displayName]))
  return pages
    .flatMap(page => page.documents.map(document => ({ document, knowledgeName: names.get(page.knowledgeRef) ?? '' })))
    .sort((a, b) => (b.document.updatedAt ?? -Infinity) - (a.document.updatedAt ?? -Infinity))
    .slice(0, FEED_LIMIT)
}
