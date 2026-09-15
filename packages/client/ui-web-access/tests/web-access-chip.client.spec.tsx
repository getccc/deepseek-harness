// @vitest-environment jsdom
/**
 * WebAccessChip over the `webAccess` projection: nothing renders while the
 * capability is absent or the composition offers no switch; otherwise the
 * chip states the projected value, sends its opposite, and stays until the
 * projection confirms, reporting a refused flip inline.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { WebAccessProjection } from '@deepseek-ai/dsh-tool-web/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { WebAccessChip, type WebAccessChipProps } from '../src/client/WebAccessChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: WebAccessChipProps['t'] = makeTranslate(zh, commonZh)

function setup(
  access: WebAccessProjection | undefined,
  setEnabled = vi.fn((_enabled: boolean) => Promise.resolve<string | null>(null)),
) {
  const store = createSnapshotStore<{ value: WebAccessProjection | undefined }>({ value: access })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const props = { useProjection, setEnabled, t } as unknown as WebAccessChipProps
  const view = render(<WebAccessChip {...props} />)
  return { store, setEnabled, view }
}

const offChip = () => screen.getByRole('button', { name: '联网已关闭，按下开启' })
const onChip = () => screen.getByRole('button', { name: '联网已开启，按下关闭' })

describe('WebAccessChip', () => {
  it('renders nothing for an absent capability or a composition without a switch', () => {
    const absent = setup(undefined)
    expect(absent.view.container.innerHTML).toBe('')
    cleanup()
    const unswitched = setup({ enabled: null })
    expect(unswitched.view.container.innerHTML).toBe('')
  })

  it('states the projected value as a pressed toggle', () => {
    setup({ enabled: false })
    expect(offChip().getAttribute('aria-pressed')).toBe('false')
    expect(offChip().textContent).toBe('联网')
    cleanup()
    setup({ enabled: true })
    expect(onChip().getAttribute('aria-pressed')).toBe('true')
  })

  it('sends the opposite value once and follows the projection', async () => {
    let resolve!: (value: string | null) => void
    const setEnabled = vi.fn((_enabled: boolean) => new Promise<string | null>((done) => { resolve = done }))
    const { store } = setup({ enabled: false }, setEnabled)
    fireEvent.click(offChip())
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(true)
    // Busy until the command settles: a second click sends nothing.
    fireEvent.click(offChip())
    expect(setEnabled).toHaveBeenCalledTimes(1)
    resolve(null)
    store.set({ value: { enabled: true } })
    await waitFor(() => { expect(onChip().getAttribute('aria-pressed')).toBe('true') })
    fireEvent.click(onChip())
    expect(setEnabled).toHaveBeenLastCalledWith(false)
  })

  it('reports a refused flip inline and clears it on the next attempt', async () => {
    const setEnabled = vi.fn((_enabled: boolean) => Promise.resolve<string | null>('Usage: /web [on|off]'))
    setup({ enabled: false }, setEnabled)
    fireEvent.click(offChip())
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('切换联网失败') })
    expect(screen.getByRole('status').getAttribute('title')).toBe('Usage: /web [on|off]')
    setEnabled.mockRejectedValueOnce(new Error('transport lost'))
    fireEvent.click(offChip())
    await waitFor(() => { expect(screen.getByRole('status').getAttribute('title')).toBe('transport lost') })
    setEnabled.mockRejectedValueOnce('offline')
    fireEvent.click(offChip())
    await waitFor(() => { expect(screen.getByRole('status').getAttribute('title')).toBe('offline') })
  })

  it('ignores a settlement or a rejection that lands after unmount', async () => {
    let resolve!: (value: string | null) => void
    const setEnabled = vi.fn((_enabled: boolean) => new Promise<string | null>((done) => { resolve = done }))
    const { view } = setup({ enabled: false }, setEnabled)
    fireEvent.click(offChip())
    view.unmount()
    resolve('late')
    await Promise.resolve()
    expect(view.container.innerHTML).toBe('')
    cleanup()

    let reject!: (reason: unknown) => void
    const failing = vi.fn((_enabled: boolean) => new Promise<string | null>((_done, fail) => { reject = fail }))
    const late = setup({ enabled: true }, failing)
    fireEvent.click(onChip())
    late.view.unmount()
    reject(new Error('late'))
    await Promise.resolve()
    expect(late.view.container.innerHTML).toBe('')
  })
})
