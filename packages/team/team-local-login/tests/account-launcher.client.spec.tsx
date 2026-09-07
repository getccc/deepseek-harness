// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject, NS } from '../src/client/index.ts'
import { AssistantIdentity, type AssistantIdentityProps } from '../src/client/AssistantIdentity.tsx'
import { HeroGreeting, type HeroGreetingProps } from '../src/client/HeroGreeting.tsx'
import {
  accountInitial, TeamAccountLauncher,
  type TeamAccountLauncherInjected, type TeamAccountLauncherProps,
} from '../src/client/TeamAccountLauncher.tsx'

usePinnedBrowserLanguages('zh-CN')
afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

/** Stand in for the Session selection the sign-in landing clears. */
function provideSessions(ctx: Context): { clear: ReturnType<typeof vi.fn> } {
  const sessions = { clear: vi.fn() }
  ctx.provide('sessions', sessions)
  return sessions
}

/** Declare the two slots this plugin fills, without the shells that own them. */
function declare(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.launcher': { kind: 'single', scope: 'root' },
      'conversation.hero.headline': { kind: 'single', scope: 'root' },
      'conversation.chat.assistant-identity': { kind: 'single', scope: 'session' },
    },
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
    provideSessions(ctx)
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
    provideSessions(ctx)
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

describe('landing after a sign-in', () => {
  /** Boot the plugin over one address. */
  async function land(href: string) {
    window.history.replaceState(null, '', href)
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    declare(ctx.get('slots') as SlotRegistry)
    const sessions = provideSessions(ctx)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
    await ctx.plugin({ inject: [...inject], apply }).await()
    return { ctx, sessions }
  }

  it('empties the conversation a member just signed in to, and forgets the mark', async () => {
    // Conversations belong to this computer while the selection is the
    // browser's, so the next member to sign in would arrive inside the
    // previous member's conversation.
    const landed = await land('/app?signed-in=1&workspace=erc')
    expect(landed.sessions.clear).toHaveBeenCalledTimes(1)
    expect(window.location.search).toBe('?workspace=erc')
    await landed.ctx.fiber.dispose()
  })

  it('leaves an ordinary load alone, so a reload keeps what is open', async () => {
    const landed = await land('/app')
    expect(landed.sessions.clear).not.toHaveBeenCalled()
    await landed.ctx.fiber.dispose()
  })
})

