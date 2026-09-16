/** PDF metadata, keyed slot, view chain entry, dictionary, and tab-view lifetime registration. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { DocumentPreviewRegistry } from '../src/client/document/registry.ts'
import type { DocumentViewOwnerProps } from '../src/client/document/view.ts'
import { createPdfStore } from '../src/client/pdf/store.ts'
import type { PdfBodyInjected } from '../src/client/pdf/PdfBody.tsx'

vi.mock('../src/client/pdf/runtime.ts', () => ({ openPdf: vi.fn() }))
import { apply, PDF_BODY_ID } from '../src/client/pdf/index.ts'
import { PdfBody, PdfView } from '../src/client/pdf/PdfBody.tsx'
import { en, zh } from '../src/client/pdf/locales.ts'

describe('PDF registration', () => {
  it('registers a builtin complete-bytes body and removes all contributions and retained view state on dispose', async () => {
    const ctx = new Context()
    const previews = new DocumentPreviewRegistry()
    const dictionaries = new Map<string, unknown>()
    const entries: Array<{
      name: string
      key: string
      locale: string
      store: ReturnType<typeof createPdfStore>
      inject: (sessionId: SessionId, actions: ReturnType<ReturnType<typeof createPdfStore>['create']>['actions']) => PdfBodyInjected
    }> = []
    const views: Array<{ name: string; locale: string; select: (owner: DocumentViewOwnerProps) => unknown }> = []
    const register = vi.fn((options: { name: string }, component: unknown) => {
      const list: { name: string }[] = options.name === 'document.view' ? views : entries
      expect(component).toBe(options.name === 'document.view' ? PdfView : PdfBody)
      list.push(options)
      return () => { list.splice(list.indexOf(options), 1) }
    })
    ctx.provide('documentPreviews', previews)
    ctx.provide('locale', {
      register: (name: string, value: unknown) => { dictionaries.set(name, value); return () => { dictionaries.delete(name) } },
      bind: () => makeTranslate(en),
    } as never)
    ctx.provide('slots', {
      inject: (_name: string, callback: () => () => void) => callback(), register,
    } as never)
    const fiber = ctx.plugin({ apply })
    try {
      await fiber.await()
      expect(previews.candidates('REPORT.PDF')).toMatchObject([
        { id: PDF_BODY_ID, extensions: ['pdf'], priority: 'builtin', loading: 'bytes-complete', wrap: false },
      ])
      expect(previews.candidates('report.pdf')[0]!.title()).toBe('PDF')
      expect(dictionaries.get('sidebarPdf')).toEqual({ zh, en })
      expect(entries[0]).toMatchObject({ name: 'sidebar.right.tab.document', key: PDF_BODY_ID, locale: 'sidebarPdf' })
      // The view entry claims complete PDF bytes by suffix and passes on
      // anything else, including a PDF's parsed text.
      expect(views).toMatchObject([{ name: 'document.view', locale: 'sidebarPdf' }])
      const data = new Uint8Array(new ArrayBuffer(3))
      expect(views[0]!.select({ fileName: 'reports/Q3.PDF', content: { kind: 'bytes', data } })).toBe(data)
      expect(views[0]!.select({ fileName: 'Q3.pdf', content: { kind: 'text', text: 'parsed' } })).toBeNull()
      expect(views[0]!.select({ fileName: 'Q3.pdf.txt', content: { kind: 'bytes', data } })).toBeNull()
      const instance = entries[0]!.store.create()
      const face = entries[0]!.inject('s1' as SessionId, instance.actions)
      const controller = new AbortController()
      face.retainTab('one' as TabId, controller.signal)
      face.retainTab('one' as TabId, controller.signal)
      instance.actions.page('one' as TabId, 2)
      controller.abort()
      expect(instance.getSnapshot().byTab).toEqual({})
      instance.actions.page('ended' as TabId, 3)
      face.retainTab('ended' as TabId, controller.signal)
      expect(instance.getSnapshot().byTab).toEqual({})
      const other = new AbortController()
      face.retainTab('two' as TabId, other.signal)
      instance.actions.page('two' as TabId, 2)
      await fiber.dispose()
      expect(instance.getSnapshot().byTab).toEqual({})
      expect(previews.getSnapshot()).toEqual([])
      expect(entries).toEqual([])
      expect(views).toEqual([])
      expect(dictionaries.size).toBe(0)
    } finally {
      await fiber.dispose()
    }
  })
})
