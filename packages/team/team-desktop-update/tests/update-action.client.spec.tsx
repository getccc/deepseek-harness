// @vitest-environment jsdom
/**
 * The control's phases as a member meets them: nothing to do renders nothing,
 * an offered release starts the download on one click, a running download
 * shows its percentage and refuses clicks, and a failure invites a retry.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopUpdateState } from '../src/client/desktop-bridge.ts'
import { UpdateAction, type UpdateActionProps } from '../src/client/UpdateAction.tsx'

afterEach(cleanup)

/** Component props over one shell state; `t` echoes its key and parameters. */
function props(state: DesktopUpdateState, overrides: Partial<UpdateActionProps> = {}): UpdateActionProps {
  return {
    wide: true,
    subscribe: () => () => {},
    check: vi.fn().mockResolvedValue(state),
    install: vi.fn().mockResolvedValue(undefined),
    t: (key: string, params?: Record<string, string>) => (
      params === undefined ? key : `${key}:${Object.values(params).join(',')}`
    ),
    ...overrides,
  } as unknown as UpdateActionProps
}

describe('sidebar update control', () => {
  it('renders nothing while the installed build is current or a check is in flight', () => {
    const { container, rerender } = render(<UpdateAction {...props({ phase: 'idle' })} />)
    expect(container.firstChild).toBeNull()
    rerender(<UpdateAction {...props({ phase: 'checking' })} />)
    expect(container.firstChild).toBeNull()
  })

  it('asks the shell on mount, so a page opened after its check still shows the offer', async () => {
    const check = vi.fn().mockResolvedValue({ phase: 'available', version: '2.4.0' })
    render(<UpdateAction {...props({ phase: 'idle' }, { check })} />)
    expect(check).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'available.label' })).toBeTruthy()
  })

  it('starts the download on one click of an offered release', async () => {
    const install = vi.fn().mockResolvedValue(undefined)
    render(<UpdateAction {...props({ phase: 'available', version: '2.4.0' }, { install })} />)
    fireEvent.click(await screen.findByRole('button', { name: 'available.label' }))
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('shows the percentage while downloading and takes no click', async () => {
    const install = vi.fn()
    render(<UpdateAction {...props({ phase: 'installing', version: '2.4.0', percent: 42 }, { install })} />)
    const button = await screen.findByRole('button', { name: 'installing.label' })
    expect(button.hasAttribute('disabled')).toBe(true)
    fireEvent.click(button)
    expect(install).not.toHaveBeenCalled()
  })

  it('offers a retry after a failure, carrying the reason in its label', async () => {
    const check = vi.fn().mockResolvedValue({ phase: 'error', message: 'digest mismatch' })
    render(<UpdateAction {...props({ phase: 'idle' }, { check })} />)
    const button = await screen.findByRole('button', { name: 'error.label' })
    fireEvent.click(button)
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('follows what the shell publishes and stops listening when it leaves', () => {
    const stop = vi.fn()
    let publish: ((state: DesktopUpdateState) => void) | undefined
    const subscribe = (listener: (state: DesktopUpdateState) => void) => {
      publish = listener
      return stop
    }
    const view = render(<UpdateAction {...props({ phase: 'idle' }, { subscribe })} />)
    expect(view.container.firstChild).toBeNull()
    act(() => { publish?.({ phase: 'available', version: '2.4.0' }) })
    expect(screen.getByRole('button', { name: 'available.label' })).toBeTruthy()
    view.unmount()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})
