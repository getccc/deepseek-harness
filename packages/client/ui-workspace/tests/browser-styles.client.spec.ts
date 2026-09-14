/**
 * WorkspaceBrowser spacing contract, asserted against the CSS text on disk:
 * the region takes its natural height inside the shell's scrolling column
 * (ui-sidebar owns the clip, gutter, and fade), and flat, grouped, and
 * search views keep their intended rhythm.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/rows/WorkspaceBrowser.module.css', import.meta.url)), 'utf8')
const rowsCss = readFileSync(fileURLToPath(new URL('../src/client/rows/Rows.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one selector rule, keyed by property with whitespace collapsed.
 * Declaration order and trailing semicolons are normalized away.
 * @param selector - one exact selector, including a leading dot for local classes.
 * @returns the rule's declarations, or undefined when no such rule exists.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

const declarations = (selector: string): Map<string, string> | undefined => declarationsFrom(css, selector)
const rowDeclarations = (selector: string): Map<string, string> | undefined => declarationsFrom(rowsCss, selector)

describe('WorkspaceBrowser.module.css list', () => {
  const root = declarations('.root')
  const listArea = declarations('.listArea')
  const list = declarations('.list')

  it('takes its natural height and leaves scrolling, the gutter, and the fade to the shell', () => {
    expect(root?.get('flex')).toBe('none')
    expect(root?.get('padding-right')).toBeUndefined()
    expect(listArea?.get('overflow')).toBe('visible')
    expect(list).toBeDefined()
    expect(list!.get('flex')).toBe('none')
    expect(list!.get('overflow-y')).toBeUndefined()
    expect(list!.get('scrollbar-gutter')).toBeUndefined()
    expect(declarations('.fade')).toBeUndefined()
    expect(declarations('.list::-webkit-scrollbar')).toBeUndefined()
  })

  it('keeps 2px between rows and 4px between workspace groups', () => {
    expect(declarations('.flatList > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations(".searchTree > [role='treeitem'] + [role='treeitem']")?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection > * + *')?.get('margin-top')).toBe('2px')
    expect(declarations('.groupSection + .groupSection')?.get('margin-top')).toBe('4px')
  })

  it('draws drag targets as a leading chevron joined to the insertion line', () => {
    const listTopMarker = declarations('.listTopDropIndicator')
    const workspaceMarker = declarations('.workspaceDropBefore::before')
    const sessionMarker = rowDeclarations('.sessionRow.dropBefore::before')
    expect(listTopMarker?.get('top')).toBe('-8px')
    expect(listTopMarker?.get('left')).toBe('0')
    expect(workspaceMarker?.get('left')).toBe('0')
    expect(sessionMarker?.get('left')).toBe('0')
    for (const marker of [listTopMarker, workspaceMarker, sessionMarker]) {
      expect(marker?.get('height')).toBe('12px')
      expect(marker?.get('background')).not.toContain('radial-gradient')
      expect(marker?.get('background')).toContain('55deg')
      expect(marker?.get('background')).toContain('125deg')
      expect(marker?.get('background')).toContain('calc(50% - 1px) calc(50% + 1px)')
      expect(marker?.get('background')).toContain('0 0 / 5px 7px')
      expect(marker?.get('background')).toContain('0 5px / 5px 7px')
      expect(marker?.get('background')).toContain('4px 5px / calc(100% - 4px) 2px')
    }
  })

  it('keeps the overflow control, search field, and row heights', () => {
    expect(declarations('.sessionOverflowButton')?.get('height')).toBe('28px')
    expect(declarations('.searchExpanded')?.get('height')).toBe('30px')
    expect(rowDeclarations('.projectRow')?.get('height')).toBe('34px')
    expect(rowDeclarations('.sessionRow')?.get('height')).toBe('32px')
    expect(rowDeclarations('.flatSessionRowWithoutStatus .title')?.get('margin-left')).toBe('0')
    expect(rowDeclarations('.searchResultRow')?.get('min-height')).toBe('48px')
    expect(rowDeclarations('.sessionRow.selected')?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
  })

  it('pins both rail controls to the shared left anchor during the column slide', () => {
    expect(declarations('.rail .sectionHeader')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.rail .iconButton')?.get('width')).toBe('36px')
    expect(declarations('.rail .search')?.get('width')).toBe('36px')
  })
})
