// @vitest-environment jsdom
/** Word rendering into the renderer-owned container, retry, and unsupported content. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DocxBody } from '../src/client/office/DocxBody.tsx'
import { en } from '../src/client/locales.ts'
import { bodyProps, minimalDocx } from './support.client.ts'

afterEach(cleanup)

describe('DocxBody', () => {
  it('lays the document out and reveals the pages once rendered', async () => {
    const view = render(<DocxBody {...bodyProps('memo.docx', await minimalDocx('Hello office'))} />)
    expect(screen.getByRole('status')).toBeTruthy()
    await waitFor(() => { expect(view.container.textContent).toContain('Hello office') })
    const pages = view.container.querySelector('[data-office-preview="docx"] > div')
    expect(pages?.hasAttribute('hidden')).toBe(false)
    expect(screen.queryByRole('status')).toBeNull()
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

  it('refuses text-page content', () => {
    render(<DocxBody {...bodyProps('pages.docx', undefined)} />)
    expect(screen.getByRole('alert').textContent).toBe(en.unsupported)
  })
})
