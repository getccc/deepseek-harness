/**
 * The navigation this build ships.
 *
 * An organization starts from this tree and edits it: entries can be renamed,
 * reordered, hidden, suspended, and joined by entries of the organization's
 * own. Seeding matches on `key`, so a restart restores an entry a deployment
 * deleted but never overwrites one it changed.
 *
 * Every `permission` is a pair from the permission catalog. Navigation is what
 * an administrator composes; the permissions it names remain the closed set
 * this build governs, so hiding an entry never invents authority and never
 * removes it either — the API asks access control again for every request.
 * @module @deepseek-ai/dsh-team-console-menu/catalog
 */

import type { ShippedConsoleMenu } from './types.ts'

/** Stable key of the entry every other shipped entry is ordered after. */
export const HOME_MENU_KEY = 'home'

/** Shipped entries removed from the product and retired when an organization is seeded. */
export const RETIRED_SHIPPED_MENU_KEYS: readonly string[] = ['devices']

/** The console's own navigation, in the order it ships. */
export const SHIPPED_CONSOLE_MENUS: readonly ShippedConsoleMenu[] = [
  {
    key: HOME_MENU_KEY,
    name: 'Home',
    labelKey: 'nav.home',
    kind: 'menu',
    routePath: '/',
    componentPath: 'dashboard/OverviewPage',
    permission: 'organization|organization.read',
    icon: 'dashboard',
    sortOrder: 1,
  },
  {
    key: 'system',
    name: 'System management',
    labelKey: 'nav.system',
    kind: 'catalog',
    icon: 'setting',
    sortOrder: 2,
  },
  {
    key: 'departments',
    parentKey: 'system',
    name: 'Departments',
    labelKey: 'nav.departments',
    kind: 'menu',
    routePath: '/system/departments',
    componentPath: 'system/DepartmentsPage',
    permission: 'department|department.read',
    icon: 'bank',
    sortOrder: 1,
  },
  {
    key: 'users',
    parentKey: 'system',
    name: 'Users',
    labelKey: 'nav.users',
    kind: 'menu',
    routePath: '/system/users',
    componentPath: 'system/UsersPage',
    permission: 'member|member.read',
    icon: 'team',
    sortOrder: 2,
  },
  {
    key: 'roles',
    parentKey: 'system',
    name: 'Roles',
    labelKey: 'nav.roles',
    kind: 'menu',
    routePath: '/system/roles',
    componentPath: 'system/RolesPage',
    permission: 'role|role.read',
    icon: 'safety',
    sortOrder: 3,
  },
  {
    key: 'menus',
    parentKey: 'system',
    name: 'Menus',
    labelKey: 'nav.menus',
    kind: 'menu',
    routePath: '/system/menus',
    componentPath: 'system/MenusPage',
    permission: 'menu|menu.manage',
    icon: 'menu',
    sortOrder: 4,
  },
  {
    key: 'resources',
    name: 'Resource management',
    labelKey: 'nav.resources',
    kind: 'catalog',
    icon: 'appstore',
    sortOrder: 3,
  },
  {
    key: 'models',
    parentKey: 'resources',
    name: 'Models',
    labelKey: 'nav.models',
    kind: 'menu',
    routePath: '/resources/models',
    componentPath: 'resources/ModelsPage',
    permission: 'model|model.catalog.read',
    icon: 'api',
    sortOrder: 1,
  },
  {
    key: 'knowledge-bases',
    parentKey: 'resources',
    name: 'Knowledge bases',
    labelKey: 'nav.knowledgeBases',
    kind: 'menu',
    routePath: '/resources/knowledge-bases',
    componentPath: 'resources/KnowledgeBasesPage',
    // The catalog administration resource is registered only when this Control
    // Plane governs knowledge, so a deployment without it grants this to
    // nobody and the entry stays hidden.
    permission: 'knowledge_scope|knowledge.catalog.read',
    icon: 'read',
    sortOrder: 2,
  },
]
