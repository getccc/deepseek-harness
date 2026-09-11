/** Office metadata, keyed bodies, dictionary, and disposal registration. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocumentPreviewDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import {
  apply, DOCX_BODY_ID, OFFICE_EXTENSIONS, officeBodyDefinitions, PPTX_BODY_ID, SHEET_BODY_ID,
} from '../src/client/index.ts'
import { DocxBody } from '../src/client/office/DocxBody.tsx'
import { PptxBody } from '../src/client/office/PptxBody.tsx'
import { SheetBody } from '../src/client/office/SheetBody.tsx'
import { en, zh } from '../src/client/locales.ts'
import { apply as hostApply } from '../src/index.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(async () => { await dispose?.(); dispose = undefined })

describe('office registration', () => {
  it('has no host-side behavior', () => {
    expect(() => { hostApply() }).not.toThrow()
  })

  it('claims the office suffixes as external complete-byte renderers without wrap', () => {
    const t = vi.fn((key: string) => `localized ${key}`)
    const definitions = officeBodyDefinitions(t)
    expect(definitions.map(({ title: _title, ...rest }) => rest)).toEqual([
      { id: DOCX_BODY_ID, extensions: OFFICE_EXTENSIONS.docx, priority: 'extension', loading: 'bytes-complete', wrap: false },
      { id: SHEET_BODY_ID, extensions: OFFICE_EXTENSIONS.sheet, priority: 'extension', loading: 'bytes-complete', wrap: false },
      { id: PPTX_BODY_ID, extensions: OFFICE_EXTENSIONS.pptx, priority: 'extension', loading: 'bytes-complete', wrap: false },
    ])
    expect(t).not.toHaveBeenCalled()
    expect(definitions.map(definition => definition.title())).toEqual([
      'localized title.docx', 'localized title.xlsx', 'localized title.pptx',
    ])
  })

  it('registers its dictionary, metadata, and keyed bodies, then removes every contribution', async () => {
    const ctx = new Context()
    const definitions = new Map<string, DocumentPreviewDefinition>()
    const dictionaries = new Map<string, unknown>()
    const bodies = new Map<string, unknown>()
    const register = vi.fn((options: { key: string }, body: unknown) => {
      bodies.set(options.key, body)
      return () => { bodies.delete(options.key) }
    })
    ctx.provide('documentPreviews', {
      register: (definition: DocumentPreviewDefinition) => {
        definitions.set(definition.id, definition)
        return () => { definitions.delete(definition.id) }
      },
    } as never)
    ctx.provide('slots', { inject: (_key: string, callback: () => () => void) => callback(), register } as never)
    ctx.provide('locale', {
      bind: () => (key: keyof typeof en) => en[key],
      register: (name: string, value: unknown) => {
        dictionaries.set(name, value)
        return () => { dictionaries.delete(name) }
      },
    } as never)
    const fiber = ctx.plugin({ apply })
    dispose = async () => { await fiber.dispose() }
    await fiber.await()
    expect([...definitions.keys()]).toEqual([DOCX_BODY_ID, SHEET_BODY_ID, PPTX_BODY_ID])
    expect(definitions.get(SHEET_BODY_ID)?.title()).toBe(en['title.xlsx'])
    expect(dictionaries.get('sidebarOffice')).toEqual({ zh, en })
    expect(register.mock.calls).toEqual([
      [{ name: 'sidebar.right.tab.document', key: DOCX_BODY_ID, locale: 'sidebarOffice' }, DocxBody],
      [{ name: 'sidebar.right.tab.document', key: SHEET_BODY_ID, locale: 'sidebarOffice' }, SheetBody],
      [{ name: 'sidebar.right.tab.document', key: PPTX_BODY_ID, locale: 'sidebarOffice' }, PptxBody],
    ])
    await dispose()
    expect(definitions.size).toBe(0)
    expect(bodies.size).toBe(0)
    expect(dictionaries.size).toBe(0)
  })
})
