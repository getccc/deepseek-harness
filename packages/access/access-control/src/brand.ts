/**
 * Branded access-control identities: the types and their brand functions
 * together, so a consumer imports one name for both.
 * @module @deepseek-ai/dsh-access-control/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one role. */
export type RoleId = Branded<'RoleId'>
/** Identifies one user group. */
export type GroupId = Branded<'GroupId'>
/** Identifies one governed resource in the catalog. */
export type ResourceId = Branded<'ResourceId'>
/** Identifies one grant, so a decision can name what admitted it. */
export type GrantId = Branded<'GrantId'>

/**
 * Brand a string as a {@link RoleId}.
 * @param id - the raw role id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function RoleId(id: string): RoleId {
  return id as RoleId
}

/**
 * Brand a string as a {@link GroupId}.
 * @param id - the raw group id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function GroupId(id: string): GroupId {
  return id as GroupId
}

/**
 * Brand a string as a {@link ResourceId}.
 * @param id - the raw resource id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function ResourceId(id: string): ResourceId {
  return id as ResourceId
}

/**
 * Brand a string as a {@link GrantId}.
 * @param id - the raw grant id.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function GrantId(id: string): GrantId {
  return id as GrantId
}
