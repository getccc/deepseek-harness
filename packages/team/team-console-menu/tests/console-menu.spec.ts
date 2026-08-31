/**
 * What the console-menu seam decides on its own: which permission strings a
 * navigation entry may name, and the catalog this build ships.
 */

import { describe, expect, it } from 'vitest'
import { PERMISSION_CATALOG } from '@deepseek-ai/dsh-access-control'
import {
  ConsoleMenuNotEmptyError,
  HOME_MENU_KEY,
  MenuId,
  SHIPPED_CONSOLE_MENUS,
  UnknownConsoleMenuError,
  UnknownMenuPermissionError,
  isMenuPermission,
} from '../src/index.ts'

describe('the permission an entry may name', () => {
  it('accepts a pair the catalog governs', () => {
    expect(isMenuPermission('member|member.read')).toBe(true)
    expect(isMenuPermission('menu|menu.manage')).toBe(true)
  })

  it('refuses a pair the catalog does not govern', () => {
    expect(isMenuPermission('member|member.invent')).toBe(false)
    expect(isMenuPermission('nothing|member.read')).toBe(false)
  })

  it('refuses anything that is not a resource type and an action', () => {
    expect(isMenuPermission('member.read')).toBe(false)
    expect(isMenuPermission('|member.read')).toBe(false)
    expect(isMenuPermission('')).toBe(false)
  })
})

describe('the navigation this build ships', () => {
  it('names only permissions the catalog governs', () => {
    const governed = new Set(PERMISSION_CATALOG.map(entry => `${entry.resourceType}|${entry.action}`))
    for (const entry of SHIPPED_CONSOLE_MENUS) {
      if (entry.permission === undefined) continue
      expect(governed, entry.key).toContain(entry.permission)
    }
  })

  it('lists a parent before every child that names it', () => {
    const seen = new Set<string>()
    for (const entry of SHIPPED_CONSOLE_MENUS) {
      if (entry.parentKey !== undefined) expect(seen, entry.key).toContain(entry.parentKey)
      seen.add(entry.key)
    }
  })

  it('gives every entry its own key, and starts at the home entry', () => {
    const keys = SHIPPED_CONSOLE_MENUS.map(entry => entry.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toContain(HOME_MENU_KEY)
  })

  it('gives a page an address and a component, and a group neither', () => {
    for (const entry of SHIPPED_CONSOLE_MENUS) {
      if (entry.kind === 'menu') {
        expect(entry.routePath, entry.key).toBeDefined()
        expect(entry.componentPath, entry.key).toBeDefined()
      } else {
        expect(entry.routePath, entry.key).toBeUndefined()
        expect(entry.componentPath, entry.key).toBeUndefined()
      }
    }
  })
})

describe('the failures the seam names', () => {
  it('carries what each refusal was about', () => {
    const id = MenuId('menu-1')
    expect(new UnknownConsoleMenuError(id).menuId).toBe(id)
    expect(new ConsoleMenuNotEmptyError(id, 2).children).toBe(2)
    expect(new UnknownMenuPermissionError('a|b').permission).toBe('a|b')
  })
})
