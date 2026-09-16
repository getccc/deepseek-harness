/** Builtin Markdown metadata, keyed document-body registration, and complete-document view entry. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { selectViewText } from '../document/view.ts'
import { MarkdownBody, MarkdownView } from './MarkdownBody.tsx'
import { en, zh } from './locales.ts'

/** Implementation identity shared by metadata and the document slot. */
export const MARKDOWN_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown'

/** File suffixes drawn as Markdown, in a Sidebar tab and in a complete-document view alike. */
const MARKDOWN_EXTENSIONS: readonly string[] = ['md', 'markdown']

/**
 * Describe the Markdown implementation without taking ownership of loading.
 * @param title - locale-owned implementation name.
 * @returns builtin Markdown registration metadata.
 */
export function markdownDefinition(title: () => string): DocumentPreviewDefinition {
  return { id: MARKDOWN_BODY_ID, extensions: MARKDOWN_EXTENSIONS, priority: 'builtin', title, loading: 'text-pages', wrap: false }
}

/**
 * Register locale, metadata, the document body, and the view entry for the owning plugin lifetime.
 * @param ctx - plugin context carrying locale, document registry, and slots.
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind('documentMarkdown')
  ctx.effect(() => ctx.locale.register('documentMarkdown', { zh, en }), 'document-markdown: dictionaries')
  ctx.effect(() => ctx.documentPreviews.register(markdownDefinition(() => t('viewer.label'))), 'document-markdown: metadata')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: MARKDOWN_BODY_ID, locale: 'documentMarkdown' }, MarkdownBody,
  )), 'document-markdown: body')
  ctx.effect(() => ctx.slots.inject('document.view', () => ctx.slots.register(
    { name: 'document.view', select: selectViewText(MARKDOWN_EXTENSIONS), locale: 'documentMarkdown' }, MarkdownView,
  )), 'document-markdown: view')
}
