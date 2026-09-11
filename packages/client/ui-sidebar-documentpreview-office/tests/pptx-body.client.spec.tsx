// @vitest-environment jsdom
/** PowerPoint viewer lifetime, slide navigation, the preview rail, and refitting after a resize. */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PptxViewer, SlideHandle, ViewerOptions } from '@aiden0z/pptx-renderer'
import { en } from '../src/client/locales.ts'
import { FakeIntersectionObserver, FakeResizeObserver, bodyProps, layout, stubClientWidth } from './support.client.ts'

const open = vi.fn<(input: ArrayBuffer, container: HTMLElement, options: ViewerOptions) => Promise<PptxViewer>>()
vi.mock('@aiden0z/pptx-renderer', () => ({
  PptxViewer: { open: (input: ArrayBuffer, container: HTMLElement, options: ViewerOptions) => open(input, container, options) },
  RECOMMENDED_ZIP_LIMITS: { maxEntries: 1 },
}))
const { PptxBody, RAIL_MIN_STAGE_WIDTH, REFIT_DELAY_MS } = await import('../src/client/office/PptxBody.tsx')
const { THUMB_WIDTH } = await import('../src/client/office/PptxRail.tsx')

/** A viewer stand-in over `count` slides, with the spies it is built from. */
interface FakeViewer {
  readonly viewer: PptxViewer
  readonly destroy: Mock<() => void>
  readonly setFitMode: Mock<(mode: string) => Promise<void>>
  readonly renderThumbnail: Mock<(index: number, container: HTMLElement, options: { width: number }) => SlideHandle | null>
}

/** @param count - slides in the deck. @param thumbnails - preview handle per slide index. @returns the stand-in. */
function fakeViewer(count: number, thumbnails: (index: number) => SlideHandle | null = () => fakeHandle().handle): FakeViewer {
  const destroy = vi.fn()
  const setFitMode = vi.fn(async () => {})
  const renderThumbnail = vi.fn((index: number) => thumbnails(index))
  const viewer = {
    destroy, slideCount: count, slideWidth: 960, slideHeight: 540, setFitMode, renderThumbnailToContainer: renderThumbnail,
  } as unknown as PptxViewer
  return { viewer, destroy, setFitMode, renderThumbnail }
}

/** @returns a preview handle and its dispose spy. */
function fakeHandle(): { handle: SlideHandle; dispose: Mock<() => void> } {
  const dispose = vi.fn()
  return { handle: { dispose } as unknown as SlideHandle, dispose }
}

function openWith({ viewer }: Pick<FakeViewer, 'viewer'>, wrappers = true): void {
  open.mockImplementation(async (_input, container) => {
    if (wrappers) {
      for (let index = 0; index < viewer.slideCount; index += 1) {
        const wrapper = document.createElement('div')
        wrapper.dataset.slideIndex = String(index)
        container.append(wrapper)
      }
    }
    return viewer
  })
}

const scrollIntoView = vi.fn()

