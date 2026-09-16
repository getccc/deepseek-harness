/** One retained Markdown renderer over the document owner's accumulated text. */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from '../document/view.ts'
import type {} from './locales.ts'
import css from './MarkdownBody.module.css'

/** Standard document inputs and this implementation's locale. */
export type MarkdownBodyProps = DocumentPreviewProps & PropsLocale<'documentMarkdown'>

/** A complete-document view entry's inputs: the claimed text and this implementation's locale. */
export type MarkdownViewProps = PropsRuntime<'document.view'> & { readonly matched: string } & PropsLocale<'documentMarkdown'>

/**
 * Render Markdown text with this implementation's localized primitive chrome.
 * @param props - the text, whether more of it is still arriving, and the locale seat.
 * @returns the Markdown document.
 */
function MarkdownDocument({ text, streaming, t }: {
  readonly text: string
  readonly streaming: boolean
} & PropsLocale<'documentMarkdown'>): ReactNode {
  const copyLabel = t('code.copy')
  const copiedLabel = t('code.copied')
  const footnotes = t('footnotes')
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel, copiedLabel }, footnotes,
  }), [copyLabel, copiedLabel, footnotes])
  return (
    <div className={css.document} data-document-markdown>
      <MarkdownText text={text} streaming={streaming} labels={labels} />
    </div>
  )
}

/**
 * Render one accumulated document; EOF completes the primitive's full parse.
 * @param props - owner-loaded contents and localized primitive labels.
 * @returns Markdown content, or nothing for a non-text delivery.
 */
export function MarkdownBody({ content, t }: MarkdownBodyProps): ReactNode {
  if (content.kind !== 'text') return null
  return <MarkdownDocument text={content.text} streaming={!content.eof} t={t} />
}

/**
 * Render one complete document claimed from the `document.view` chain.
 * @param props - the claimed text and localized primitive labels.
 * @returns the settled Markdown document.
 */
export function MarkdownView({ matched, t }: MarkdownViewProps): ReactNode {
  return <MarkdownDocument text={matched} streaming={false} t={t} />
}
