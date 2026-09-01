// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import {
  accountInitial, TeamAccountLauncher,
  type TeamAccountLauncherInjected, type TeamAccountLauncherProps,
} from '../src/client/TeamAccountLauncher.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const COPY = {
  menu: '账户菜单',
  settings: '设置',
  signOut: '退出登录',
  memberFallback: '团队成员',
} as const

type DirectProps = Pick<
  TeamAccountLauncherProps,
  'wide' | 'openSettings' | 'loadAccount' | 'signOut' | 't'
>

/** Direct component props; the renderer-owned global seats are unused here. */
function props(overrides: Partial<DirectProps> = {}): TeamAccountLauncherProps {
  return {
    wide: true,
    openSettings: vi.fn(),
    loadAccount: vi.fn().mockResolvedValue({ loginName: 'alice', displayName: 'Alice' }),
    signOut: vi.fn(),
    t: key => COPY[key as keyof typeof COPY] ?? key,
    ...overrides,
  } as TeamAccountLauncherProps
}

/** Declare the single launcher slot without mounting the complete sidebar shell. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.launcher': { kind: 'single', scope: 'root' } },
  } as never, () => null)
}

describe('Team account launcher', () => {
  it('shows the signed-in member and opens Settings or signs out from the menu', async () => {
    const openSettings = vi.fn()
    const signOut = vi.fn()
    render(<TeamAccountLauncher {...props({ openSettings, signOut })} />)

    await screen.findByText('Alice')
    fireEvent.click(screen.getByRole('button', { name: '账户菜单: Alice' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '设置' }))
    expect(openSettings).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: '账户菜单: Alice' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }))
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('keeps a usable compact avatar when a legacy credential has no identity', async () => {
    const loadAccount = vi.fn().mockRejectedValue(new Error('legacy credential'))
    render(<TeamAccountLauncher {...props({ wide: false, loadAccount })} />)

    await waitFor(() => { expect(loadAccount).toHaveBeenCalledOnce() })
    expect(screen.getByRole('button', { name: '账户菜单: 团队成员' }).getAttribute('title')).toBe('团队成员')
    expect(screen.queryByText('团队成员')).toBeNull()
  })

  it('derives a stable text avatar from Latin, CJK, and blank labels', () => {
    expect(accountInitial(' alice')).toBe('A')
    expect(accountInitial('其 实')).toBe('其')
    expect(accountInitial('   ')).toBe('')
  })
})

describe('Team local-login browser plugin', () => {
  it('registers one localized launcher and reads only the local identity endpoint', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const slots = ctx.get('slots') as SlotRegistry
    declare(slots)
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ loginName: 'alice', displayName: 'Alice' }),
    })
    vi.stubGlobal('fetch', fetch)

    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('settings.launcher')[0]!
    expect(entry.component).toBe(TeamAccountLauncher)
    expect(entry.locale).toBe(NS)
    const injected = (entry.inject as unknown as () => TeamAccountLauncherInjected)()
    await expect(injected.loadAccount()).resolves.toEqual({ loginName: 'alice', displayName: 'Alice' })
    expect(fetch).toHaveBeenCalledWith('/team/account', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    })

    await ctx.fiber.dispose()
  })

  it('rejects refused and malformed identity responses', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    const slots = ctx.get('slots') as SlotRegistry
    declare(slots)
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ loginName: 4 }) })
    vi.stubGlobal('fetch', fetch)
    await ctx.plugin({ inject: [...inject], apply }).await()
    const injected = (slots.entries('settings.launcher')[0]!.inject as unknown as () => TeamAccountLauncherInjected)()

    await expect(injected.loadAccount()).rejects.toThrow('refused with 401')
    await expect(injected.loadAccount()).rejects.toThrow('invalid identity')
    await ctx.fiber.dispose()
  })
})
