/**
 * Office document previews, browser half: Word, Excel, and PowerPoint bodies
 * for the right Sidebar's document tab.
 *
 * The plugin owns no tab, file read, or toolbar. It registers three external
 * renderers with the document preview registry, which ranks an external
 * implementation above a builtin one for the same suffix, and seats the
 * matching body in the keyed document slot; unmounting the plugin removes
 * every contribution and hands those suffixes back to whatever else claims them.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the slot registry merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the document registry merge (ctx.documentPreviews) and the document slot.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { DocumentPreviewDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { DocxBody } from './office/DocxBody.tsx'
import { PptxBody } from './office/PptxBody.tsx'
import { SheetBody } from './office/SheetBody.tsx'
import { en, zh, type OfficePreviewKey } from './locales.ts'

export type { OfficePreviewKey } from './locales.ts'
export type { OfficeBodyProps } from './office/body.ts'
export { SHEET_DISPLAY_LIMITS, sheetGrid } from './office/SheetBody.tsx'

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebarOffice'

/** Word implementation identity, shared by metadata and the keyed slot. */
export const DOCX_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview-office/docx'
/** Excel implementation identity, shared by metadata and the keyed slot. */
export const SHEET_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview-office/sheet'
/** PowerPoint implementation identity, shared by metadata and the keyed slot. */
export const PPTX_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview-office/pptx'

/** File suffixes each body claims. */
export const OFFICE_EXTENSIONS = {
  docx: ['docx'],
  sheet: ['xlsx', 'xlsm', 'xls'],
  pptx: ['pptx'],
} as const

/**
 * Describe the three office renderers independently from their keyed body slots.
 * @param t - the office dictionary's translate, read when the toolbar renders.
 * @returns complete-file registrations in registration order.
 */
export function officeBodyDefinitions(t: (key: OfficePreviewKey) => string): readonly DocumentPreviewDefinition[] {
  const definition = (id: string, extensions: readonly string[], title: OfficePreviewKey): DocumentPreviewDefinition =>
    ({ id, extensions, priority: 'extension', title: () => t(title), loading: 'bytes-complete', wrap: false })
  return [
    definition(DOCX_BODY_ID, OFFICE_EXTENSIONS.docx, 'title.docx'),
    definition(SHEET_BODY_ID, OFFICE_EXTENSIONS.sheet, 'title.xlsx'),
    definition(PPTX_BODY_ID, OFFICE_EXTENSIONS.pptx, 'title.pptx'),
  ]
}

/** Required services: the dictionary registry, the slot registry, and the document preview registry. */
export const inject = ['locale', 'slots', 'documentPreviews']

/**
 * Register the office dictionary, the three renderers, and their bodies with reversible effects.
 * @param ctx - owning plugin context.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'document-office: dictionaries')
  const bodies = [[DOCX_BODY_ID, DocxBody], [SHEET_BODY_ID, SheetBody], [PPTX_BODY_ID, PptxBody]] as const
  for (const definition of officeBodyDefinitions(t)) {
    ctx.effect(() => ctx.documentPreviews.register(definition), `document-office: ${definition.id} metadata`)
  }
  for (const [key, body] of bodies) {
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
      { name: 'sidebar.right.tab.document', key, locale: NS }, body,
    )), `document-office: ${key} body`)
  }
}
