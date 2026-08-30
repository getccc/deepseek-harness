/**
 * Branded quota identities: the type and its brand function together, so a
 * consumer imports one name for both.
 * @module @deepseek-ai/dsh-quota/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Identifies one reservation, and is the key every settlement is idempotent
 * on: a caller that settles twice presents the same id, and the second
 * settlement changes nothing.
 */
export type ReservationId = Branded<'ReservationId'>

/**
 * Brand a string as a {@link ReservationId}.
 * @param id - the raw reservation id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function ReservationId(id: string): ReservationId {
  return id as ReservationId
}
