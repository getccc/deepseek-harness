/** PDF page presentation for a Sidebar document tab and for a complete-document view; bytes come from the owner. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { DocumentPreviewProps } from '../document/contract.ts'
import type {} from '../document/view.ts'
import { LoadingIndicator } from '../LoadingIndicator.tsx'
import { DEFAULT_PDF_VIEW, type PdfStore } from './store.ts'
import { renderPdfPage, type PdfDocument } from './document.ts'
import { openPdf } from './runtime.ts'
import { PdfWorkerFailure } from './errors.ts'
import type {} from './locales.ts'
import css from './PdfBody.module.css'

/** A record's viewing preferences survive body unmounts and leave with the tab. */
export interface PdfBodyInjected {
  /**
   * Retain viewing preferences until the tab record ends.
   * @param tabId - owning tab.
   * @param signal - tab-record lifetime, not body visibility.
   */
  readonly retainTab: (tabId: TabId, signal: AbortSignal) => void
}

/** Standard document props plus the PDF entry's locale, viewing store, and lifetime callback. */
export type PdfBodyProps = DocumentPreviewProps & PropsLocale<'sidebarPdf'> & PropsStore<PdfStore> & PdfBodyInjected

/** A complete-document view entry's inputs: the claimed bytes and the PDF entry's locale. */
export type PdfViewProps = PropsRuntime<'document.view'> & { readonly matched: Uint8Array<ArrayBuffer> } & PropsLocale<'sidebarPdf'>

type LoadState =
  | { readonly kind: 'loaded'; readonly data: Uint8Array<ArrayBuffer>; readonly document: PdfDocument }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer>; readonly error: unknown }

/**
 * Present a PDF with tab-local viewing preferences and component-owned rendering resources.
 * @param props - complete bytes and framework-owned tab/store/locale seats.
 * @returns the PDF reader.
 */
export function PdfBody(props: PdfBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const view = props.useStore(state => state.byTab[tab.id] ?? DEFAULT_PDF_VIEW)
  const { retainTab, actions, t } = props
  const pageVisible = useCallback((page: number): void => {
    actions.page(tab.id, page)
  }, [actions, tab.id])

  useEffect(() => { retainTab(tab.id, tab.signal) }, [retainTab, tab.id, tab.signal])
  if (props.content.kind !== 'bytes') return <p className={css.status} role="alert">{t('unsupported')}</p>
  return <PdfReader data={props.content.data} lifetime={tab.signal} page={view.page} onVisible={pageVisible} t={t} />
}

/** A complete-document view keeps no reading position, so a reached page is recorded nowhere. */
function forgetPage(): void {}

/**
 * A view has no lifetime beyond its mount, and the reader aborts its own work
 * on unmount, so the outer lifetime a view passes never ends.
 */
const VIEW_LIFETIME = new AbortController().signal

/**
 * Present one complete PDF claimed from the `document.view` chain, from its first page.
 * @param props - the claimed bytes and the PDF entry's locale seat.
 * @returns the PDF reader.
 */
export function PdfView({ matched, t }: PdfViewProps): ReactNode {
  return <PdfReader data={matched} lifetime={VIEW_LIFETIME} page={1} onVisible={forgetPage} t={t} />
}

/**
 * Open complete bytes and draw every page as one vertical sequence, rendering
 * a page once it nears the viewport.
 * @param props - the bytes, the outer lifetime that ends every load, the page
 * to render without waiting for the viewport, the reached-page callback, and
 * the locale seat.
 * @returns the loading state, a retryable failure, or the page sequence.
 */
function PdfReader({ data, lifetime, page, onVisible, t }: {
  readonly data: Uint8Array<ArrayBuffer>
  readonly lifetime: AbortSignal
  readonly page: number
  readonly onVisible: (page: number) => void
} & PropsLocale<'sidebarPdf'>): ReactNode {
  const [load, setLoad] = useState<LoadState>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (lifetime.aborted) return
    const owned = new AbortController()
    const signal = AbortSignal.any([owned.signal, lifetime])
    setLoad(undefined)
    const session = openPdf(data, signal, (error) => {
      if (!signal.aborted) setLoad({ kind: 'failed', data, error })
    })
    void session.document.then(
      (document) => { if (!signal.aborted) setLoad({ kind: 'loaded', data, document }) },
      (error: unknown) => { if (!signal.aborted) setLoad({ kind: 'failed', data, error }) },
    )
    return () => {
      owned.abort()
      void session.dispose()
    }
  }, [data, lifetime, attempt])
  // The open wait centres like the owner's read spinner before it, so one
  // spinner position covers everything until the first page block appears.
  if (load?.data !== data) return <LoadingIndicator className={clsx(css.status, css.opening)} label={t('loading')} />
  if (load.kind === 'failed') {
    return <div className={css.status} role="alert">
      <span>{failureText(load.error, t)}</span>
      <Button size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
    </div>
  }
  return <section className={css.body} data-pdf-preview>
    {Array.from({ length: load.document.numPages }, (_, index) => (
      <PdfPage key={index} document={load.document} page={index + 1}
        requested={index === 0 || page === index + 1} onVisible={onVisible} signal={lifetime} t={t} />
    ))}
  </section>
}

function PdfPage({ document, page, requested: initiallyRequested, onVisible, signal, t }: {
  readonly document: PdfDocument
  readonly page: number
  readonly requested: boolean
  readonly onVisible: (page: number) => void
  readonly signal: AbortSignal
} & PropsLocale<'sidebarPdf'>): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [requested, setRequested] = useState(initiallyRequested)
  const [state, setState] = useState<'loading' | 'ready'>('loading')
  const [failure, setFailure] = useState<{ readonly error: unknown }>()
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const node = host.current as HTMLDivElement
    if (typeof IntersectionObserver === 'undefined') {
      setRequested(true)
      return
    }
    let disposed = false
    const observer = new IntersectionObserver((entries) => {
      if (disposed || !entries.some(entry => entry.isIntersecting)) return
      setRequested(true)
      onVisible(page)
      observer.disconnect()
    }, { rootMargin: '100% 0px' })
    observer.observe(node)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [page, onVisible])
  useEffect(() => {
    if (!requested) return
    // The canvas is unconditional; this effect runs after its ref is committed.
    const node = canvas.current as HTMLCanvasElement
    const lifetime = new AbortController()
    const renderSignal = AbortSignal.any([lifetime.signal, signal])
    setState('loading')
    setFailure(undefined)
    void renderPdfPage(document, page, node, renderSignal, window.devicePixelRatio).then(
      () => { if (!renderSignal.aborted) setState('ready') },
      (error: unknown) => { if (!renderSignal.aborted) setFailure({ error }) },
    )
    return () => { lifetime.abort() }
  }, [document, page, requested, signal, attempt])
  return <div ref={host} className={css.page} data-pdf-page={page}>
    {failure === undefined && state !== 'ready' && (requested
      ? <div className={css.placeholder} role="status" aria-label={t('rendering')} />
      : <div className={css.placeholder} />)}
    {failure !== undefined && <div className={css.status} role="alert">
      <span>{failureText(failure.error, t)}</span>
      <Button size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button>
    </div>}
    <canvas ref={canvas} className={css.canvas} role="img" aria-label={t('pageImage', { page })}
      hidden={state !== 'ready' || failure !== undefined} />
  </div>
}

function failureText(error: unknown, t: PropsLocale<'sidebarPdf'>['t']): string {
  if (error instanceof PdfWorkerFailure) return t('workerFailed')
  if (error instanceof Error && error.name === 'PasswordException') return t('password')
  return t('failed', { message: error instanceof Error ? error.message : String(error) })
}
