/** PowerPoint presentation: pptx-renderer draws the deck as one scrolling list; a slide rail and previous/next controls move through it. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer'
import { Button, IconChevronLeftOutline14, IconChevronRightOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import { bufferOf, bytesOf, observeResize, type OfficeBodyProps } from './body.ts'
import { PptxRail } from './PptxRail.tsx'
import { Failed, Loading, Unsupported } from './Status.tsx'
import css from './PptxBody.module.css'

/**
 * Stage width, in CSS px, under which the rail is dropped: a pane dragged
 * narrower than the rail plus a readable slide keeps the slides.
 */
export const RAIL_MIN_STAGE_WIDTH = 380

/** Delay before the deck refits to a new width, so one drag resizes the slides once. */
export const REFIT_DELAY_MS = 120

type DeckState =
  | { readonly kind: 'loading'; readonly data: Uint8Array<ArrayBuffer> }
  | { readonly kind: 'ready'; readonly data: Uint8Array<ArrayBuffer>; readonly viewer: PptxViewer }
  | { readonly kind: 'failed'; readonly data: Uint8Array<ArrayBuffer> }

/**
 * Present a PowerPoint deck as one scrolling list of slides fitted to the
 * stage, with a rail of previews on wide panes.
 * @param props - complete bytes and the framework's tab, scrollport, and locale seats.
 * @returns the toolbar and stage, with a status line over the stage while loading or after a failure.
 */
export function PptxBody(props: OfficeBodyProps): ReactNode {
  const { tab } = props.useTabInfo()
  const data = bytesOf(props)
  const host = useRef<HTMLDivElement | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<DeckState>()
  const [attempt, setAttempt] = useState(0)
  const [slide, setSlide] = useState(0)
  const [railFits, setRailFits] = useState(false)
  const { t, scrollportRef } = props
  const bindHost = useCallback((node: HTMLDivElement | null): void => {
    host.current = node
    scrollportRef(node)
  }, [scrollportRef])

  useEffect(() => {
    if (data === undefined || tab.signal.aborted) return
    const container = host.current as HTMLDivElement
    const lifetime = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, tab.signal])
    let viewer: PptxViewer | undefined
    setState({ kind: 'loading', data })
    setSlide(0)
    container.replaceChildren()
    // The zip limits bound what one deck may unpack. The list mounts the slides
    // near the viewport first and tracks the one in view as the reader scrolls;
    // EMF fallbacks that need PDF.js are not bundled.
    void PptxViewer.open(bufferOf(data), container, {
      renderMode: 'list',
      listOptions: { windowed: true, batchSize: 8, initialSlides: 4, overscanViewport: 1.5 },
      scrollContainer: container,
      fitMode: 'contain',
      lazyMedia: true,
      lazySlides: true,
      pdfjs: false,
      signal,
      zipLimits: RECOMMENDED_ZIP_LIMITS,
      onSlideChange: (index) => { if (!signal.aborted) setSlide(index) },
    }).then(
      (opened) => {
        if (signal.aborted) { opened.destroy(); return }
        viewer = opened
        setState({ kind: 'ready', data, viewer: opened })
      },
      () => { if (!signal.aborted) setState({ kind: 'failed', data }) },
    )
    return () => {
      lifetime.abort()
      viewer?.destroy()
      viewer = undefined
      container.replaceChildren()
    }
  }, [data, tab.signal, attempt])

  useEffect(() => {
    if (data === undefined) return
    const box = stage.current as HTMLDivElement
    const measure = (): void => { setRailFits(box.clientWidth >= RAIL_MIN_STAGE_WIDTH) }
    measure()
    return observeResize(box, measure)
  }, [data])

  const current = state?.data === data ? state : undefined
  const viewer = current?.kind === 'ready' ? current.viewer : undefined

  // The renderer sizes each slide to the scroller's width when it mounts, so a
  // resized pane asks it to fit again once the drag settles.
  useEffect(() => {
    if (viewer === undefined) return
    const container = host.current as HTMLDivElement
    let width = container.clientWidth
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopObserving = observeResize(container, () => {
      if (container.clientWidth === width) return
      width = container.clientWidth
      clearTimeout(timer)
      timer = setTimeout(() => { void viewer.setFitMode('contain') }, REFIT_DELAY_MS)
    })
    return () => {
      clearTimeout(timer)
      stopObserving()
    }
  }, [viewer])

  if (data === undefined) return <Unsupported t={t} />
  const count = viewer?.slideCount ?? 0
  const railShown = viewer !== undefined && railFits && count > 0
  const navigate = (index: number): void => {
    const container = host.current as HTMLDivElement
    const wrapper = container.querySelector(`[data-slide-index="${index}"]`)
    if (wrapper === null) return
    container.scrollTop += wrapper.getBoundingClientRect().top - container.getBoundingClientRect().top
    setSlide(index)
  }
  return <section className={css.body} data-office-preview="pptx">
    <div className={css.toolbar}>
      <Button size="sm" icon={<IconChevronLeftOutline14 />} disabled={viewer === undefined || slide <= 0} data-pptx-previous onClick={() => { navigate(slide - 1) }}>
        {t('pptx.previous')}
      </Button>
      <span className={css.position} aria-live="polite" data-pptx-position>
        {viewer === undefined ? null : t('pptx.position', { current: slide + 1, total: count })}
      </span>
      <Button size="sm" icon={<IconChevronRightOutline14 />} disabled={viewer === undefined || slide >= count - 1} data-pptx-next onClick={() => { navigate(slide + 1) }}>
        {t('pptx.next')}
      </Button>
    </div>
    <div ref={stage} className={css.stage} data-pptx-stage>
      {railShown && <PptxRail viewer={viewer} current={slide} onSelect={navigate} t={t} />}
      <div className={clsx(css.deck, railShown && css.deckInset)}>
        <div ref={bindHost} className={css.host} />
        {viewer === undefined && (
          <div className={css.overlay}>
            {current?.kind === 'failed'
              ? <Failed t={t} onRetry={() => { setAttempt(value => value + 1) }} />
              : <Loading t={t} />}
          </div>
        )}
      </div>
    </div>
  </section>
}
