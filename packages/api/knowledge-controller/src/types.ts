/**
 * The Remote boundary types the `knowledge` namespace answers with.
 *
 * They live on their own subpath because a generated Remote face reads its
 * boundary types from a public non-root export, so a browser can import the
 * shapes without importing the Host service that produces them.
 * @module @deepseek-ai/dsh-api-knowledge-controller/types
 */

import type { KnowledgeScope } from '@deepseek-ai/dsh-knowledge'

/** One knowledge base a member may pick, as the picker draws it. */
export interface KnowledgeChoice {
  /** The stable reference the Session records when this one is chosen. */
  readonly knowledgeRef: string
  readonly displayName: string
  readonly description: string
}

/**
 * Whether the source will retrieve from one document right now, as the browser
 * reads it.
 *
 * The same three words the knowledge seam uses, carried as a wire union rather
 * than imported, so the generated Remote face stays readable without the Host
 * types behind it.
 */
export type KnowledgeDocumentStateView = 'ready' | 'processing' | 'unavailable'

/** One document in a knowledge base, as the browser draws it. */
export interface KnowledgeDocumentView {
  /** The reference a later operation names this document by. */
  readonly docRef: string
  /** The knowledge base it belongs to. */
  readonly knowledgeRef: string
  readonly title: string
  /** Empty for a document the source holds no file for. */
  readonly fileName: string
  /** The source's own word for the file kind, empty when it supplies none. */
  readonly fileType: string
  /** Zero when the source supplies no size. */
  readonly byteSize: number
  readonly state: KnowledgeDocumentStateView
  /** Epoch milliseconds; absent when the source supplies no timestamp. */
  readonly updatedAt?: number
}

/** One page of a knowledge base's documents. */
export interface KnowledgeDocumentsView {
  /** The knowledge base listed, echoed so a page reads without its request. */
  readonly knowledgeRef: string
  readonly documents: readonly KnowledgeDocumentView[]
  /** The page returned, counting from one. */
  readonly page: number
  /** The page size actually applied, after the deployment's bounds. */
  readonly pageSize: number
  /**
   * How many documents the knowledge base holds; absent when the source does
   * not say. Absent rather than zero: a total a reader cannot trust must not
   * tell them the list ends where it does not.
   */
  readonly total?: number
}

/** One retrieved passage, as a member-run retrieval draws it. */
export interface KnowledgePassageView {
  /** Which knowledge base produced it. */
  readonly knowledgeRef: string
  /**
   * That knowledge base's display name, resolved against the directory read
   * for the same retrieval, so a row names its source without a second read.
   */
  readonly knowledgeName: string
  /** The source document's title, empty when the upstream supplies none. */
  readonly title: string
  readonly text: string
  /** Whether the text was cut to the provider's per-passage maximum. */
  readonly truncated: boolean
  /** The upstream relevance score, comparable only within one retrieval. */
  readonly score: number
}

/** What one member-run retrieval answers. */
export interface KnowledgeSearchView {
  /** The query as asked, echoed so a result reads without its request. */
  readonly query: string
  /** The knowledge bases actually searched. */
  readonly searched: readonly KnowledgeChoice[]
  /** The passages, in the order the provider ranked them. */
  readonly passages: readonly KnowledgePassageView[]
  /** Whether passages were dropped to reach the requested maximum. */
  readonly truncated: boolean
}

/** What the picker reads when it opens. */
export interface KnowledgeScopeView {
  /** Every knowledge base this member may search right now. */
  readonly choices: readonly KnowledgeChoice[]
  /** The Session's current choice, folded from its log. */
  readonly scope: KnowledgeScope
  /**
   * Selected references the authorized directory no longer holds.
   *
   * Reported rather than dropped: a member whose access changed should be told
   * their choice went stale, not quietly given a smaller one.
   */
  readonly unavailable: readonly string[]
}
