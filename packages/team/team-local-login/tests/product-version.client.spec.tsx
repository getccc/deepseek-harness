// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProductVersionRow, type ProductVersionRowProps } from '../src/client/ProductVersionRow.tsx'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

/** Direct component props; the version row reads nothing else from the runtime. */
function props(loadProductVersion: () => Promise<string | undefined>): ProductVersionRowProps {
  return {
    loadProductVersion,
    t: (key: string, values?: Record<string, string>) => `${key}:${values?.['version'] ?? ''}`,
  } as ProductVersionRowProps
}

describe('the Settings version row', () => {
  it('shows the version the deployment names instead of the client build version', async () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.1.7-rc.2')
    render(<ProductVersionRow {...props(() => Promise.resolve('1.0.0'))} />)
    expect(await screen.findByText('version.current:1.0.0')).toBeTruthy()
  })

  it('falls back to the client build version when no product version is named or the Runner refuses', async () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.1.7-rc.2')
    render(<ProductVersionRow {...props(() => Promise.resolve(undefined))} />)
    expect(await screen.findByText('version.current:0.1.7-rc.2')).toBeTruthy()
    cleanup()
    render(<ProductVersionRow {...props(() => Promise.reject(new Error('refused')))} />)
    expect(await screen.findByText('version.current:0.1.7-rc.2')).toBeTruthy()
  })

  it('renders nothing before the Runner answers', () => {
    vi.stubEnv('DSH_CLIENT_VERSION', '0.1.7-rc.2')
    const { container } = render(<ProductVersionRow {...props(() => new Promise(() => {}))} />)
    expect(container.textContent).toBe('')
  })
})
