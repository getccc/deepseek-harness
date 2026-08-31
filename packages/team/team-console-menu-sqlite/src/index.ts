/**
 * SQLite-backed console menus: one database file holding the administration
 * navigation of every organization this Control Plane serves.
 * @module @deepseek-ai/dsh-team-console-menu-sqlite
 */

import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { OrgId, type OrgId as OrgIdType } from '@deepseek-ai/dsh-account-store'
import {
  ConsoleMenuNotEmptyError,
  ConsoleMenuStore,
  MenuId,
  RETIRED_SHIPPED_MENU_KEYS,
  SHIPPED_CONSOLE_MENUS,
  UnknownConsoleMenuError,
  UnknownMenuPermissionError,
  isMenuPermission,
  type ConsoleMenu,
  type ConsoleMenuKind,
  type ConsoleMenuStatus,
  type CreateConsoleMenu,
  type UpdateConsoleMenu,
} from '@deepseek-ai/dsh-team-console-menu'
import { applySchema, type ConsoleMenuRow } from './schema.ts'

export { CONSOLE_MENU_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from './schema.ts'

/** Plugin config: where the database lives. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
}

/** The columns an insert writes, in the order the statement binds them. */
const INSERT = `INSERT INTO console_menu
  (id, org_id, parent_id, name, label_key, kind, route_path, component_path,
   permission, icon, sort_order, status, visible, seed_key, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

function toConsoleMenu(row: ConsoleMenuRow): ConsoleMenu {
  return {
    id: MenuId(row.id),
    orgId: OrgId(row.org_id),
    parentId: row.parent_id === null ? undefined : MenuId(row.parent_id),
    name: row.name,
    labelKey: row.label_key ?? undefined,
    kind: row.kind as ConsoleMenuKind,
    routePath: row.route_path ?? undefined,
    componentPath: row.component_path ?? undefined,
    permission: row.permission ?? undefined,
    icon: row.icon ?? undefined,
    sortOrder: row.sort_order,
    status: row.status as ConsoleMenuStatus,
    visible: row.visible !== 0,
    seedKey: row.seed_key ?? undefined,
    createdAt: row.created_at,
  }
}

/**
 * Depth-first order: every entry immediately followed by its own subtree.
 *
 * An entry whose parent is not among these rows is shown at the top level, so
 * navigation is never silently short a page. The walk cannot loop: a parent is
 * chosen when the entry is created and never changed.
 * @param rows - one organization's entries, siblings already in order.
 * @returns the same rows, parents before their children.
 */
function orderTree(rows: readonly ConsoleMenuRow[]): ConsoleMenuRow[] {
  const known = new Set(rows.map(row => row.id))
  const children = new Map<string | null, ConsoleMenuRow[]>()
  for (const row of rows) {
    const parent = row.parent_id !== null && known.has(row.parent_id) ? row.parent_id : null
    children.set(parent, [...children.get(parent) ?? [], row])
  }
  const ordered: ConsoleMenuRow[] = []
  const visit = (parent: string | null): void => {
    for (const row of children.get(parent) ?? []) {
      ordered.push(row)
      visit(row.id)
    }
  }
  visit(null)
  return ordered
}

/**
 * Name what is wrong with the permission an entry declares.
 *
 * Returned rather than thrown, because every store method's contract is a
 * promise and a caller's `.catch` cannot see a synchronous throw.
 * @param permission - the pair an entry names, or undefined when it names none.
 * @returns the failure, or undefined when the pair is one the catalog governs.
 */
function permissionProblem(
  permission: string | null | undefined,
): UnknownMenuPermissionError | undefined {
  if (typeof permission !== 'string' || permission === '') return undefined
  return isMenuPermission(permission) ? undefined : new UnknownMenuPermissionError(permission)
}

/**
 * The console-menu store over one SQLite database. Every write is a single
 * statement, so each is already atomic; nothing here spans two tables.
 */
export class SqliteConsoleMenuStore extends ConsoleMenuStore {
  static Config: z<Config> = z.object({
    path: z.string().required(),
  })

  private db!: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  /** Open and bring the database to the current schema before serving reads. */
  protected async [Service.init](): Promise<void> {
    const db = new DatabaseSync(this.config.path)
    applySchema(db)
    this.db = db
    this.ctx.effect(() => () => { db.close() }, 'team-console-menu-sqlite.close')
    await Promise.resolve()
  }

  seedShipped(orgId: OrgIdType): Promise<number> {
    const find = this.db.prepare('SELECT id FROM console_menu WHERE org_id = ? AND seed_key = ?')
    for (const key of RETIRED_SHIPPED_MENU_KEYS) {
      const retired = find.get(orgId, key) as { id: string } | undefined
      if (retired === undefined) continue
      const parent = this.db.prepare('SELECT parent_id FROM console_menu WHERE id = ?')
        .get(retired.id) as { parent_id: string | null }
      this.db.prepare('UPDATE console_menu SET parent_id = ? WHERE parent_id = ?')
        .run(parent.parent_id, retired.id)
      this.db.prepare('DELETE FROM console_menu WHERE id = ?').run(retired.id)
    }
    const insert = this.db.prepare(INSERT)
    const now = Date.now()
    let inserted = 0
    for (const entry of SHIPPED_CONSOLE_MENUS) {
      if (find.get(orgId, entry.key) !== undefined) continue
      // The catalog lists a parent before the children that name it, and an
      // entry with children cannot be deleted, so a parent named here is
      // either already stored or was inserted by an earlier turn of this loop.
      const parentId = entry.parentKey === undefined
        ? null
        : (find.get(orgId, entry.parentKey) as { id: string }).id
      insert.run(
        randomUUID(), orgId, parentId, entry.name, entry.labelKey, entry.kind,
        entry.routePath ?? null, entry.componentPath ?? null, entry.permission ?? null,
        entry.icon, entry.sortOrder, 'active', 1, entry.key, now,
      )
      inserted += 1
    }
    return Promise.resolve(inserted)
  }

  listMenus(orgId: OrgIdType): Promise<ConsoleMenu[]> {
    const rows = this.db.prepare(
      // Insertion order breaks a tie between two siblings that carry the same
      // `sort_order`, so the tree an administrator sees does not shuffle.
      'SELECT * FROM console_menu WHERE org_id = ? ORDER BY sort_order, rowid',
    ).all(orgId) as unknown as ConsoleMenuRow[]
    return Promise.resolve(orderTree(rows).map(toConsoleMenu))
  }

  getMenu(id: MenuId): Promise<ConsoleMenu | undefined> {
    const row = this.db.prepare('SELECT * FROM console_menu WHERE id = ?').get(id) as
      ConsoleMenuRow | undefined
    return Promise.resolve(row === undefined ? undefined : toConsoleMenu(row))
  }

  createMenu(input: CreateConsoleMenu): Promise<ConsoleMenu> {
    const problem = permissionProblem(input.permission)
    if (problem !== undefined) return Promise.reject(problem)
    const row: ConsoleMenuRow = {
      id: randomUUID(),
      org_id: input.orgId,
      parent_id: input.parentId ?? null,
      name: input.name,
      // An entry an administrator created is their own words in their own
      // language, so there is no shipped copy key to translate it through.
      label_key: null,
      kind: input.kind,
      route_path: input.routePath ?? null,
      component_path: input.componentPath ?? null,
      permission: input.permission ?? null,
      icon: input.icon ?? null,
      sort_order: input.sortOrder ?? 0,
      status: 'active',
      visible: input.visible === false ? 0 : 1,
      seed_key: null,
      created_at: Date.now(),
    }
    this.db.prepare(INSERT).run(
      row.id, row.org_id, row.parent_id, row.name, row.label_key, row.kind,
      row.route_path, row.component_path, row.permission, row.icon,
      row.sort_order, row.status, row.visible, row.seed_key, row.created_at,
    )
    return Promise.resolve(toConsoleMenu(row))
  }

  updateMenu(id: MenuId, changes: UpdateConsoleMenu): Promise<void> {
    const problem = permissionProblem(changes.permission)
    if (problem !== undefined) return Promise.reject(problem)
    const written = ([
      ['name', changes.name],
      ['kind', changes.kind],
      ['route_path', changes.routePath],
      ['component_path', changes.componentPath],
      ['permission', changes.permission],
      ['icon', changes.icon],
      ['sort_order', changes.sortOrder],
      ['status', changes.status],
      ['visible', changes.visible === undefined ? undefined : changes.visible ? 1 : 0],
      // Renaming makes the words the organization's own, so the shipped copy
      // key stops applying; every other edit leaves the translation in place.
      ['label_key', changes.name === undefined ? undefined : null],
    ] as const).flatMap(([column, value]) =>
      value === undefined ? [] : [[column, value] as readonly [string, string | number | null]])
    if (written.length === 0) return this.require(id)
    const result = this.db.prepare(
      `UPDATE console_menu SET ${written.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`,
    ).run(...written.map(([, value]) => value), id)
    return Number(result.changes) === 0
      ? Promise.reject(new UnknownConsoleMenuError(id))
      : Promise.resolve()
  }

  deleteMenu(id: MenuId): Promise<void> {
    const children = this.db.prepare(
      'SELECT count(*) AS n FROM console_menu WHERE parent_id = ?',
    ).get(id) as { n: number }
    // Refused before the delete rather than left to the foreign key, so the
    // caller is told what still sits under the entry instead of reading a
    // constraint name.
    if (children.n !== 0) return Promise.reject(new ConsoleMenuNotEmptyError(id, children.n))
    const result = this.db.prepare('DELETE FROM console_menu WHERE id = ?').run(id)
    return Number(result.changes) === 0
      ? Promise.reject(new UnknownConsoleMenuError(id))
      : Promise.resolve()
  }

  /**
   * Answer whether an entry is there, for an update that writes no column. The
   * unknown-entry failure is the whole contract of such a call, and a statement
   * with an empty `SET` is not valid SQL to get it from.
   */
  private require(id: MenuId): Promise<void> {
    const row = this.db.prepare('SELECT 1 FROM console_menu WHERE id = ?').get(id)
    return row === undefined
      ? Promise.reject(new UnknownConsoleMenuError(id))
      : Promise.resolve()
  }
}

export default SqliteConsoleMenuStore
