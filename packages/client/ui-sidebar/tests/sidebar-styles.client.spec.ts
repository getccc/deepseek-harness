/** Sidebar shell style contracts shared with its slot-owned controls. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(fileURLToPath(new URL('../src/client/SidebarRoot.module.css', import.meta.url)), 'utf8')

/**
 * Declarations of one exact selector, keyed by property.
 * @param selector - exact selector text.
 * @returns the normalized declarations, or undefined when absent.
 */
function declarations(selector: string): Map<string, string> | undefined {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    const found = new Map<string, string>()
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
    return found
  }
  return undefined
}

describe('SidebarRoot.module.css', () => {
  it('uses a compact expanded navigation gap without shrinking the collapsed rail spacing', () => {
    expect(declarations('.panelList')?.get('gap')).toBe('2px')
    expect(declarations('.panelList')?.get('margin-bottom')).toBeUndefined()
    expect(declarations('.scrollRegion')?.get('margin-top')).toBeUndefined()
    expect(declarations('.scrollArea')?.get('grid-template-rows')).toBe('2px max-content 2px max-content')
    expect(declarations('.collapsed .panelList')?.get('gap')).toBe('12px')
  })

  it('keeps the navigation scrollport aligned with the sidebar rows and hides its scrollbar', () => {
    const root = declarations('.root')
    const scrollport = declarations('.scrollArea')
    expect(root?.get('--dsh-sidebar-inline-padding')).toBe('8px')
    expect(root?.get('padding')).toBe('6px var(--dsh-sidebar-inline-padding)')
    expect(scrollport?.get('overflow-y')).toBe('auto')
    expect(scrollport?.get('margin-left')).toBe('-4px')
    expect(scrollport?.get('grid-template-columns')).toBe('4px minmax(0, 1fr) calc(var(--dsh-sidebar-inline-padding) - 2px)')
    expect(declarations('.root:not(.collapsed) .scrollArea')?.get('scrollbar-width')).toBe('none')
    expect(declarations('.root:not(.collapsed) .scrollArea::-webkit-scrollbar')?.get('display')).toBe('none')
    expect(declarations('.scrollFade')?.get('height')).toBe('24px')
    expect(declarations('.scrollFade')?.get('pointer-events')).toBe('none')
    expect(declarations(":global([data-platform='darwin']) .scrollFade")?.get('display')).toBe('none')
    expect(declarations('.collapsed .scrollArea')?.get('margin')).toBe('0')
    expect(declarations('.collapsed .scrollArea')?.get('padding')).toBe('0')
  })

  it('moves the upper controls while the settings seat only fades', () => {
    const animation = 'rail-in 150ms var(--ds-ease-in-out) backwards'
    for (const selector of [
      '.railIn .iconButton',
      '.railIn .panelList',
      '.railIn .regionArea',
    ]) {
      expect(declarations(selector)?.get('animation')).toBe(animation)
    }
    expect(declarations('.railIn .footArea')?.get('animation')).toBe(
      'rail-fade-in 150ms var(--ds-ease-in-out) backwards',
    )
    expect(css).toMatch(
      /@keyframes rail-in\s*\{\s*from\s*\{\s*opacity: 0;\s*transform: translateX\(49px\);\s*}\s*}/,
    )
    expect(css).toMatch(/@keyframes rail-fade-in\s*\{\s*from\s*\{\s*opacity: 0;\s*}\s*}/)
  })

  it('gives shell rail controls the same base anchor for their shared translation', () => {
    expect(declarations('.collapsed .logoRow')?.get('justify-content')).toBe('flex-start')
    expect(declarations('.collapsed .panelRow')?.get('width')).toBe('36px')
    expect(declarations('.collapsed .panelRow')?.get('height')).toBe('36px')
    expect(declarations('.collapsed .panelRow')?.get('justify-content')).toBe('center')
    expect(declarations('.newSession')).toBeUndefined()
  })

  it('keeps the slotted brand row as tall as the 32px brand mark', () => {
    expect(declarations('.brandIdentity')?.get('height')).toBe('32px')
    expect(declarations('.brandName')?.get('height')).toBe('24px')
    expect(declarations('.brandName')?.get('line-height')).toBe('24px')
    expect(declarations('.brandName')?.get('font-size')).toBe('18px')
    expect(declarations('.fallbackBrandName')?.get('font-size')).toBe('17px')
    expect(declarations('.fallbackBrandName')?.get('white-space')).toBe('nowrap')
  })
})
