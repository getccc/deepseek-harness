/**
 * The one way a BI operation reports that it did not succeed.
 * @module @deepseek-ai/dsh-bi/error
 */

import type { BiFailureReason } from './types.ts'

/**
 * A BI operation that did not succeed, carrying one closed reason.
 *
 * The message is for a developer reading a log. Product surfaces read
 * {@link BiError.reason} and supply their own localized text, and no upstream
 * response body ever reaches either.
 */
export class BiError extends Error {
  constructor(readonly reason: BiFailureReason, detail?: string) {
    super(detail === undefined ? reason : `${reason}: ${detail}`)
    this.name = 'BiError'
  }
}
