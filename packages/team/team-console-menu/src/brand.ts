/**
 * The branded console-menu identity: the type and its brand function together,
 * so a consumer imports one name for both. `types.ts` stays types-only and
 * imports these.
 * @module @deepseek-ai/dsh-team-console-menu/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one entry of one organization's console navigation. */
export type MenuId = Branded<'MenuId'>

/**
 * Brand a string as a {@link MenuId}.
 * @param id - the raw menu id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function MenuId(id: string): MenuId {
  return id as MenuId
}
