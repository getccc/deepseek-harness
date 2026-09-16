/** The knowledge panel's document drawer: one document, drawn from what the Control Plane served. */

import { useEffect, useMemo, useState, type AnimationEvent, type ReactNode } from 'react'
import clsx from 'clsx'
import {
  IconCheckOutline16, IconCloseOutline16, IconCopyOutline16, IconDownloadOutline16, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { KnowledgeDocumentContentView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import type { DocumentViewContent } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { Translate } from './locales.ts'
import css from './panels.module.css'

/** What the drawer is showing right now. */
type Phase = 'loading' | 'ready' | 'failed'

/** What the drawer needs to show one document. */
export interface DocumentDrawerProps extends Pick<PropsRenderSlots<'document.view'>, 'renderSlotChain'> {
  /** The document's title; the drawer is mounted per document a member opens. */
  readonly title: string
  /** The document to read. */
  readonly docRef: string
  /** Read one document's content. */
  readonly content: (docRef: string) => Promise<KnowledgeDocumentContentView>
  /** Whether the drawer is leaving: it plays its exit and then reports {@link DocumentDrawerProps.closed}. */
  readonly closing: boolean
  /** Ask the owner to close the drawer. */
  readonly close: () => void
  /** Report that the exit has finished and the drawer can be removed. */
  readonly closed: () => void
  /** The panel's bound translate. */
  readonly t: Translate
}

/** How long the copy control says it copied before it offers to copy again. */
const COPIED_MS = 1000

/** Content types that arrive as bytes but read as text. */
const TEXT_TYPES = /^(text\/|application\/json)/u

/** Content types the drawer draws as an image when no renderer claims the document. */
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/u

/** One answered read, in the forms the drawer uses: to draw, to copy, and to save. */
export interface PreparedDocument {
  readonly fileName: string
  /** What a renderer is offered. */
  readonly view: DocumentViewContent
  /** The document's text, when it has any to copy. */
  readonly text?: string
  /** The original file's bytes, when the source served the file rather than parsed text. */
  readonly bytes?: Uint8Array<ArrayBuffer>
  /** The media type the file was served as; empty for parsed text. */
  readonly contentType: string
  /** Whether the text is the source's parsed text cut to the deployment's bound. */
  readonly truncated: boolean
}

/**
 * Decode the bytes one answer carried.
 *
 * Base64 because the Remote boundary carries JSON; the array is built once per
 * answer.
 * @param base64 - the answer's encoded bytes.
 * @returns the decoded bytes.
 */
function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Put one answered read into the forms the drawer uses.
 *
 * A text file served as bytes is decoded once here, so a Markdown file reaches
 * its renderer as text and can be copied, while its original bytes stay what
 * a download saves.
 * @param answer - what the content read answered.
 * @returns the document to draw, copy, and save.
 */
export function prepareDocument(answer: KnowledgeDocumentContentView): PreparedDocument {
  if (answer.kind === 'text') {
    return {
      fileName: answer.fileName, view: { kind: 'text', text: answer.text }, text: answer.text, contentType: '', truncated: answer.truncated,
    }
  }
  const { fileName, contentType } = answer
  const bytes = bytesOf(answer.base64)
  if (TEXT_TYPES.test(contentType)) {
    const text = new TextDecoder().decode(bytes)
    return { fileName, view: { kind: 'text', text }, text, bytes, contentType, truncated: false }
  }
  return { fileName, view: { kind: 'bytes', data: bytes }, bytes, contentType, truncated: false }
}

/**
 * Show one document over the list it was opened from, sliding in from the
 * panel's right edge and out again.
 *
 * The drawer stays mounted through its exit: `closing` plays the exit, and
 * only the end of the drawer's own animation — not one inside its content —
 * reports `closed`. A renderer registered for the document draws it through
 * the `document.view` chain; with none, the drawer draws an image or text
 * itself and says any other file cannot be shown here.
 * @param props - the document, the read, the exit state and its callbacks, the view chain, and the locale seat.
 * @returns the scrim and the drawer.
 */
export function DocumentDrawer({ title, docRef, content, closing, close, closed, renderSlotChain, t }: DocumentDrawerProps) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [prepared, setPrepared] = useState<PreparedDocument | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let live = true
    setPhase('loading')
    content(docRef).then((served) => {
      if (!live) return
      setPrepared(prepareDocument(served))
      setPhase('ready')
    }, () => {
      if (live) setPhase('failed')
    })
    return () => { live = false }
  }, [content, docRef])

  // One object URL per served file, revoked when the file changes or the
  // drawer unmounts: a URL that outlived its document would keep the file
  // readable from a page that is no longer showing it.
  const fileUrl = useMemo(() => prepared?.bytes === undefined
    ? undefined
    : URL.createObjectURL(new Blob([prepared.bytes], { type: prepared.contentType })), [prepared])
  useEffect(() => {
    if (fileUrl === undefined) return
    return () => { URL.revokeObjectURL(fileUrl) }
  }, [fileUrl])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => { setCopied(false) }, COPIED_MS)
    return () => { window.clearTimeout(timer) }
  }, [copied])

  const copy = (text: string): void => {
    void writeClipboard(text).then((accepted) => { if (accepted) setCopied(true) })
  }

  const download = (fileName: string, href: string): void => {
    const anchor = window.document.createElement('a')
    anchor.href = href
    anchor.download = fileName
    anchor.click()
  }

  const ended = (event: AnimationEvent<HTMLElement>): void => {
    if (closing && event.target === event.currentTarget) closed()
  }

  const copyText = prepared?.text
  const copyLabel = copied ? t('drawer.copied') : t('drawer.copy')

  return (
    <>
      {/* The scrim repeats the drawer's own close control, so it stays out
          of the accessibility tree rather than offering it twice. */}
      <button
        type="button"
        className={clsx(css.scrim, closing && css.scrimClosing)}
        data-testid="knowledge-drawer-scrim"
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
      />
      <aside
        className={clsx(css.drawer, closing && css.drawerClosing)}
        role="dialog"
        aria-label={title}
        onAnimationEnd={ended}
      >
        <header className={css.drawerHead}>
          <h2 className={css.drawerTitle}>{title}</h2>
          <div className={css.drawerActions}>
            {copyText !== undefined && (
              <Tooltip label={copyLabel} side="bottom">
                <button type="button" className={css.drawerAction} aria-label={copyLabel} onClick={() => { copy(copyText) }}>
                  {copied ? <IconCheckOutline16 size={18} /> : <IconCopyOutline16 size={18} />}
                </button>
              </Tooltip>
            )}
            {prepared !== undefined && fileUrl !== undefined && (
              <Tooltip label={t('drawer.download')} side="bottom">
                <button
                  type="button"
                  className={css.drawerAction}
                  aria-label={t('drawer.download')}
                  onClick={() => { download(prepared.fileName, fileUrl) }}
                >
                  <IconDownloadOutline16 size={18} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={t('drawer.close')} side="bottom">
              <button type="button" className={css.drawerAction} aria-label={t('drawer.close')} onClick={close}>
                <IconCloseOutline16 size={18} />
              </button>
            </Tooltip>
          </div>
        </header>
        <div className={css.drawerBody}>
          <article className={css.sheet}>
            {phase === 'loading' && <p className={css.notice}>{t('preview.loading')}</p>}
            {phase === 'failed' && <p className={css.notice}><span className={css.failed}>{t('preview.failed')}</span></p>}
            {phase === 'ready' && prepared !== undefined && (
              <>
                {prepared.truncated && <p className={css.sheetNote}>{t('preview.truncated')}</p>}
                {renderSlotChain('document.view', { fileName: prepared.fileName, content: prepared.view }, {
                  fallback: <OwnDrawing prepared={prepared} fileUrl={fileUrl} t={t} />,
                })}
              </>
            )}
          </article>
        </div>
      </aside>
    </>
  )
}

/**
 * Draw a document no registered renderer claimed: text as it is, an image
 * from its object URL, anything else as a notice.
 * @param props - the prepared document, its object URL when it has one, and the locale seat.
 * @returns the drawing.
 */
function OwnDrawing({ prepared, fileUrl, t }: {
  readonly prepared: PreparedDocument
  readonly fileUrl: string | undefined
  readonly t: Translate
}): ReactNode {
  if (prepared.view.kind === 'text') return <pre className={css.previewText}>{prepared.view.text}</pre>
  if (IMAGE_TYPES.test(prepared.contentType)) {
    return <img className={css.previewImage} src={fileUrl} alt={prepared.fileName} />
  }
  return <p className={css.notice}>{t('preview.unsupported')}</p>
}
