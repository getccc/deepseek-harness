/** One retained Markdown renderer over the document owner's accumulated text. */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { DocumentPreviewProps } from '../document/contract.ts'
import { markdownImageUrl } from './path-images.ts'
import type {} from './locales.ts'
import css from './MarkdownBody.module.css'

/** Standard document inputs and this implementation's locale. */
export type MarkdownBodyProps = DocumentPreviewProps & PropsLocale<'documentMarkdown'>

/**
 * The `document.view` entry props the Markdown view reads: the claimed text
 * and this implementation's locale. The chain's owner props also arrive and stay unread.
 */
export type MarkdownViewProps = { readonly matched: string } & PropsLocale<'documentMarkdown'>

/**
 * Render Markdown text with this implementation's localized primitive chrome.
 * @param props - the text, whether more of it is still arriving, the local
 * image rewriting when the text has a file location, and the locale seat.
 * @returns the Markdown document.
 */
function MarkdownDocument({ text, streaming, pathImages, t }: {
  readonly text: string
  readonly streaming: boolean
  readonly pathImages?: MarkdownPathImages | undefined
} & PropsLocale<'documentMarkdown'>): ReactNode {
  const copyLabel = t('code.copy')
  const copiedLabel = t('code.copied')
  const footnotes = t('footnotes')
  const codeLabel = t('codeBlock.title')
  const wrapLabel = t('codeBlock.wrap')
  const unwrapLabel = t('codeBlock.unwrap')
  const labels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel, copiedLabel, toolbarLabels: { codeLabel, wrapLabel, unwrapLabel } }, footnotes,
  }), [copyLabel, copiedLabel, footnotes, codeLabel, wrapLabel, unwrapLabel])
  return (
    <div className={css.document} data-document-markdown>
      <MarkdownText text={text} streaming={streaming} labels={labels} pathImages={pathImages} />
    </div>
  )
}

/**
 * Render one accumulated document; EOF completes the primitive's full parse.
 * @param props - owner-loaded contents and localized primitive labels.
 * @returns Markdown content, or nothing for a non-text delivery.
 */
export function MarkdownBody({ content, resourceAddress, useResource, t }: MarkdownBodyProps): ReactNode {
  const absolutePath = useResource<'file'>(resourceAddress).value?.absolutePath
  const pathImages = useMemo<MarkdownPathImages>(() => ({
    resolve: value => markdownImageUrl(document.baseURI, absolutePath, value),
  }), [absolutePath])
  if (content.kind !== 'text') return null
  return <MarkdownDocument text={content.text} streaming={!content.eof} pathImages={pathImages} t={t} />
}

/**
 * Render one complete document claimed from the `document.view` chain. The
 * claimed text has no file location, so local image paths are not rewritten.
 * @param props - the claimed text and localized primitive labels.
 * @returns the settled Markdown document.
 */
export function MarkdownView({ matched, t }: MarkdownViewProps): ReactNode {
  return <MarkdownDocument text={matched} streaming={false} t={t} />
}
