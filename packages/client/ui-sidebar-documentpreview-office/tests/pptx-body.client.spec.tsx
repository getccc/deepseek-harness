// @vitest-environment jsdom
/** PowerPoint viewer lifetime: open on bytes, destroy on unmount or a stale open, retry after failure. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { bodyProps } from './support.client.ts'

const open = vi.fn<(input: ArrayBuffer, container: HTMLElement) => Promise<{ destroy: () => void }>>()
vi.mock('@aiden0z/pptx-renderer', () => ({
  PptxViewer: { open: (input: ArrayBuffer, container: HTMLElement) => open(input, container) },
  RECOMMENDED_ZIP_LIMITS: { maxEntries: 1 },
}))
const { PptxBody } = await import('../src/client/office/PptxBody.tsx')

beforeEach(() => { open.mockReset() })
afterEach(cleanup)

describe('PptxBody', () => {
  it('opens the deck inside its container and destroys the viewer on unmount', async () => {
    const destroy = vi.fn()
    open.mockResolvedValue({ destroy })
    const data = new Uint8Array([80, 75, 3, 4])
    const view = render(<PptxBody {...bodyProps('deck.pptx', data)} />)
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
    const [input, container] = open.mock.calls[0]!
    expect(new Uint8Array(input)).toEqual(data)
    expect(container.hasAttribute('hidden')).toBe(false)
    expect(container.closest('[data-office-preview="pptx"]')).not.toBeNull()
    view.unmount()
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('destroys a viewer that opened after the tab ended', async () => {
    const destroy = vi.fn()
    const opened = Promise.withResolvers<{ destroy: () => void }>()
    open.mockReturnValue(opened.promise)
    const controller = new AbortController()
    const view = render(<PptxBody {...bodyProps('late.pptx', new Uint8Array([1]), controller.signal)} />)
    view.unmount()
    opened.resolve({ destroy })
    await waitFor(() => { expect(destroy).toHaveBeenCalledOnce() })
  })

  it('reports a failed open and opens again on retry', async () => {
    open.mockRejectedValueOnce(new Error('not a deck')).mockResolvedValueOnce({ destroy: vi.fn() })
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
