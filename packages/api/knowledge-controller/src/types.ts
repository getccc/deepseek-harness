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
