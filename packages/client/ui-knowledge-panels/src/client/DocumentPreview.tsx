/** The knowledge panel's preview column: one document, drawn from what the Control Plane served. */

import { useEffect, useMemo, useState } from 'react'
import type { KnowledgeDocumentContentView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import type { Translate } from './locales.ts'
import css from './panels.module.css'

/** What this column is showing right now. */
type Phase = 'idle' | 'loading' | 'ready' | 'failed'

/** What the preview column needs to draw one document. */
export interface DocumentPreviewProps {
  /** The document to draw, or undefined while none is chosen. */
  readonly docRef: string | undefined
  /** Read one document's content. */
  readonly content: (docRef: string) => Promise<KnowledgeDocumentContentView>
  /** The panel's bound translate. */
  readonly t: Translate
}

/** Content types this column draws as an image. */
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/u

/** Content types this column decodes and draws as text. */
const TEXT_TYPES = /^(text\/|application\/json)/u

/**
 * Decode the bytes one answer carried.
 *
 * Base64 because the Remote boundary carries JSON; the array is built once per
 * answer and the object URL below is what the browser actually reads.
 */
function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Draw one document.
 *
 * What can be drawn here is what a browser draws from bytes on its own — a
 * PDF, an image, anything that is text — plus the parsed text the Control
 * Plane falls back to. An Office file arrives as bytes this column cannot
 * draw: its renderers live behind the right Sidebar's session-scoped document
 * slot, and reaching them from a global panel is its own change.
 * @param props - the document, the read, and the locale seat.
 * @returns the preview element tree.
 */
export function DocumentPreview({ docRef, content, t }: DocumentPreviewProps) {
  const [phase, setPhase] = useState<Phase>(docRef === undefined ? 'idle' : 'loading')
  const [answer, setAnswer] = useState<KnowledgeDocumentContentView | undefined>(undefined)

  useEffect(() => {
    if (docRef === undefined) {
      setPhase('idle')
      setAnswer(undefined)
      return
    }
    let live = true
    setPhase('loading')
    content(docRef).then((served) => {
      if (!live) return
      setAnswer(served)
      setPhase('ready')
    }, () => {
      if (live) setPhase('failed')
    })
    return () => { live = false }
  }, [content, docRef])

  // One object URL per byte answer, revoked when the answer changes or the
  // column unmounts: a URL that outlived its document would keep the file
  // readable from a page that is no longer showing it.
  const objectUrl = useMemo(() => {
    if (answer?.kind !== 'bytes' || TEXT_TYPES.test(answer.contentType)) return undefined
    return URL.createObjectURL(new Blob([bytesOf(answer.base64)], { type: answer.contentType }))
  }, [answer])
  useEffect(() => {
    if (objectUrl === undefined) return
    return () => { URL.revokeObjectURL(objectUrl) }
  }, [objectUrl])

  if (phase === 'idle') return <p className={css.notice}>{t('preview.select')}</p>
  if (phase === 'loading') return <p className={css.notice}>{t('preview.loading')}</p>
  if (phase === 'failed' || answer === undefined) {
    return <p className={css.notice}><span className={css.failed}>{t('preview.failed')}</span></p>
  }

  if (answer.kind === 'text') {
    return (
      <div className={css.preview}>
        <p className={css.summary}>
          <span>{answer.fileName}</span>
          {answer.truncated && <span className={css.truncated}>{t('preview.truncated')}</span>}
        </p>
        <pre className={css.previewText}>{answer.text}</pre>
      </div>
    )
  }

  if (TEXT_TYPES.test(answer.contentType)) {
    return (
      <div className={css.preview}>
        <p className={css.summary}><span>{answer.fileName}</span></p>
        <pre className={css.previewText}>{new TextDecoder().decode(bytesOf(answer.base64))}</pre>
      </div>
    )
  }

  return (
    <div className={css.preview}>
      <p className={css.summary}><span>{answer.fileName}</span></p>
      {IMAGE_TYPES.test(answer.contentType) && (
        <img className={css.previewImage} src={objectUrl} alt={answer.fileName} />
      )}
      {answer.contentType === 'application/pdf' && (
        <object className={css.previewFrame} type="application/pdf" data={objectUrl} aria-label={answer.fileName}>
          <p className={css.notice}>{t('preview.unsupported')}</p>
        </object>
      )}
      {!IMAGE_TYPES.test(answer.contentType) && answer.contentType !== 'application/pdf' && (
        <p className={css.notice}>{t('preview.unsupported')}</p>
      )}
    </div>
  )
}
