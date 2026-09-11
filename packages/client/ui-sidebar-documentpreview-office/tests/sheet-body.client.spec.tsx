// @vitest-environment jsdom
/** Workbook parsing into a Univer instance owned by the body: locale, lifetime, failure, and unsupported content. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LocaleType, type IWorkbookData } from '@univerjs/core'
import { en } from '../src/client/locales.ts'
import { bodyProps, workbookBytes } from './support.client.ts'

/** The slice of Univer the body drives. */
interface UniverInstance {
  univer: { dispose: () => void }
  univerAPI: { createWorkbook: (data: IWorkbookData) => void }
}
const createUniver = vi.fn<(config: { locale: LocaleType; locales: Record<string, unknown>; presets: unknown[] }) => UniverInstance>()
vi.mock('@univerjs/presets', () => ({
  createUniver: (config: Parameters<typeof createUniver>[0]) => createUniver(config),
  mergeLocales: (pack: unknown) => ({ merged: pack }),
}))
vi.mock('@univerjs/preset-sheets-core', () => ({
  UniverSheetsCorePreset: (config: { container: HTMLElement }) => ({ preset: 'sheets-core', container: config.container }),
}))
vi.mock('@univerjs/preset-sheets-core/locales/zh-CN', () => ({ default: { language: 'zh' } }))
vi.mock('@univerjs/preset-sheets-core/locales/en-US', () => ({ default: { language: 'en' } }))
const { SheetBody, univerLocale } = await import('../src/client/office/SheetBody.tsx')

/** A Univer stand-in with its spies. */
function fakeUniver(): { instance: UniverInstance; dispose: ReturnType<typeof vi.fn>; createWorkbook: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn()
  const createWorkbook = vi.fn()
  return { instance: { univer: { dispose }, univerAPI: { createWorkbook } }, dispose, createWorkbook }
}

beforeEach(() => {
  createUniver.mockReset()
  document.documentElement.lang = 'en'
})
afterEach(cleanup)

describe('univerLocale', () => {
  it('follows the document language', () => {
    expect(univerLocale('zh-CN')).toBe(LocaleType.ZH_CN)
    expect(univerLocale('ZH')).toBe(LocaleType.ZH_CN)
    expect(univerLocale('en')).toBe(LocaleType.EN_US)
    expect(univerLocale('')).toBe(LocaleType.EN_US)
  })
})

describe('SheetBody', () => {
  it('opens the workbook in a Univer instance inside its host and disposes it on unmount', () => {
    const { instance, dispose, createWorkbook } = fakeUniver()
    createUniver.mockReturnValue(instance)
    const view = render(<SheetBody {...bodyProps('report.xlsx', workbookBytes({ Totals: [['Name', 'Total'], ['Ada', 42]], Notes: [['Remark']] }))} />)
    expect(screen.queryByRole('status')).toBeNull()
    const host = view.container.querySelector('[data-office-preview="xlsx"] > div') as HTMLElement
    const mount = host.firstElementChild as HTMLElement
    const config = createUniver.mock.calls[0]![0]
    expect(config.locale).toBe(LocaleType.EN_US)
    expect(config.locales).toEqual({ [LocaleType.EN_US]: { merged: { language: 'en' } } })
    expect(config.presets).toEqual([{ preset: 'sheets-core', container: mount }])
    const snapshot = createWorkbook.mock.calls[0]![0] as IWorkbookData
    expect(snapshot.sheetOrder).toEqual(['sheet-0', 'sheet-1'])
    expect(Object.values(snapshot.sheets).map(sheet => sheet.name)).toEqual(['Totals', 'Notes'])
    expect(dispose).not.toHaveBeenCalled()
    view.unmount()
    expect(dispose).toHaveBeenCalledOnce()
    expect(mount.isConnected).toBe(false)
  })

  it('renders in Chinese when the document is', () => {
    document.documentElement.lang = 'zh-CN'
    createUniver.mockReturnValue(fakeUniver().instance)
    render(<SheetBody {...bodyProps('report.xlsx', workbookBytes({ Only: [['x']] }))} />)
    const config = createUniver.mock.calls[0]![0]
    expect(config.locale).toBe(LocaleType.ZH_CN)
    expect(config.locales).toEqual({ [LocaleType.ZH_CN]: { merged: { language: 'zh' } } })
  })

  it('fails with a retry action on bytes that are not a workbook, and opens again on retry', () => {
    const { instance, createWorkbook } = fakeUniver()
    createUniver.mockReturnValue(instance)
    render(<SheetBody {...bodyProps('broken.xlsx', new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9]))} />)
    expect(screen.getByRole('alert').textContent).toContain(en.failed)
    expect(createUniver).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(screen.getByRole('alert').textContent).toContain(en.failed)
    expect(createWorkbook).not.toHaveBeenCalled()
  })

  it('disposes a half-built instance when the preset refuses the workbook', () => {
    const { instance, dispose, createWorkbook } = fakeUniver()
    createWorkbook.mockImplementation(() => { throw new Error('refused') })
    createUniver.mockReturnValue(instance)
    const view = render(<SheetBody {...bodyProps('refused.xlsx', workbookBytes({ Only: [['x']] }))} />)
    expect(screen.getByRole('alert').textContent).toContain(en.failed)
    expect(dispose).toHaveBeenCalledOnce()
    expect(view.container.querySelector('[data-office-preview="xlsx"] > div')?.childElementCount).toBe(0)
    view.unmount()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('refuses text-page content', () => {
    render(<SheetBody {...bodyProps('pages.xlsx', undefined)} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
    expect(createUniver).not.toHaveBeenCalled()
  })
})
