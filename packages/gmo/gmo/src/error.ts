/**
 * The one way a GMO operation reports that it did not succeed.
 * @module @deepseek-ai/dsh-gmo/error
 */

import type { GmoFailureReason } from './types.ts'

/**
 * A GMO operation that did not succeed, carrying one closed reason.
 *
 * The message is for a developer reading a log. Product surfaces read
 * {@link GmoError.reason} and supply their own localized text, and no upstream
 * response body ever reaches either.
 */
export class GmoError extends Error {
  constructor(readonly reason: GmoFailureReason, detail?: string) {
    super(detail === undefined ? reason : `${reason}: ${detail}`)
    this.name = 'GmoError'
  }
}
