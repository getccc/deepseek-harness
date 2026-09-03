/**
 * The office-choice projection key other faces read.
 *
 * The key is declared here rather than beside the Host registration because
 * the browser reads it too: a composer chip and a Host fold have to agree on
 * the same projection key and value, and only one of them can import the Host
 * module that registers it.
 * @module @deepseek-ai/dsh-tool-office/types
 */

import type { OfficeChoice } from '@deepseek-ai/dsh-office'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** The office deliverable this conversation should produce, folded from `office/kind`. */
    office: OfficeChoice
  }
  interface SessionProjectionStateMap {
    /** The folded choice, kept whole because the view is the state. */
    office: OfficeChoice
  }
}
