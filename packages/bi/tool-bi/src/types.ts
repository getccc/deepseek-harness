/**
 * What other faces may know about the Session's BI scope.
 *
 * The projection key is declared here rather than beside the registration
 * because the browser reads it too: a composer control and a Host fold have
 * to agree on the same key and the same value, and only one of them can
 * import the Host module that registers it.
 * @module @deepseek-ai/dsh-tool-bi/types
 */

import type { BiScope } from '@deepseek-ai/dsh-bi'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The BI project this conversation analyzes, folded from `bi/scope`. */
    bi: BiScope
  }
  interface SessionProjectionStateMap {
    /** The folded scope, kept whole because the view is the state. */
    bi: BiScope
  }
}
