/**
 * The SQLite console-menu store's durable behavior: the tree it seeds, the
 * edits it keeps across a restart, and what it refuses.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrgId } from '@deepseek-ai/dsh-account-store'
import {
  ConsoleMenuNotEmptyError,
  MenuId,
  SHIPPED_CONSOLE_MENUS,
  UnknownConsoleMenuError,
  UnknownMenuPermissionError,
  type ConsoleMenuStore,
} from '@deepseek-ai/dsh-team-console-menu'
import SqliteConsoleMenuStore, {
  CONSOLE_MENU_SQLITE_APPLICATION_ID,
  SCHEMA_VERSION,
} from '../src/index.ts'
import { applySchema } from '../src/schema.ts'

let ctx: Context
let store: ConsoleMenuStore
let dir: string

const orgId = OrgId('org-1')

async function mount(path: string): Promise<{ ctx: Context; store: ConsoleMenuStore }> {
  const mountCtx = new Context()
  await mountCtx.plugin(SqliteConsoleMenuStore, { path }).await()
  return { ctx: mountCtx, store: mountCtx.get('consoleMenu') as ConsoleMenuStore }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'team-console-menu-sqlite-'))
  const mounted = await mount(':memory:')
  ctx = mounted.ctx
  store = mounted.store
})

afterEach(async () => {
  await ctx.fiber.dispose()
  rmSync(dir, { force: true, recursive: true })
})

describe('seeding the navigation this build ships', () => {
  it('inserts the whole shipped tree once and nothing on a second call', async () => {
    expect(await store.seedShipped(orgId)).toBe(SHIPPED_CONSOLE_MENUS.length)
    expect(await store.seedShipped(orgId)).toBe(0)
    expect(await store.listMenus(orgId)).toHaveLength(SHIPPED_CONSOLE_MENUS.length)
  })

  it('hangs a shipped child from the shipped parent that lists it', async () => {
    await store.seedShipped(orgId)
    const menus = await store.listMenus(orgId)
    const system = menus.find(menu => menu.seedKey === 'system')
    const users = menus.find(menu => menu.seedKey === 'users')
    expect(users?.parentId).toBe(system?.id)
  })

  it('leaves an entry a deployment changed exactly as it changed it', async () => {
    await store.seedShipped(orgId)
    const users = (await store.listMenus(orgId)).find(menu => menu.seedKey === 'users')
    await store.updateMenu(users?.id as MenuId, { name: 'Colleagues', sortOrder: 9 })
    expect(await store.seedShipped(orgId)).toBe(0)
    const after = (await store.listMenus(orgId)).find(menu => menu.seedKey === 'users')
    expect(after?.name).toBe('Colleagues')
    expect(after?.sortOrder).toBe(9)
  })

  it('puts back an entry a deployment deleted, at its shipped settings', async () => {
    await store.seedShipped(orgId)
    const models = (await store.listMenus(orgId)).find(menu => menu.seedKey === 'models')
    await store.updateMenu(models?.id as MenuId, { name: 'Gone' })
    await store.deleteMenu(models?.id as MenuId)
    expect(await store.seedShipped(orgId)).toBe(1)
    const back = (await store.listMenus(orgId)).find(menu => menu.seedKey === 'models')
    expect(back?.name).toBe('Models')
  })

  it('seeds each organization its own tree', async () => {
    await store.seedShipped(orgId)
    await store.seedShipped(OrgId('org-2'))
    expect(await store.listMenus(OrgId('org-2'))).toHaveLength(SHIPPED_CONSOLE_MENUS.length)
    expect(await store.listMenus(orgId)).toHaveLength(SHIPPED_CONSOLE_MENUS.length)
  })

  it('retires a removed shipped page and keeps its custom children', async () => {
    const path = join(dir, 'retired.sqlite')
    const db = new DatabaseSync(path)
    applySchema(db)
    const insert = db.prepare(
      `INSERT INTO console_menu
        (id, org_id, parent_id, name, label_key, kind, route_path, component_path,
         permission, icon, sort_order, status, visible, seed_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run(
      'resources', orgId, null, 'Resources', 'nav.resources', 'catalog', null, null,
      null, 'appstore', 3, 'active', 1, 'resources', 1,
    )
    insert.run(
      'devices', orgId, 'resources', 'Devices', 'nav.devices', 'menu', '/resources/devices',
      'resources/DevicesPage', 'device|device.inventory.read', 'laptop', 1, 'active', 1, 'devices', 2,
    )
    insert.run(
      'custom', orgId, 'devices', 'Custom', null, 'menu', '/custom', 'custom/Page',
      null, null, 1, 'active', 1, null, 3,
    )
    db.close()
    const mounted = await mount(path)

    await mounted.store.seedShipped(orgId)

    const menus = await mounted.store.listMenus(orgId)
    expect(menus.find(menu => menu.id === 'devices')).toBeUndefined()
    expect(menus.find(menu => menu.id === 'custom')?.parentId).toBe('resources')
    await mounted.ctx.fiber.dispose()
  })
})

describe('listing the tree', () => {
  it('returns a parent immediately before its own subtree', async () => {
    const group = await store.createMenu({ orgId, name: 'Group', kind: 'catalog', sortOrder: 1 })
    const second = await store.createMenu({ orgId, name: 'Second', kind: 'menu', sortOrder: 2 })
    const child = await store.createMenu({
      orgId, name: 'Child', kind: 'menu', parentId: group.id, sortOrder: 1,
    })
    expect((await store.listMenus(orgId)).map(menu => menu.id))
      .toEqual([group.id, child.id, second.id])
  })

  it('orders siblings by sort order, then by when they were created', async () => {
    const later = await store.createMenu({ orgId, name: 'Later', kind: 'menu', sortOrder: 1 })
    const first = await store.createMenu({ orgId, name: 'First', kind: 'menu', sortOrder: 0 })
    const tie = await store.createMenu({ orgId, name: 'Tie', kind: 'menu', sortOrder: 1 })
    expect((await store.listMenus(orgId)).map(menu => menu.id)).toEqual([first.id, later.id, tie.id])
  })

  it('shows an entry whose parent belongs to another organization at the top level', async () => {
    const elsewhere = await store.createMenu({ orgId: OrgId('org-2'), name: 'Other', kind: 'catalog' })
    const orphan = await store.createMenu({
      orgId, name: 'Orphan', kind: 'menu', parentId: elsewhere.id,
    })
    expect((await store.listMenus(orgId)).map(menu => menu.id)).toEqual([orphan.id])
  })

  it('reads one entry by id, and answers for one it does not hold', async () => {
    const made = await store.createMenu({ orgId, name: 'One', kind: 'menu' })
    expect((await store.getMenu(made.id))?.name).toBe('One')
    expect(await store.getMenu(MenuId('nowhere'))).toBeUndefined()
  })
})

describe('creating an entry', () => {
  it('stores every field an administrator supplied', async () => {
    const made = await store.createMenu({
      orgId,
      name: 'Reports',
      kind: 'menu',
      routePath: '/reports',
      componentPath: 'system/UsersPage',
      permission: 'member|member.read',
      icon: 'team',
      sortOrder: 4,
      visible: false,
    })
    expect(made).toMatchObject({
      name: 'Reports',
      kind: 'menu',
      routePath: '/reports',
      componentPath: 'system/UsersPage',
      permission: 'member|member.read',
      icon: 'team',
      sortOrder: 4,
      visible: false,
      status: 'active',
    })
    expect(made.seedKey).toBeUndefined()
    expect(made.labelKey).toBeUndefined()
  })

  it('starts an entry visible, at the front, under nobody', async () => {
    const made = await store.createMenu({ orgId, name: 'Plain', kind: 'catalog' })
    expect(made).toMatchObject({ visible: true, sortOrder: 0, status: 'active' })
    expect(made.parentId).toBeUndefined()
  })

  it('refuses a permission the catalog does not govern', async () => {
    await expect(store.createMenu({ orgId, name: 'Bad', kind: 'menu', permission: 'member|invent' }))
      .rejects.toThrow(UnknownMenuPermissionError)
  })
})

describe('changing an entry', () => {
  it('writes the fields it was given and leaves the rest', async () => {
    const made = await store.createMenu({
      orgId, name: 'Reports', kind: 'menu', routePath: '/reports', icon: 'team',
    })
    await store.updateMenu(made.id, { sortOrder: 7, status: 'suspended', visible: false })
    expect(await store.getMenu(made.id)).toMatchObject({
      name: 'Reports', routePath: '/reports', icon: 'team',
      sortOrder: 7, status: 'suspended', visible: false,
    })
  })

  it('shows an entry again that was hidden', async () => {
    const made = await store.createMenu({ orgId, name: 'Reports', kind: 'menu', visible: false })
    await store.updateMenu(made.id, { visible: true })
    expect((await store.getMenu(made.id))?.visible).toBe(true)
  })

  it('clears a field it was given as null', async () => {
    const made = await store.createMenu({
      orgId, name: 'Reports', kind: 'menu', routePath: '/reports', permission: 'member|member.read',
    })
    await store.updateMenu(made.id, { routePath: null, permission: null, icon: null })
    const after = await store.getMenu(made.id)
    expect(after?.routePath).toBeUndefined()
    expect(after?.permission).toBeUndefined()
  })

  it('drops the shipped copy key when the entry is renamed', async () => {
    await store.seedShipped(orgId)
    const roles = (await store.listMenus(orgId)).find(menu => menu.seedKey === 'roles')
    expect(roles?.labelKey).toBe('nav.roles')
    await store.updateMenu(roles?.id as MenuId, { name: 'Positions' })
    expect((await store.getMenu(roles?.id as MenuId))?.labelKey).toBeUndefined()
  })

  it('keeps the shipped copy key when anything else changes', async () => {
    await store.seedShipped(orgId)
    const roles = (await store.listMenus(orgId)).find(menu => menu.seedKey === 'roles')
    await store.updateMenu(roles?.id as MenuId, { sortOrder: 3 })
    expect((await store.getMenu(roles?.id as MenuId))?.labelKey).toBe('nav.roles')
  })

  it('refuses a permission the catalog does not govern', async () => {
    const made = await store.createMenu({ orgId, name: 'Reports', kind: 'menu' })
    await expect(store.updateMenu(made.id, { permission: 'member|invent' }))
      .rejects.toThrow(UnknownMenuPermissionError)
  })

  it('reports an entry it does not hold, with or without a field to write', async () => {
    await expect(store.updateMenu(MenuId('nowhere'), { name: 'x' }))
      .rejects.toThrow(UnknownConsoleMenuError)
    await expect(store.updateMenu(MenuId('nowhere'), {}))
      .rejects.toThrow(UnknownConsoleMenuError)
  })

  it('accepts a change that names no field for an entry it holds', async () => {
    const made = await store.createMenu({ orgId, name: 'Reports', kind: 'menu' })
    await expect(store.updateMenu(made.id, {})).resolves.toBeUndefined()
  })
})

describe('deleting an entry', () => {
  it('removes one nothing sits under', async () => {
    const made = await store.createMenu({ orgId, name: 'Reports', kind: 'menu' })
    await store.deleteMenu(made.id)
    expect(await store.listMenus(orgId)).toHaveLength(0)
  })

  it('refuses one that still has entries under it', async () => {
    const group = await store.createMenu({ orgId, name: 'Group', kind: 'catalog' })
    await store.createMenu({ orgId, name: 'Child', kind: 'menu', parentId: group.id })
    await expect(store.deleteMenu(group.id)).rejects.toThrow(ConsoleMenuNotEmptyError)
  })

  it('reports an entry it does not hold', async () => {
    await expect(store.deleteMenu(MenuId('nowhere'))).rejects.toThrow(UnknownConsoleMenuError)
  })
})

describe('the database file', () => {
  it('keeps the tree across a restart', async () => {
    const path = join(dir, 'menus.sqlite')
    const first = await mount(path)
    await first.store.seedShipped(orgId)
    await first.ctx.fiber.dispose()

    const second = await mount(path)
    expect(await second.store.listMenus(orgId)).toHaveLength(SHIPPED_CONSOLE_MENUS.length)
    await second.ctx.fiber.dispose()
  })

  it('stamps its own application id and schema version', () => {
    const path = join(dir, 'stamped.sqlite')
    const db = new DatabaseSync(path)
    applySchema(db)
    const appId = db.prepare('PRAGMA application_id').get() as Record<string, number>
    const version = db.prepare('PRAGMA user_version').get() as Record<string, number>
    expect(Object.values(appId)[0]).toBe(CONSOLE_MENU_SQLITE_APPLICATION_ID)
    expect(Object.values(version)[0]).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('refuses a file another application wrote', () => {
    const path = join(dir, 'foreign.sqlite')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA application_id = 12345')
    expect(() => { applySchema(db) }).toThrow(/another application/u)
    db.close()
  })

  it('refuses a schema a newer build wrote', () => {
    const path = join(dir, 'newer.sqlite')
    const db = new DatabaseSync(path)
    db.exec(`PRAGMA application_id = ${CONSOLE_MENU_SQLITE_APPLICATION_ID}`)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => { applySchema(db) }).toThrow(/newer than this build/u)
    db.close()
  })
})