describe('the hero greeting', () => {
  /** Greeting props over one account read; `t` echoes the key it is given. */
  function greeting(loadAccount: HeroGreetingProps['loadAccount']): HeroGreetingProps {
    // The renderer-owned global seats are unused by this component.
    return {
      className: 'headline',
      loadAccount,
      signOut: vi.fn(),
      t: (key: string, params?: Record<string, unknown>) => (params === undefined
        ? key
        : `${key}:${String(params['name'])}`),
    } as unknown as HeroGreetingProps
  }

  /** Render the greeting over one account read. */
  function greet(loadAccount: HeroGreetingProps['loadAccount']) {
    return render(<HeroGreeting {...greeting(loadAccount)} />)
  }

  /** Hold the local clock at one wall-clock reading on an ordinary day. */
  function clockAt(hours: number, minutes: number, seconds = 0) {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 2, hours, minutes, seconds))
  }

  it('greets the signed-in member for this part of their day, with the tagline for this half hour', async () => {
    clockAt(10, 0)
    const view = greet(vi.fn().mockResolvedValue({ loginName: 'test1', displayName: '测试一' }))
    await act(async () => {})

    expect(view.container.textContent)
      .toBe('hero.morning.greeting:测试一hero.tagline.1000')
  })

  it('shows 小微 whole above the words, named for readers who cannot see the figure', async () => {
    clockAt(10, 0)
    const view = greet(vi.fn().mockResolvedValue({ loginName: 'test1', displayName: '测试一' }))
    await act(async () => {})

    const figure = view.container.querySelector('img')
    expect(figure?.getAttribute('alt')).toBe('assistant.name')
    expect(figure?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
  })

  it('follows the clock into the next half hour while the conversation stays blank', async () => {
    // A member who opens a blank conversation before the morning gathering
    // and leaves it open should not be greeted by the stretch that has passed.
    clockAt(8, 29, 59)
    const view = greet(vi.fn().mockResolvedValue({ loginName: 'test1', displayName: '测试一' }))
    await act(async () => {})
    expect(view.container.textContent).toBe('hero.earlyMorning.greeting:测试一hero.tagline.0800')

    act(() => { vi.advanceTimersByTime(1_000) })
    expect(view.container.textContent).toBe('hero.morningSong.greeting:测试一hero.tagline.0830')

    // The gathering is one half hour: the next boundary moves both lines.
    act(() => { vi.advanceTimersByTime(30 * 60_000) })
    expect(view.container.textContent).toBe('hero.morning.greeting:测试一hero.tagline.0900')
  })

  it('says nothing until the member is known, and nothing if they cannot be read', async () => {
    // The first line on the page: a name that appears and then changes reads
    // as the wrong member's.
    let settle!: (identity: { loginName: string; displayName: string }) => void
    const pending = greet(() => new Promise((resolve) => { settle = resolve }))
    expect(pending.container.textContent).toBe('')
    settle({ loginName: 'test1', displayName: '测试一' })
    await waitFor(() => { expect(pending.container.textContent).toContain('测试一') })
    cleanup()

    const refused = greet(vi.fn().mockRejectedValue(new Error('unauthorized')))
    await waitFor(() => { expect(refused.container.textContent).toBe('') })
  })

  it('keeps the newer member when a slower read settles after them', async () => {
    // Two reads in flight across a re-registration: the first must not put a
    // name back on the page after a later one has replaced it.
    clockAt(10, 0)
    let settleFirst!: (identity: { loginName: string; displayName: string }) => void
    const view = render(
      <HeroGreeting {...greeting(() => new Promise((resolve) => { settleFirst = resolve }))} />,
    )
    view.rerender(
      <HeroGreeting {...greeting(vi.fn().mockResolvedValue({ loginName: 'test2', displayName: '测试二' }))} />,
    )
    await act(async () => {})
    expect(view.container.textContent).toContain('测试二')

    settleFirst({ loginName: 'test1', displayName: '测试一' })
    await act(async () => {})
    expect(view.container.textContent).toContain('测试二')
  })

  it('fills the headline slot from the same account read as the launcher', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const slots = ctx.get('slots') as SlotRegistry
    declare(slots)
    provideSessions(ctx)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ loginName: 'test1', displayName: '测试一' }),
    }))
    await ctx.plugin({ inject: [...inject], apply }).await()
    const entry = slots.entries('conversation.hero.headline')[0]!
    expect(entry.component).toBe(HeroGreeting)
    expect(entry.locale).toBe(NS)
    const identity = slots.entries('conversation.chat.assistant-identity')[0]!
    expect(identity.component).toBe(AssistantIdentity)
    expect(identity.locale).toBe(NS)
    await ctx.fiber.dispose()
    expect(slots.entries('conversation.hero.headline')).toHaveLength(0)
    expect(slots.entries('conversation.chat.assistant-identity')).toHaveLength(0)
  })

  it('opens a turn with the figure, the name, the role tag, and the clock, the figure silent to a screen reader', () => {
    const view = render(<AssistantIdentity {...{
      turn: 1,
      status: 'running',
      clock: '18:03',
      t: (key: string) => key,
    } as unknown as AssistantIdentityProps} />)
    const figure = view.container.querySelector('img')
    expect(figure?.getAttribute('alt')).toBe('')
    expect(figure?.getAttribute('src')).toMatch(/^data:image\/webp;base64,/)
    expect(view.container.textContent).toBe('assistant.nameassistant.tag18:03')
    expect(view.container.firstElementChild?.getAttribute('data-status')).toBe('running')
    view.unmount()

    const unclocked = render(<AssistantIdentity {...{
      turn: 1,
      status: 'settled',
      t: (key: string) => key,
    } as unknown as AssistantIdentityProps} />)
    expect(unclocked.container.textContent).toBe('assistant.nameassistant.tag')
  })
})
