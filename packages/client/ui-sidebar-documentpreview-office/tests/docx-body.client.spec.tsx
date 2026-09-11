// @vitest-environment jsdom
/** Word rendering into the renderer-owned container, fit-to-width zoom, retry, and unsupported content. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DOCX_ZOOM, DocxBody, clampZoom, fitPercent } from '../src/client/office/DocxBody.tsx'
import { en } from '../src/client/locales.ts'
import { FakeResizeObserver, bodyProps, layout, minimalDocx } from './support.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** A viewport holding a rendered page, with the widths jsdom never lays out. */
function pageDom(viewportWidth: number, pageWidth: number): {
  viewport: HTMLElement
  wrap: HTMLElement
  wrapper: HTMLElement
  page: HTMLElement
} {
  const viewport = document.createElement('div')
  const wrap = document.createElement('div')
  const wrapper = document.createElement('div')
  const page = document.createElement('section')
  wrapper.append(page)
  wrap.append(wrapper)
  viewport.append(wrap)
  document.body.append(viewport)
  layout(viewport, { clientWidth: () => viewportWidth })
  layout(page, { offsetWidth: pageWidth })
  return { viewport, wrap, wrapper, page }
}

describe('fitPercent', () => {
  it('fits the page plus the boxes up to the wrap, and clamps the result', () => {
    const { viewport, wrap, wrapper, page } = pageDom(400, 780)
    wrapper.style.paddingLeft = '10px'
    wrapper.style.paddingRight = '10px'
    expect(fitPercent(viewport, wrap)).toBe(50)
    page.style.marginLeft = '20px'
    wrap.style.borderLeftWidth = '2px'
    wrap.style.borderLeftStyle = 'solid'
    expect(fitPercent(viewport, wrap)).toBe(Math.floor(400 / 822 * 100))
    layout(viewport, { clientWidth: () => 4000 })
    expect(fitPercent(viewport, wrap)).toBe(DOCX_ZOOM.max)
    layout(viewport, { clientWidth: () => 40 })
    expect(fitPercent(viewport, wrap)).toBe(DOCX_ZOOM.min)
    viewport.remove()
  })

  it('has no answer before a page exists or while the boxes have no width', () => {
    const { viewport, wrap, page } = pageDom(400, 0)
    expect(fitPercent(viewport, wrap)).toBeUndefined()
    layout(page, { offsetWidth: 780 })
    layout(viewport, { clientWidth: () => 0 })
    expect(fitPercent(viewport, wrap)).toBeUndefined()
    page.remove()
    layout(viewport, { clientWidth: () => 400 })
    expect(fitPercent(viewport, wrap)).toBeUndefined()
    viewport.remove()
    expect(clampZoom(1000)).toBe(DOCX_ZOOM.max)
  })
})

describe('DocxBody', () => {
  it('lays the document out, fits it to the pane, then follows the reader\'s zoom', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver)
    const scrollportRef = vi.fn()
    const view = render(<DocxBody {...bodyProps('memo.docx', await minimalDocx('Hello office'), undefined, { scrollportRef })} />)
    expect(screen.getByRole('status')).toBeTruthy()
    const viewport = view.container.querySelector('[data-docx-viewport]') as HTMLElement
    expect(scrollportRef).toHaveBeenCalledWith(viewport)
    const observer = FakeResizeObserver.latest
    if (observer === undefined) throw new Error('expected the viewport to observe its size')
    expect(observer.observe).toHaveBeenCalledWith(viewport)
    const pages = viewport.querySelector('[data-docx-viewport] > div') as HTMLElement
    // docx-preview fills the container before it resolves; the pages show once it has.
    await waitFor(() => { expect(pages.hasAttribute('hidden')).toBe(false) })
    expect(view.container.textContent).toContain('Hello office')
    expect(screen.queryByRole('status')).toBeNull()
    const slider = screen.getByRole('slider', { name: en['docx.zoom'] }) as HTMLInputElement

    // jsdom lays nothing out, so the first fit finds no width and keeps 100%.
    expect(slider.value).toBe('100')
    layout(viewport, { clientWidth: () => 400 })
    layout(pages.querySelector('section') as HTMLElement, { offsetWidth: 780 })
    const fitted = fitPercent(viewport, pages) as number
    act(() => { observer.fire() })
    expect(slider.value).toBe(String(fitted))
    expect(pages.style.zoom).toBe(String(fitted / 100))
    expect(view.container.textContent).toContain(`${fitted}%`)

    fireEvent.wheel(viewport, { deltaY: -100 })
    expect(slider.value).toBe(String(fitted))
    fireEvent.wheel(viewport, { altKey: true, deltaY: -100 })
    expect(slider.value).toBe(String(fitted + DOCX_ZOOM.step))
    fireEvent.wheel(viewport, { altKey: true, deltaY: 100 })
    expect(slider.value).toBe(String(fitted))
    act(() => { observer.fire() })
    expect(slider.value).toBe(String(fitted))

    fireEvent.change(slider, { target: { value: '150' } })
    expect(slider.value).toBe('150')
    layout(viewport, { clientWidth: () => 800 })
    act(() => { observer.fire() })
    expect(slider.value).toBe('150')
    fireEvent.click(screen.getByRole('button', { name: en['docx.fitWidth'] }))
    const refitted = fitPercent(viewport, pages) as number
    expect(refitted).toBeGreaterThan(fitted)
    expect(slider.value).toBe(String(refitted))
    layout(viewport, { clientWidth: () => 400 })
    act(() => { observer.fire() })
    expect(slider.value).toBe(String(fitted))

    view.unmount()
    expect(observer.disconnect).toHaveBeenCalled()
    expect(scrollportRef).toHaveBeenLastCalledWith(null)
  })

  it('fails on bytes that are not a package, retries on request, and clears the container on unmount', async () => {
    const view = render(<DocxBody {...bodyProps('broken.docx', new Uint8Array([1, 2, 3]))} />)
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await screen.findByRole('status')
    await screen.findByRole('alert')
    view.unmount()
    expect(view.container.querySelector('[data-office-preview]')).toBeNull()
  })

  it('drops a render that finishes after the tab ended, whichever way it ends', async () => {
    const rendered = render(<DocxBody {...bodyProps('late.docx', await minimalDocx('Late'))} />)
    const failed = render(<DocxBody {...bodyProps('late-broken.docx', new Uint8Array([1, 2, 3]))} />)
    rendered.unmount()
    failed.unmount()
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(document.querySelector('[data-office-preview]')).toBeNull()
  })

  it('refuses text-page content', () => {
    render(<DocxBody {...bodyProps('pages.docx', undefined)} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
    expect(screen.queryByRole('slider')).toBeNull()
  })
})
