/**
 * Branded account identities: the type and its brand function together, so a
 * consumer imports one name for both. `types.ts` stays types-only and imports
 * these.
 * @module @deepseek-ai/dsh-account-store/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one organization. */
export type OrgId = Branded<'OrgId'>

/** Identifies one member account within an organization. */
export type UserId = Branded<'UserId'>

/**
 * Brand a string as an {@link OrgId}.
 * @param id - the raw organization id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function OrgId(id: string): OrgId {
  return id as OrgId
}

/**
 * Brand a string as a {@link UserId}.
 * @param id - the raw user id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function UserId(id: string): UserId {
  return id as UserId
}

/** Identifies one department inside an organization. */
export type DeptId = Branded<'DeptId'>

/**
 * Brand a string as a {@link DeptId}.
 * @param id - the raw department id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function DeptId(id: string): DeptId {
  return id as DeptId
}
