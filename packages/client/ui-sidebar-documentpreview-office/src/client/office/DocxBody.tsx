/** Word document presentation: docx-preview lays the pages out; the body scales them to the pane and lets the reader zoom. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { renderAsync } from 'docx-preview'
import { bytesOf, observeResize, type OfficeBodyProps, type RenderState } from './body.ts'
import { Failed, Loading, Unsupported } from './Status.tsx'
import css from './DocxBody.module.css'

/**
 * Zoom bounds and step, in percent. The floor sits well under 100 because
 * fit-to-width has to reach it: an A4 page is about 794 CSS px wide and the
 * pane is regularly narrower than half of that.
 */
export const DOCX_ZOOM = { min: 20, max: 200, step: 10 } as const

/** @param percent - requested zoom. @returns the zoom within {@link DOCX_ZOOM}. */
export function clampZoom(percent: number): number {
  return Math.max(DOCX_ZOOM.min, Math.min(DOCX_ZOOM.max, percent))
}

/** Sum of the named computed lengths, each unset length counting as zero. */
function lengths(style: CSSStyleDeclaration, ...properties: readonly string[]): number {
  return properties.reduce((sum, property) => sum + (parseFloat(style.getPropertyValue(property)) || 0), 0)
}

/**
 * The zoom that fits the first page's width into the viewport.
 *
 * The page `section` carries the document's own width; every box between it
 * and `wrap` (docx-preview's own wrapper, then `wrap` itself) adds its padding
 * and borders to what has to fit. Measured on the layout box, which CSS `zoom`
 * leaves in layout pixels, so the result does not depend on the zoom in effect.
 * @param viewport - scrolling box the pages must fit; its clientWidth excludes the scrollbar.
 * @param wrap - element the pages were rendered into.
 * @returns the fitting zoom, or undefined before a page exists or while the boxes have no width.
 */
export function fitPercent(viewport: HTMLElement, wrap: HTMLElement): number | undefined {
  const page = wrap.querySelector('section')
  if (page === null || viewport.clientWidth <= 0) return undefined
  let width = page.offsetWidth + lengths(getComputedStyle(page), 'margin-left', 'margin-right')
  for (let box = page.parentElement; box !== null; box = box.parentElement) {
    width += lengths(getComputedStyle(box), 'padding-left', 'padding-right', 'border-left-width', 'border-right-width')
    if (box === wrap) break
  }
  return width > 0 ? clampZoom(Math.floor(viewport.clientWidth / width * 100)) : undefined
}

/**
 * Present a Word document as paginated HTML at a zoom that first fits the
 * pane's width, then follows the reader's slider or Alt + wheel.
 * @param props - complete bytes and the framework's tab, scrollport, and locale seats.
 * @returns the rendered pages over a zoom bar, or a status line while loading or after a failure.
 */
export function DocxBody(props: OfficeBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const data = bytesOf(props)
  const viewport = useRef<HTMLDivElement | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<RenderState>()
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState<number>(100)
  // Fit-to-width follows pane resizes until the reader picks a zoom.
  const autoFit = useRef(true)
  const { t, scrollportRef } = props
  const bindViewport = useCallback((node: HTMLDivElement | null): void => {
    viewport.current = node
    scrollportRef(node)
  }, [scrollportRef])
  const fit = useCallback((): void => {
    const percent = fitPercent(viewport.current as HTMLDivElement, wrap.current as HTMLDivElement)
    if (percent !== undefined) setZoom(percent)
  }, [])

  useEffect(() => {
    if (data === undefined || tab.signal.aborted) return
    const container = wrap.current as HTMLDivElement
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, tab.signal])
    setState({ kind: 'loading', data })
    setZoom(100)
    autoFit.current = true
    container.replaceChildren()
    // Images and fonts travel as base64 data URLs: nothing to revoke when the
    // tab closes, and no object URL outlives the container.
    void renderAsync(data, container, undefined, {
      inWrapper: true, ignoreWidth: false, ignoreHeight: false, breakPages: true, ignoreLastRenderedPageBreak: false,
      renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
      useBase64URL: true, experimental: true,
    }).then(
      () => { if (!signal.aborted) setState({ kind: 'ready', data }) },
      () => { if (!signal.aborted) setState({ kind: 'failed', data }) },
    )
    return () => {
      lifetime.abort()
      container.replaceChildren()
    }
  }, [data, tab.signal, attempt])

  const current = state?.data === data ? state : undefined
  const ready = current?.kind === 'ready'
  // The pages are unhidden in this commit; measure them before paint.
  useLayoutEffect(() => { if (ready) fit() }, [ready, fit])

  useEffect(() => {
    if (data === undefined) return
    const box = viewport.current as HTMLDivElement
    const onWheel = (event: WheelEvent): void => {
      if (!event.altKey) return
      event.preventDefault()
      autoFit.current = false
      setZoom(value => clampZoom(value + (event.deltaY < 0 ? DOCX_ZOOM.step : -DOCX_ZOOM.step)))
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    const stopObserving = observeResize(box, () => { if (autoFit.current) fit() })
    return () => {
      box.removeEventListener('wheel', onWheel)
      stopObserving()
    }
  }, [data, fit])

  if (data === undefined) return <Unsupported t={t} />
  return <section className={css.body} data-office-preview="docx">
    <div ref={bindViewport} className={css.viewport} data-docx-viewport>
      {current === undefined || current.kind === 'loading' ? <Loading t={t} /> : null}
      {current?.kind === 'failed' ? <Failed t={t} onRetry={() => { setAttempt(value => value + 1) }} /> : null}
      <div ref={wrap} className={css.pages} style={{ zoom: zoom / 100 }} hidden={!ready} />
    </div>
    <div className={css.zoomBar}>
      <span className={css.zoomHint}>{t('docx.zoomHint')}</span>
      <input
        className={css.zoomRange}
        type="range"
        min={DOCX_ZOOM.min}
        max={DOCX_ZOOM.max}
        step={DOCX_ZOOM.step}
        value={zoom}
        aria-label={t('docx.zoom')}
        onChange={(event) => {
          autoFit.current = false
          setZoom(Number(event.currentTarget.value))
        }}
      />
      <span className={css.zoomValue}>{t('docx.zoomValue', { zoom })}</span>
      <button type="button" className={css.fitWidth} data-docx-fit-width onClick={() => { autoFit.current = true; fit() }}>
        {t('docx.fitWidth')}
      </button>
    </div>
  </section>
}
