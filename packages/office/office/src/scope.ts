/**
 * The Session office choice: its log event, the fold that recovers it, and the
 * validator that reads one back off a wire.
 *
 * The choice reaches the model as a prompt section naming the document kind to
 * produce, so it lives in the Session log and nowhere else. Resume, fork, and
 * rewind therefore recover it by replaying, and no second store can disagree.
 * @module @deepseek-ai/dsh-office/scope
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { isOfficeKind, type OfficeChoice, type OfficeKind } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Which office deliverable this Session should produce from this point on:
     * whole-value replace, last one wins, and a log with none folds to `none`
     * through {@link foldOfficeChoice}.
     *
     * Model-visible: the folded value decides the `office:kind` prompt section,
     * so it is recorded here rather than resolved at assembly time.
     */
    'office/kind': OfficeChoice
  }
}

/** The choice a Session holds before anyone picks one. */
export const DEFAULT_OFFICE_CHOICE: OfficeChoice = { version: 1, kind: 'none' }

/**
 * Recover the Session's current office choice from its log.
 * @param events - the Session's committed events, in order.
 * @param end - fold only the first `end` events, for rewind and fork reads.
 * @returns the last recorded choice, or {@link DEFAULT_OFFICE_CHOICE} when the log records none.
 */
export function foldOfficeChoice(events: readonly SessionEvent[], end = events.length): OfficeChoice {
  let choice: OfficeChoice = DEFAULT_OFFICE_CHOICE
  let index = 0
  for (const event of events) {
    if (index >= end) break
    index++
    if (event.type === 'office/kind') choice = event.data
  }
  return choice
}

/**
 * Read an office choice that arrived from a wire, a client, or a stored log.
 * @param value - the candidate choice.
 * @returns the validated choice, or undefined when the value is not one this build accepts.
 */
export function parseOfficeChoice(value: unknown): OfficeChoice | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['version'] !== 1) return undefined
  const kind = record['kind']
  if (kind === 'none') return { version: 1, kind: 'none' }
  return isOfficeKind(kind) ? { version: 1, kind: kind as OfficeKind } : undefined
}
