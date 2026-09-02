/**
 * What the console knows about its own navigation.
 *
 * The tree itself is stored data an administrator edits. What this build fixes
 * is the two vocabularies a stored entry can point into: the page components it
 * ships, and the icons it can draw. An entry naming something outside them is
 * not an error the server can catch — it is a page this build does not have —
 * so the console says so in place of the page rather than rendering nothing.
 */

import type { WireMenu } from './api.ts'
import { isCopyKey, type CopyKey } from './locales.ts'

/** The page components this build ships, as a stored entry names them. */
export const CONSOLE_COMPONENTS = [
  'dashboard/OverviewPage',
  'system/DepartmentsPage',
  'system/UsersPage',
  'system/RolesPage',
  'system/MenusPage',
  'resources/ModelsPage',
  'resources/KnowledgeBasesPage',
] as const

/** One page component this build ships. */
export type ConsoleComponent = typeof CONSOLE_COMPONENTS[number]

/** The icons this build draws, as a stored entry names them. */
export const MENU_ICONS = [
  'dashboard', 'setting', 'bank', 'team', 'safety', 'menu', 'appstore', 'laptop', 'api', 'read',
] as const

/** One icon this build draws. */
export type MenuIcon = typeof MENU_ICONS[number]

/**
 * The words to show one navigation entry by.
 *
 * An entry the product ships carries the console's own copy key and is
 * translated; an entry an administrator named carries their words, which are
 * not this build's to translate. A shipped key this build no longer has falls
 * back to the stored words rather than rendering blank.
 * @param menu - the entry to label.
 * @param t - the current language's copy reader.
 * @returns the label to draw.
 */
export function menuLabel(menu: WireMenu, t: (key: CopyKey) => string): string {
  return menu.labelKey !== undefined && isCopyKey(menu.labelKey) ? t(menu.labelKey) : menu.name
}

/**
 * The entries this member can actually open.
 *
 * Three things hide an entry: an administrator suspended it, an administrator
 * hid it, or it declares a permission this member does not hold. None of them
 * is what enforces anything — every page asks the Control Plane again — they
 * decide what is worth offering.
 * @param menus - the organization's navigation.
 * @param held - the `resourceType|action` pairs this member holds.
 * @returns the entries to draw, in the order they arrived.
 */
export function reachableMenus(
  menus: readonly WireMenu[],
  held: ReadonlySet<string>,
): WireMenu[] {
  const offered = menus.filter(menu =>
    menu.status === 'active'
    && menu.visible
    && menu.kind !== 'action'
    && (menu.permission === undefined || held.has(menu.permission)))
  // A group with nothing left under it is an empty heading, and an entry whose
  // group was filtered out would otherwise disappear with it.
  const withChildren = new Set(offered.flatMap(menu => menu.parentId === undefined ? [] : [menu.parentId]))
  return offered.filter(menu => menu.kind !== 'catalog' || withChildren.has(menu.id))
}
