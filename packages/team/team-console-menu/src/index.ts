/**
 * The console-menu seam: the administration console's navigation as durable
 * records an organization owns, behind one backend-neutral service.
 *
 * The tree says what an administrator can reach and which permission each entry
 * needs; it decides nothing. Every request the console makes is authorized
 * again by access control, so an entry that is visible to someone holding
 * nothing is a navigation mistake rather than a way in.
 * @module @deepseek-ai/dsh-team-console-menu
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { isRegisteredPermission } from '@deepseek-ai/dsh-access-control'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import type { MenuId } from './brand.ts'
import type { ConsoleMenu, CreateConsoleMenu, UpdateConsoleMenu } from './types.ts'

export { MenuId } from './brand.ts'
export { HOME_MENU_KEY, SHIPPED_CONSOLE_MENUS } from './catalog.ts'
export type {
  ConsoleMenu,
  ConsoleMenuKind,
  ConsoleMenuStatus,
  CreateConsoleMenu,
  ShippedConsoleMenu,
  UpdateConsoleMenu,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    consoleMenu: ConsoleMenuStore
  }
}

/** Raised when an operation names an entry the store does not hold. */
export class UnknownConsoleMenuError extends Error {
  constructor(readonly menuId: MenuId) {
    super(`unknown console menu ${menuId}`)
    this.name = 'UnknownConsoleMenuError'
  }
}

/**
 * Raised when deleting an entry other entries still sit under.
 *
 * Deleting it anyway would leave a child naming a parent that is gone, which is
 * not a tree that can be read back.
 */
export class ConsoleMenuNotEmptyError extends Error {
  constructor(readonly menuId: MenuId, readonly children: number) {
    super(`console menu ${menuId} still holds ${children} entries`)
    this.name = 'ConsoleMenuNotEmptyError'
  }
}

/**
 * Raised when an entry names a permission the catalog does not govern.
 *
 * An entry may name no permission at all, but one it does name has to exist:
 * a typo would produce navigation nobody can reach and no refusal explains.
 */
export class UnknownMenuPermissionError extends Error {
  constructor(readonly permission: string) {
    super(`no permission ${JSON.stringify(permission)} in the catalog`)
    this.name = 'UnknownMenuPermissionError'
  }
}

/**
 * Whether a string is a `resourceType|action` pair the permission catalog
 * governs.
 *
 * The separator is the first `|`: a resource type never carries one, and this
 * is the same spelling a session's held-permission list uses.
 * @param permission - the candidate pair.
 * @returns true when the catalog registers it.
 */
export function isMenuPermission(permission: string): boolean {
  const separator = permission.indexOf('|')
  return separator > 0
    && isRegisteredPermission(permission.slice(0, separator), permission.slice(separator + 1))
}

/**
 * The console's navigation, as durable records. A provider mounts this service;
 * consumers inject `consoleMenu`.
 */
export abstract class ConsoleMenuStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'consoleMenu')
  }

  /**
   * Put the entries this build ships into an organization that does not have
   * them yet, matching on the shipped key.
   *
   * Idempotent, and never an overwrite: an entry a deployment renamed, hid, or
   * reordered keeps its edit, and one it deleted comes back at its shipped
   * settings on the next start.
   * @param orgId - the organization to seed.
   * @returns how many entries this call inserted.
   */
  abstract seedShipped(orgId: OrgId): Promise<number>

  /**
   * List one organization's navigation, parents before the children that name
   * them, and siblings in `sortOrder` then creation order.
   * @param orgId - the organization to list.
   * @returns every entry the organization holds.
   */
  abstract listMenus(orgId: OrgId): Promise<ConsoleMenu[]>

  /**
   * Read one entry by id.
   * @param id - the entry to read.
   * @returns the entry, or undefined when the store holds none.
   */
  abstract getMenu(id: MenuId): Promise<ConsoleMenu | undefined>

  /**
   * Create one entry.
   * @param input - the entry's organization, name, kind, and optional placement fields.
   * @returns the stored entry.
   * @throws {UnknownMenuPermissionError} when it names a permission the catalog does not govern.
   */
  abstract createMenu(input: CreateConsoleMenu): Promise<ConsoleMenu>

  /**
   * Change an entry's fields, leaving every field the caller did not name as
   * stored. A rename drops the shipped copy key, because the words become the
   * organization's own.
   * @param id - the entry to change.
   * @param changes - the fields to write; `null` clears one, absence leaves it.
   * @throws {UnknownConsoleMenuError} when the store holds no such entry.
   * @throws {UnknownMenuPermissionError} when it names a permission the catalog does not govern.
   */
  abstract updateMenu(id: MenuId, changes: UpdateConsoleMenu): Promise<void>

  /**
   * Delete one entry.
   * @param id - the entry to delete.
   * @throws {UnknownConsoleMenuError} when the store holds no such entry.
   * @throws {ConsoleMenuNotEmptyError} when another entry still sits under it.
   */
  abstract deleteMenu(id: MenuId): Promise<void>
}
