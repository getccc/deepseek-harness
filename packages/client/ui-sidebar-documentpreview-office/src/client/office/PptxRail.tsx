/** The slide rail beside a deck: one numbered preview per slide, drawn only while it is near the rail's viewport. */
import { useEffect, useRef, type ReactNode } from 'react'
import clsx from 'clsx'
import type { PptxViewer, SlideHandle } from '@aiden0z/pptx-renderer'
import type { OfficeBodyProps } from './body.ts'
import css from './PptxBody.module.css'

/** Rendered width of one preview in CSS px; the rail column in PptxBody.module.css adds its inset. */
export const THUMB_WIDTH = 100

/** Previews are drawn this far outside the rail's viewport, so a scroll rarely meets an empty frame. */
const RAIL_ROOT_MARGIN = '240px 0px'

/** Slide previews for one open deck, with the current slide marked and kept in view. */
export function PptxRail({ viewer, current, onSelect, t }: {
  readonly viewer: PptxViewer
  readonly current: number
  readonly onSelect: (index: number) => void
  readonly t: OfficeBodyProps['t']
}): ReactNode {
  const rail = useRef<HTMLElement>(null)
  const active = useRef<HTMLButtonElement>(null)
  const count = viewer.slideCount

  useEffect(() => {
    const root = rail.current as HTMLElement
    const items = root.querySelectorAll<HTMLElement>('[data-rail-slide]')
    const mounted = new Map<number, SlideHandle>()
    const show = (item: HTMLElement): void => {
      const index = Number(item.dataset.railSlide)
      if (mounted.has(index)) return
      const frame = item.querySelector('[data-slide-frame]') as HTMLElement
      const handle = viewer.renderThumbnailToContainer(index, frame, { width: THUMB_WIDTH })
      if (handle !== null) mounted.set(index, handle)
    }
    const hide = (item: HTMLElement): void => {
      const index = Number(item.dataset.railSlide)
      mounted.get(index)?.dispose()
      mounted.delete(index)
    }
    const disposeAll = (): void => {
      for (const handle of mounted.values()) handle.dispose()
      mounted.clear()
    }
    if (typeof IntersectionObserver === 'undefined') {
      for (const item of items) show(item)
      return disposeAll
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) show(entry.target as HTMLElement)
        else hide(entry.target as HTMLElement)
      }
    }, { root, rootMargin: RAIL_ROOT_MARGIN })
    for (const item of items) observer.observe(item)
    return () => {
      observer.disconnect()
      disposeAll()
    }
  }, [viewer, count])

  // The current item is always rendered, so its ref is bound by this commit.
  useEffect(() => { (active.current as HTMLButtonElement).scrollIntoView({ block: 'nearest' }) }, [current])

  return <nav ref={rail} className={css.rail} aria-label={t('pptx.rail')} data-pptx-rail>
    {Array.from({ length: count }, (_, index) => (
      <button
        key={index}
        type="button"
        ref={index === current ? active : undefined}
        data-rail-slide={index}
        className={clsx(css.thumb, index === current && css.thumbActive)}
        aria-current={index === current}
        aria-label={t('pptx.slide', { index: index + 1 })}
        onClick={() => { onSelect(index) }}
      >
        <span className={css.thumbIndex} aria-hidden="true">{index + 1}</span>
        <span className={css.thumbFrame} data-slide-frame style={{ aspectRatio: `${viewer.slideWidth} / ${viewer.slideHeight}` }} />
      </button>
    ))}
  </nav>
}