beforeEach(() => {
  open.mockReset()
  scrollIntoView.mockReset()
  FakeResizeObserver.instances = []
  HTMLElement.prototype.scrollIntoView = scrollIntoView
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('PptxBody', () => {
  it('opens the deck, steps through it, follows the renderer\'s tracking, and destroys the viewer on unmount', async () => {
    const { destroy, ...fake } = fakeViewer(3)
    openWith(fake)
    const scrollportRef = vi.fn()
    const data = new Uint8Array([80, 75, 3, 4])
    const view = render(<PptxBody {...bodyProps('deck.pptx', data, undefined, { scrollportRef })} />)
    expect(screen.getByRole('status')).toBeTruthy()
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
    const [input, container, options] = open.mock.calls[0]!
    expect(new Uint8Array(input)).toEqual(data)
    expect(container.closest('[data-office-preview="pptx"]')).not.toBeNull()
    expect(options.scrollContainer).toBe(container)
    expect(scrollportRef).toHaveBeenCalledWith(container)
    const position = view.container.querySelector('[data-pptx-position]') as HTMLElement
    const previous = screen.getByRole('button', { name: en['pptx.previous'] }) as HTMLButtonElement
    const next = screen.getByRole('button', { name: en['pptx.next'] }) as HTMLButtonElement
    expect(position.textContent).toBe('1 / 3')
    expect(previous.disabled).toBe(true)
    fireEvent.click(next)
    expect(position.textContent).toBe('2 / 3')
    expect(previous.disabled).toBe(false)
    act(() => { options.onSlideChange?.(2) })
    expect(position.textContent).toBe('3 / 3')
    expect(next.disabled).toBe(true)
    fireEvent.click(previous)
    expect(position.textContent).toBe('2 / 3')
    // jsdom lays nothing out, so the stage is too narrow for the rail.
    expect(view.container.querySelector('[data-pptx-rail]')).toBeNull()
    view.unmount()
    expect(destroy).toHaveBeenCalledOnce()
    expect(scrollportRef).toHaveBeenLastCalledWith(null)
  })

  it('stays on the slide when the renderer has not mounted the target', async () => {
    openWith(fakeViewer(2), false)
    const view = render(<PptxBody {...bodyProps('sparse.pptx', new Uint8Array([1]))} />)
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: en['pptx.next'] }))
    expect(view.container.querySelector('[data-pptx-position]')?.textContent).toBe('1 / 2')
  })

  it('shows the rail on a wide stage and draws previews as they come into view', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    let stageWidth = RAIL_MIN_STAGE_WIDTH
    const restoreWidth = stubClientWidth(() => stageWidth)
    const disposers = new Map<number, Mock<() => void>>()
    const { renderThumbnail, ...fake } = fakeViewer(3, (index) => {
      if (index === 2) return null
      const { handle, dispose } = fakeHandle()
      disposers.set(index, dispose)
      return handle
    })
    openWith(fake)
    try {
      const view = render(<PptxBody {...bodyProps('deck.pptx', new Uint8Array([1]))} />)
      await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
      const rail = view.container.querySelector('[data-pptx-rail]') as HTMLElement
      const items = rail.querySelectorAll<HTMLElement>('[data-rail-slide]')
      expect(items).toHaveLength(3)
      expect(items[0]?.getAttribute('aria-current')).toBe('true')
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
      const intersections = FakeIntersectionObserver.latest
      if (intersections === undefined) throw new Error('expected the rail to observe its items')
      expect(intersections.options?.root).toBe(rail)
      expect(intersections.observed).toEqual([...items])
      expect(renderThumbnail).not.toHaveBeenCalled()

      intersections.fire(items[0]!, true)
      expect(renderThumbnail).toHaveBeenCalledWith(0, items[0]!.querySelector('[data-slide-frame]'), { width: THUMB_WIDTH })
      intersections.fire(items[0]!, true)
      expect(renderThumbnail).toHaveBeenCalledTimes(1)
      intersections.fire(items[2]!, true)
      expect(renderThumbnail).toHaveBeenCalledTimes(2)
      intersections.fire(items[1]!, false)
      intersections.fire(items[0]!, false)
      expect(disposers.get(0)).toHaveBeenCalledOnce()
      intersections.fire(items[0]!, true)
      expect(renderThumbnail).toHaveBeenCalledTimes(3)

      fireEvent.click(screen.getByRole('button', { name: 'Slide 2' }))
      expect(view.container.querySelector('[data-pptx-position]')?.textContent).toBe('2 / 3')
      expect(items[1]?.getAttribute('aria-current')).toBe('true')

      stageWidth = RAIL_MIN_STAGE_WIDTH - 1
      const stageObserver = FakeResizeObserver.watching(view.container.querySelector('[data-pptx-stage]') as Element)
      if (stageObserver === undefined) throw new Error('expected the stage to observe its size')
      act(() => { stageObserver.fire() })
      expect(view.container.querySelector('[data-pptx-rail]')).toBeNull()
      expect(intersections.disconnect).toHaveBeenCalled()
      // The preview drawn again after leaving and re-entering is the one released with the rail.
      expect(disposers.get(0)).toHaveBeenCalledOnce()
    } finally {
      restoreWidth()
    }
  })

  it('draws every preview at once where IntersectionObserver is missing, and keeps the rail off an empty deck', async () => {
    const restoreWidth = stubClientWidth(() => RAIL_MIN_STAGE_WIDTH + 100)
    const { handle, dispose } = fakeHandle()
    const { renderThumbnail, ...fake } = fakeViewer(2, () => handle)
    openWith(fake)
    try {
      const view = render(<PptxBody {...bodyProps('deck.pptx', new Uint8Array([1]))} />)
      await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
      expect(renderThumbnail).toHaveBeenCalledTimes(2)
      view.unmount()
      expect(dispose).toHaveBeenCalledTimes(2)

      openWith(fakeViewer(0))
      const empty = render(<PptxBody {...bodyProps('empty.pptx', new Uint8Array([2]))} />)
      await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
      expect(empty.container.querySelector('[data-pptx-rail]')).toBeNull()
    } finally {
      restoreWidth()
    }
  })

  it('refits the slides once a resize settles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const { setFitMode, ...fake } = fakeViewer(1)
    openWith(fake)
    const view = render(<PptxBody {...bodyProps('deck.pptx', new Uint8Array([1]))} />)
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
    const [, container] = open.mock.calls[0]!
    // The host observer is created after the deck opens, so it is the latest.
    const observer = FakeResizeObserver.latest
    if (observer === undefined) throw new Error('expected the host to observe its size')
    expect(observer.observe).toHaveBeenCalledWith(container)
    let width = 0
    layout(container, { clientWidth: () => width })
    act(() => { observer.fire() })
    act(() => { vi.advanceTimersByTime(REFIT_DELAY_MS) })
    expect(setFitMode).not.toHaveBeenCalled()
    width = 300
    act(() => { observer.fire() })
    width = 320
    act(() => { observer.fire() })
    expect(setFitMode).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(REFIT_DELAY_MS) })
    expect(setFitMode).toHaveBeenCalledExactlyOnceWith('contain')
    width = 340
    act(() => { observer.fire() })
    view.unmount()
    act(() => { vi.advanceTimersByTime(REFIT_DELAY_MS) })
    expect(setFitMode).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('destroys a viewer that opened after the tab ended and ignores its later reports', async () => {
    const { viewer, destroy } = fakeViewer(1)
    const opened = Promise.withResolvers<PptxViewer>()
    open.mockReturnValue(opened.promise)
    const controller = new AbortController()
    const view = render(<PptxBody {...bodyProps('late.pptx', new Uint8Array([1]), controller.signal)} />)
    const [, , options] = open.mock.calls[0]!
    view.unmount()
    opened.resolve(viewer)
    await waitFor(() => { expect(destroy).toHaveBeenCalledOnce() })
    expect(() => { options.onSlideChange?.(1) }).not.toThrow()
  })

  it('drops a failure that arrives after the tab ended', async () => {
    const opened = Promise.withResolvers<PptxViewer>()
    open.mockReturnValue(opened.promise)
    const view = render(<PptxBody {...bodyProps('late-broken.pptx', new Uint8Array([1]))} />)
    view.unmount()
    opened.reject(new Error('not a deck'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('reports a failed open and opens again on retry', async () => {
    open.mockRejectedValueOnce(new Error('not a deck')).mockResolvedValueOnce(fakeViewer(1).viewer)
    render(<PptxBody {...bodyProps('broken.pptx', new Uint8Array([1]))} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('refuses text-page content', () => {
    render(<PptxBody {...bodyProps('pages.pptx', undefined)} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
    expect(open).not.toHaveBeenCalled()
  })
})
