/**
 * Console-menu vocabulary shared by every provider and consumer.
 * @module @deepseek-ai/dsh-team-console-menu/types
 */

import type { OrgId } from '@deepseek-ai/dsh-account-store'
import type { MenuId } from './brand.ts'

/**
 * What one navigation entry is.
 *
 * A `catalog` groups other entries and has nowhere of its own to go. A `menu`
 * is a page: it has an address and names the view that renders it. An `action`
 * is neither — it exists so a control inside a page can name the permission it
 * needs, which is what lets a role be composed from what an administrator can
 * see rather than from permission strings.
 */
export type ConsoleMenuKind = 'catalog' | 'menu' | 'action'

/**
 * Whether an entry is in service. A suspended entry keeps its place in the
 * tree and its children; the console stops offering it.
 */
export type ConsoleMenuStatus = 'active' | 'suspended'

/** One entry of an organization's console navigation. */
export interface ConsoleMenu {
  readonly id: MenuId
  readonly orgId: OrgId
  /** The entry this one sits under, or undefined for a top-level entry. */
  readonly parentId: MenuId | undefined
  /** The words the console shows this entry by. */
  readonly name: string
  /**
   * The copy key a shipped entry is translated through.
   *
   * The console renders in more than one language, and an entry the product
   * ships is the console's own copy rather than an organization's words. An
   * entry an administrator renamed carries none, because their words are not
   * this build's to translate.
   */
  readonly labelKey: string | undefined
  readonly kind: ConsoleMenuKind
  /** Where the console shows this entry; a catalog has nowhere of its own. */
  readonly routePath: string | undefined
  /** The shipped view this entry renders; a catalog renders none. */
  readonly componentPath: string | undefined
  /**
   * The permission this entry needs, as `resourceType|action` from the
   * permission catalog, or undefined for an entry everyone signed in may reach.
   */
  readonly permission: string | undefined
  /** The icon name the console draws, from the set the console ships. */
  readonly icon: string | undefined
  /** Where it sits among its siblings, ascending; ties fall back to creation order. */
  readonly sortOrder: number
  readonly status: ConsoleMenuStatus
  /** Whether the console draws it in the sidebar; a hidden page is still reachable by address. */
  readonly visible: boolean
  /** The shipped entry this row stands for, or undefined when an administrator created it. */
  readonly seedKey: string | undefined
  readonly createdAt: number
}

/** The fields an administrator supplies when creating an entry. */
export interface CreateConsoleMenu {
  readonly orgId: OrgId
  readonly name: string
  readonly kind: ConsoleMenuKind
  readonly parentId?: MenuId
  readonly routePath?: string
  readonly componentPath?: string
  readonly permission?: string
  readonly icon?: string
  readonly sortOrder?: number
  readonly visible?: boolean
}

/**
 * The entry fields an administrator may change.
 *
 * An absent field is left as stored; a field set to `null` is cleared. The
 * parent is not among them: moving a subtree is a different operation from
 * editing an entry, and this store does not offer it.
 */
export interface UpdateConsoleMenu {
  readonly name?: string
  readonly kind?: ConsoleMenuKind
  readonly routePath?: string | null
  readonly componentPath?: string | null
  readonly permission?: string | null
  readonly icon?: string | null
  readonly sortOrder?: number
  readonly status?: ConsoleMenuStatus
  readonly visible?: boolean
}

/**
 * One entry of the navigation this build ships.
 *
 * `key` is what a re-seed matches on, so a deployment that has already renamed
 * or hidden an entry keeps its edit across restarts. `parentKey` names another
 * shipped entry rather than an id, because ids are assigned per organization at
 * seed time.
 */
export interface ShippedConsoleMenu {
  readonly key: string
  readonly parentKey?: string
  readonly name: string
  readonly labelKey: string
  readonly kind: ConsoleMenuKind
  readonly routePath?: string
  readonly componentPath?: string
  readonly permission?: string
  /** Every shipped entry names an icon; only an administrator's own entry may have none. */
  readonly icon: string
  readonly sortOrder: number
}
