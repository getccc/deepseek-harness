/** The plugin mounts no stylesheet where there is no document, as in a worker. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@univerjs/presets', () => ({ createUniver: vi.fn(), mergeLocales: vi.fn() }))
vi.mock('@univerjs/preset-sheets-core', () => ({ UniverSheetsCorePreset: vi.fn() }))
vi.mock('@univerjs/preset-sheets-core/locales/zh-CN', () => ({ default: {} }))
vi.mock('@univerjs/preset-sheets-core/locales/en-US', () => ({ default: {} }))
const { apply } = await import('../src/client/index.ts')

describe('apply without a document', () => {
  it('registers the dictionary, renderers, and bodies but no stylesheet', () => {
    expect(typeof document).toBe('undefined')
    const effects: string[] = []
    const ctx = {
      effect: (fn: () => unknown, name: string) => { effects.push(name); fn() },
      locale: { bind: () => () => '', register: () => () => {} },
      documentPreviews: { register: () => () => {} },
      slots: { inject: (_key: string, callback: () => () => void) => callback(), register: () => () => {} },
    }
    apply(ctx as never)
    expect(effects).toHaveLength(7)
    expect(effects.some(name => name.includes('stylesheet'))).toBe(false)
  })
})
