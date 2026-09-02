/**
 * What other faces may know about the Session's knowledge scope.
 *
 * The projection key is declared here rather than beside the registration
 * because the browser reads it too: a composer chip and a Host fold have to
 * agree on the same key and the same value, and only one of them can import
 * the Host module that registers it.
 * @module @deepseek-ai/dsh-tool-knowledge/types
 */

import type { KnowledgeScope } from '@deepseek-ai/dsh-knowledge'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The knowledge this conversation may search, folded from `knowledge/scope`. */
    knowledge: KnowledgeScope
  }
  interface SessionProjectionStateMap {
    /** The folded scope, kept whole because the view is the state. */
    knowledge: KnowledgeScope
  }
}
