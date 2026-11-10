// @vitest-environment jsdom
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ShortcutCatalogEntry, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Menu, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { allowAllAccess, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type {
  SidebarFooterActionOwnerProps, SidebarPanelMetadata, SidebarRootComponentProps, SidebarSectionOwnerProps,
  SidebarSettingsOwnerProps,
} from '../src/client/contract/slots.ts'
import { HeaderLeadingControls, type HeaderLeadingControlsProps } from '../src/client/HeaderLeadingControls.tsx'
import { SidebarRoot } from '../src/client/SidebarRoot.tsx'
import { en } from '../src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

const t: SidebarRootComponentProps['t'] = makeTranslate({ ...commonEn, ...en })

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.platform
  vi.unstubAllEnvs()
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'clipboard')
})

// The shell never reads the global hooks itself, but they ride the standard
// props share; stub them as never-called functions.
const neverHook = (() => { throw new Error('shell must not read global hooks') }) as never
type AttentionSnapshot = Parameters<Parameters<SidebarRootComponentProps['useSessionStatus']>[0]>[0]
const noAttention: AttentionSnapshot = new Map()
const useSessionStatus: SidebarRootComponentProps['useSessionStatus'] = selector => selector(noAttention)

function makeHeaderProps(): HeaderLeadingControlsProps {
  return {
    useContextMenu: contextMenuHook(),
    useSessions: neverHook, useSessionStatus, useSessionRetainInfo: neverHook,
    usePanelInfo, useResource, useWorkspaces: neverHook, ...allowAllAccess,
    usePanels: selector => selector([]), useShortcuts: selector => selector([]),
    useEntryPins: selector => selector([]), useEntryActions: selector => selector(false),
    selectPanel: vi.fn(), setPinned: vi.fn(), toggleSidebar: vi.fn(),
    startSession: vi.fn(), startChat: vi.fn(), trackEntryClick: vi.fn(), t,
  }
}

function mountShell({ collapsed = false, width = 300, drawer = false, shortcuts = [], panels = [], content }: {
  collapsed?: boolean
  width?: number
  drawer?: boolean
  shortcuts?: readonly ShortcutCatalogEntry[]
  panels?: readonly SidebarPanelMetadata[]
  content?: ReactNode
} = {}) {
  const startSession = vi.fn()
  const startChat = vi.fn()
  const toggleSidebar = vi.fn()
  const trackEntryClick = vi.fn<SidebarRootComponentProps['trackEntryClick']>()
  let regionOwner: SidebarSectionOwnerProps | undefined
  let recentOwner: SidebarSectionOwnerProps | undefined
  let settingsOwner: SidebarSettingsOwnerProps | undefined
  let footerActionOwner: SidebarFooterActionOwnerProps | undefined
  const brandMark = <span data-testid="custom-brand-mark">M</span>
  const brandName = <span data-testid="custom-brand-name">Custom Brand</span>
  let current = { collapsed, width, drawer }
  const root = () => (
    <SidebarRoot renderFactorySlot={() => null}
      drawer={current.drawer}
      collapsed={current.collapsed} width={current.width}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector(panels)} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector(shortcuts)}
      useContextMenu={contextMenuHook()} useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={startSession} startChat={startChat} toggleSidebar={toggleSidebar} trackEntryClick={trackEntryClick} t={t}
      renderSlot={((
        key: string,
        owner: SidebarFooterActionOwnerProps | SidebarSectionOwnerProps | SidebarSettingsOwnerProps,
      ) => {
        if (key === 'sidebar.brand.mark') return brandMark
        if (key === 'sidebar.brand.name') return brandName
        if (key === 'sidebar.toggle.badge') return null
        if (key === 'sidebar.recent') {
          recentOwner = owner as SidebarSectionOwnerProps
          return <div data-testid="recent" data-wide={owner.wide} />
        }
        if (key === 'sidebar.settings') {
          settingsOwner = owner
          return <div data-testid="settings-seat" data-wide={owner.wide} />
        }
        if (key === 'sidebar.footer.action') {
          footerActionOwner = owner
          return <div data-testid="footer-action-seat" data-wide={owner.wide} />
        }
        regionOwner = owner as SidebarSectionOwnerProps
        return <div data-testid="region" data-wide={owner.wide}>{content}</div>
      }) as SidebarRootComponentProps['renderSlot']}
    />
  )
  const view = render(root())
  return {
    startSession,
    startChat,
    toggleSidebar,
    trackEntryClick,
    regionOwner: () => {
      if (regionOwner === undefined) throw new Error('region owner not rendered')
      return regionOwner
    },
    recentOwner: () => {
      if (recentOwner === undefined) throw new Error('recent owner not rendered')
      return recentOwner
    },
    settingsOwner: () => {
      if (settingsOwner === undefined) throw new Error('settings owner not rendered')
      return settingsOwner
    },
    footerActionOwner: () => {
      if (footerActionOwner === undefined) throw new Error('footer action owner not rendered')
      return footerActionOwner
    },
    rerender(next: Partial<typeof current>) {
      current = { ...current, ...next }
      view.rerender(root())
    },
  }
}

describe('SidebarRoot shell', () => {
  it('advertises the effective new-session binding on New work task', () => {
    const shortcut: ShortcutCatalogEntry = { id: 'session.new' as ShortcutCommandId, label: 'New', aliases: [],
      binding: null, modified: true, conflicts: [], issue: null, keys: ['Ctrl', 'N'], aria: 'Control+N' }
    mountShell({ shortcuts: [shortcut] })
    // Both work-task starters (wordmark + entry) announce the binding; New chat has none.
    const starters = screen.getAllByRole('button', { name: 'New work task' })
    expect(starters).toHaveLength(2)
    for (const button of starters) expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+N')
    expect(screen.getByRole('button', { name: 'New chat' }).hasAttribute('aria-keyshortcuts')).toBe(false)
    cleanup()
    // The rail entry's tooltip shows the keycaps.
    mountShell({ collapsed: true, shortcuts: [shortcut] })
    fireEvent.focus(screen.getByRole('button', { name: 'New work task' }))
    expect(Array.from(screen.getByRole('tooltip').querySelectorAll('kbd'), key => key.textContent)).toEqual(['Ctrl', 'N'])
    cleanup()
    document.documentElement.dataset.platform = 'darwin'
    render(<HeaderLeadingControls toggleSidebar={vi.fn()} startSession={vi.fn()} startChat={vi.fn()} selectPanel={vi.fn()}
      trackEntryClick={vi.fn()} t={t}
      usePanelInfo={neverHook} useSessions={neverHook} useSessionStatus={neverHook}
      useSessionRetainInfo={neverHook} useContextMenu={contextMenuHook()} useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      usePanels={select => select([])} useEntryPins={select => select([])}
      useEntryActions={select => select(false)} setPinned={vi.fn()} useShortcuts={select => select([shortcut])} />)
    const button = screen.getByRole('button', { name: 'New work task' })
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+N')
    fireEvent.focus(button)
    expect(Array.from(screen.getByRole('tooltip').querySelectorAll('kbd'), key => key.textContent)).toEqual(['Ctrl', 'N'])
  })
  it('routes New chat, New work task (row + wordmark), and the column toggle', () => {
    const b = mountShell()
    expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
    expect(screen.getByTestId('custom-brand-name')).toBeTruthy()
    // Expanded, both the wordmark and the work row start a work Session.
    const starters = screen.getAllByRole('button', { name: 'New work task' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    expect(b.startChat).not.toHaveBeenCalled()
    // Each work-task start reports a sidebar New Session click first; New chat reports none.
    expect(b.trackEntryClick.mock.calls).toEqual([
      [{ menu_name: 'new_session', position: 'sidebar' }],
      [{ menu_name: 'new_session', position: 'sidebar' }],
    ])
    expect(b.trackEntryClick.mock.invocationCallOrder[0]).toBeLessThan(b.startSession.mock.invocationCallOrder[0]!)
    // The work row precedes the chat row; each keeps its own action.
    const chat = screen.getByRole('button', { name: 'New chat' })
    expect(chat.textContent).toBe('New chat')
    expect(starters[1]!.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(chat)
    expect(b.startChat).toHaveBeenCalledOnce()
    expect(b.startSession).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
    expect(b.trackEntryClick).toHaveBeenCalledTimes(2)
  })

  it('reports the collapsed rail New work task as a sidebar click outside the Windows caption', () => {
    const b = mountShell({ collapsed: true, width: 56 })
    fireEvent.click(screen.getByRole('button', { name: 'New work task' }))
    expect(b.startSession).toHaveBeenCalledOnce()
    expect(b.trackEntryClick).toHaveBeenCalledExactlyOnceWith({ menu_name: 'new_session', position: 'sidebar' })
  })

  it('renders the product name alone when no package fills the brand slots', () => {
    vi.stubEnv('DSH_CLIENT_COMMIT_HASH', '0123456')
    vi.stubEnv('DSH_CLIENT_GIT_DIRTY', 'true')
    vi.stubEnv('DSH_CLIENT_VERSION', '1.2.3-rc.4')
    const { container } = render(<SidebarRoot renderFactorySlot={() => null}
      drawer={false}
      collapsed={false} width={300}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector([])}
      useContextMenu={contextMenuHook()} useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={vi.fn()} startChat={vi.fn()} toggleSidebar={vi.fn()} trackEntryClick={vi.fn()} t={t}
      renderSlot={((_key: string, _owner: unknown, options?: { fallback?: ReactNode }) =>
        options?.fallback ?? null) as SidebarRootComponentProps['renderSlot']}
    />)

    const [brand] = screen.getAllByRole('button', { name: 'New work task' })
    expect(brand?.textContent).toBe('WeWork')
    expect(container.querySelector('img')).not.toBeNull()
  })

  it('hands both regions their wide flag and clamps expandSidebar to the collapsed state', () => {
    const b = mountShell()
    expect(b.regionOwner().wide).toBe(true)
    // The Recent list rides the same owner share below the tree.
    expect(b.recentOwner().wide).toBe(true)
    const region = screen.getByTestId('region')
    const recent = screen.getByTestId('recent')
    expect(region.parentElement).toBe(recent.parentElement)
    expect(region.compareDocumentPosition(recent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    b.recentOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
    // The settings seat rides the same wide flag (ui-settings renders the row).
    expect(b.settingsOwner().wide).toBe(true)
    expect(b.footerActionOwner().wide).toBe(true)
    // Expanded: the request is a no-op (no accidental collapse).
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).not.toHaveBeenCalled()
  })

  it('keeps the region mounted through collapse and expands on its request', () => {
    vi.useFakeTimers()
    const b = mountShell()
    b.rerender({ collapsed: true })
    // Wide content survives the crossfade window, then settles into the rail.
    expect(b.regionOwner().wide).toBe(true)
    vi.advanceTimersByTime(200)
    b.rerender({})
    expect(b.regionOwner().wide).toBe(false)
    expect(b.recentOwner().wide).toBe(false)
    expect(b.footerActionOwner().wide).toBe(false)
    expect(screen.getByTestId('region')).toBeTruthy()
    // Rail entries keep only their accessible names.
    expect(screen.getByRole('button', { name: 'New chat' }).textContent).toBe('')
    b.regionOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledOnce()
    b.recentOwner().expandSidebar()
    expect(b.toggleSidebar).toHaveBeenCalledTimes(2)
  })

  it('renders statically collapsed on a cold start (no crossfade classes)', () => {
    const b = mountShell({ collapsed: true })
    expect(b.regionOwner().wide).toBe(false)
    expect(screen.getByRole('button', { name: 'Open sidebar' })).toBeTruthy()
  })

  it.each([false, true])('returns directly from a closed drawer to the compact layout (previously opened: %s)', (opened) => {
    vi.useFakeTimers()
    const b = mountShell({ drawer: true, collapsed: !opened, width: 280 })
    if (opened) b.rerender({ collapsed: true })
    b.rerender({ drawer: false, collapsed: true, width: 56 })
    expect(b.regionOwner().wide).toBe(false)
    expect(b.settingsOwner().wide).toBe(false)
    expect(screen.getAllByRole('button', { name: 'New work task' })).toHaveLength(1)
    const root = screen.getByTestId('region').closest<HTMLElement>('[class*="root"]')!
    expect(root.style.width).toBe('')
    expect(root.className).not.toMatch(/fading|railIn/)
  })

  it('shows only the badge bubble while the rail badge is hovered inside the toggle', () => {
    vi.useFakeTimers()
    render(<SidebarRoot renderFactorySlot={() => null}
      drawer={false}
      collapsed width={56}
      useSessions={neverHook} useSessionStatus={useSessionStatus} useSessionRetainInfo={neverHook}
      usePanelInfo={usePanelInfo} selectPanel={() => {}} usePanels={selector => selector([])} useEntryPins={selector => selector([])}
      useEntryActions={selector => selector(false)} setPinned={vi.fn()}
      useShortcuts={selector => selector([])}
      useContextMenu={contextMenuHook()} useResource={useResource} useWorkspaces={neverHook}
      {...allowAllAccess}
      startSession={vi.fn()} startChat={vi.fn()} toggleSidebar={vi.fn()} trackEntryClick={vi.fn()} t={t}
      renderSlot={((key: string) => key === 'sidebar.toggle.badge'
        ? <Tooltip label="Update — V1.2.3"><span data-testid="badge" /></Tooltip>
        : null) as SidebarRootComponentProps['renderSlot']}
    />)
    const toggle = screen.getByRole('button', { name: 'Open sidebar' })
    fireEvent.pointerEnter(toggle)
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getByRole('tooltip').textContent).toBe('Open sidebar')
    // The badge's own bubble replaces the toggle's rather than stacking on it,
    // even after the toggle's longer hover delay has elapsed.
    fireEvent.pointerEnter(screen.getByTestId('badge'))
    act(() => { vi.advanceTimersByTime(500) })
    expect(screen.getAllByRole('tooltip').map(bubble => bubble.textContent)).toEqual(['Update — V1.2.3'])
    fireEvent.pointerLeave(screen.getByTestId('badge'), { relatedTarget: toggle })
    expect(screen.getByRole('tooltip').textContent).toBe('Open sidebar')
    fireEvent.pointerLeave(toggle)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

it('keeps the macOS sidebar toggle in its top strip', () => {
  document.documentElement.dataset.platform = 'darwin'
  const shell = mountShell()
  fireEvent.click(screen.getByRole('button', { name: en['toggle.collapse'] }))
  expect(shell.toggleSidebar).toHaveBeenCalledOnce()
  // The brand stays part of the logo row's window-drag surface: no button
  // role (the global no-drag rule would subtract it); only the New work task
  // entry starts a work Session.
  expect(screen.getAllByRole('button', { name: 'New work task' })).toHaveLength(1)
  expect(screen.getByTestId('custom-brand-mark')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'New work task' }))
  expect(shell.trackEntryClick).toHaveBeenCalledExactlyOnceWith({ menu_name: 'new_session', position: 'sidebar' })
})

it('wires the shell.leading controls to the shared sidebar actions', () => {
  document.documentElement.dataset.platform = 'darwin'
  const toggleSidebar = vi.fn()
  const startSession = vi.fn()
  const startChat = vi.fn()
  const trackEntryClick = vi.fn<HeaderLeadingControlsProps['trackEntryClick']>()
  // This occupant only consumes its three actions, the shortcut catalog, and locale, not Session hooks.
  const props = { toggleSidebar, startChat, startSession, trackEntryClick, t, useRemoteAccess: allowAllAccess.useRemoteAccess, useShortcuts: select => select([{ id: 'sidebar.left.toggle' as ShortcutCommandId, label: 'Toggle sidebar', aliases: [], binding: null, modified: false, conflicts: [], issue: null, keys: ['⌘', 'B'], aria: 'Meta+B' }]) } as HeaderLeadingControlsProps
  render(<HeaderLeadingControls {...props} />)
  fireEvent.click(screen.getByRole('button', { name: en['toggle.open'] }))
  fireEvent.click(screen.getByRole('button', { name: en['chat.new.label'] }))
  expect(toggleSidebar).toHaveBeenCalledOnce()
  expect(startChat).toHaveBeenCalledOnce()
  expect(trackEntryClick).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en['work.new.label'] }))
  expect(startSession).toHaveBeenCalledOnce()
  // The window-chrome New work task control reports a titlebar click before starting the Session.
  expect(trackEntryClick).toHaveBeenCalledExactlyOnceWith({ menu_name: 'new_session', position: 'titlebar' })
  expect(trackEntryClick.mock.invocationCallOrder[0]).toBeLessThan(startSession.mock.invocationCallOrder[0]!)
  cleanup()

  // A page whose access snapshot excludes starting a Session keeps only the sidebar toggle.
  render(<HeaderLeadingControls {...props} useRemoteAccess={action => action !== 'session/create'} />)
  expect(screen.getByRole('button', { name: en['toggle.open'] })).toBeTruthy()
  expect(screen.queryByRole('button', { name: en['work.new.label'] })).toBeNull()
})

it.each([undefined, 'darwin', 'win32'] as const)('shows the collapsed-header New Session control only on Desktop (%s)', (platform) => {
  if (platform !== undefined) document.documentElement.dataset.platform = platform
  const props = makeHeaderProps()
  render(<HeaderLeadingControls {...props} />)
  expect(screen.getByRole('button', { name: en['toggle.open'] })).toBeTruthy()
  expect(screen.queryByRole('button', { name: en['work.new.label'] }) !== null).toBe(platform !== undefined)
})

describe('Windows caption New work task analytics', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-windows-titlebar') })

  it('reports the collapsed caption New work task as a titlebar click', () => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    const b = mountShell({ collapsed: true, width: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'New work task' }))
    expect(b.startSession).toHaveBeenCalledOnce()
    expect(b.trackEntryClick).toHaveBeenCalledExactlyOnceWith({ menu_name: 'new_session', position: 'titlebar' })
  })

  it('reports the expanded brand and New work task entry as sidebar clicks', () => {
    document.documentElement.setAttribute('data-windows-titlebar', '')
    const b = mountShell()
    const starters = screen.getAllByRole('button', { name: 'New work task' })
    expect(starters).toHaveLength(2)
    for (const button of starters) fireEvent.click(button)
    expect(b.startSession).toHaveBeenCalledTimes(2)
    expect(b.trackEntryClick.mock.calls).toEqual([
      [{ menu_name: 'new_session', position: 'sidebar' }],
      [{ menu_name: 'new_session', position: 'sidebar' }],
    ])
  })
})

describe('Windows caption tooltips', () => {
  afterEach(() => { document.documentElement.removeAttribute('data-windows-titlebar') })

  const hover = (button: HTMLElement): void => {
    fireEvent.pointerEnter(button)
    act(() => { vi.advanceTimersByTime(500) })
  }

  it.each([false, true])(
    'drops the sidebar toggle bubble below the caption (collapsed=%s)',
    (collapsed) => {
      vi.useFakeTimers()
      document.documentElement.setAttribute('data-windows-titlebar', '')
      mountShell({ collapsed, width: collapsed ? 0 : 300 })
      hover(screen.getByRole('button', { name: collapsed ? 'Open sidebar' : 'Collapse sidebar' }))
      expect(screen.getByRole('tooltip').getAttribute('data-side')).toBe('bottom')
    },
  )

  it('keeps the ordinary Web bubble beside its anchor', () => {
    vi.useFakeTimers()
    mountShell({ collapsed: true, width: 0 })
    hover(screen.getByRole('button', { name: 'Open sidebar' }))
    expect(screen.getByRole('tooltip').getAttribute('data-side')).toBe('right')
  })
})

it('uses the same effective sidebar binding for hover/focus hints and ARIA', () => {
  const shortcut = { id: 'sidebar.left.toggle' as ShortcutCommandId, label: 'Toggle sidebar', aliases: [], binding: null, modified: false, conflicts: [], issue: null, keys: ['⌘', 'B'], aria: 'Meta+B' }
  mountShell({ shortcuts: [shortcut] })
  const toggle = screen.getByRole('button', { name: en['toggle.collapse'] })
  expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Meta+B')
  fireEvent.focus(toggle)
  expect(Array.from(screen.getByRole('tooltip').querySelectorAll('kbd'), key => key.textContent)).toEqual(['⌘', 'B'])
})

it('retains drawer content through close and restores focus without entering an editor', () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  try {
    opener.focus()
    expect(document.activeElement).toBe(opener)
    const h = mountShell({ drawer: true })
    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('data-shortcut-modal')).toBe('sidebar')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(dialog.contains(document.activeElement)).toBe(true)
    const region = screen.getByTestId('region')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(h.toggleSidebar).toHaveBeenCalledOnce()
    h.rerender({ collapsed: true })
    expect(dialog.hasAttribute('aria-modal')).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(screen.getByTestId('region')).toBe(region)
    expect(h.regionOwner().wide).toBe(true)
  } finally {
    opener.remove()
  }
})

it('moves focus into the drawer from a focused SVG element', () => {
  const opener = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  opener.setAttribute('tabindex', '0')
  document.body.append(opener)
  try {
    opener.focus()
    expect(document.activeElement).toBe(opener)
    mountShell({ drawer: true })
    expect(screen.getByRole('dialog', { name: 'Navigation' }).contains(document.activeElement)).toBe(true)
  } finally {
    opener.remove()
  }
})

it('keeps focus in a foreground dialog when the drawer closes behind it', () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  try {
    opener.focus()
    const h = mountShell({ drawer: true })
    render(<Modal open headless title="Settings" onClose={vi.fn()}><button>Settings control</button></Modal>)
    const control = screen.getByRole('button', { name: 'Settings control' })
    expect(document.activeElement).toBe(control)
    h.rerender({ collapsed: true })
    expect(document.activeElement).toBe(control)
  } finally {
    opener.remove()
  }
})

it('moves focus to the rail toggle when the drawer opener unmounts', () => {
  vi.useFakeTimers()
  const opener = document.createElement('button')
  document.body.append(opener)
  try {
    opener.focus()
    const h = mountShell({ drawer: true })
    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    opener.remove()
    h.rerender({ drawer: false, collapsed: true, width: 56 })
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getAllByRole('button', { name: 'New work task' })).toHaveLength(1)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open sidebar' }))
  } finally {
    opener.remove()
  }
})

it('moves focus from drawer search to the rail toggle before wide content unmounts', () => {
  vi.useFakeTimers()
  const h = mountShell({ drawer: true, content: <input aria-label="Search" /> })
  screen.getByRole('textbox', { name: 'Search' }).focus()
  h.rerender({ drawer: false, collapsed: true, width: 56 })
  act(() => { vi.advanceTimersByTime(150) })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open sidebar' }))
})

it.each(['dialog', 'outside'] as const)('preserves %s focus when a drawer becomes a rail without its opener', (destination) => {
  vi.useFakeTimers()
  const opener = document.createElement('button')
  const outside = document.createElement('button')
  document.body.append(opener, outside)
  try {
    opener.focus()
    const h = mountShell({ drawer: true })
    let control: HTMLElement = outside
    if (destination === 'dialog') {
      render(<Modal open headless title="Settings" onClose={vi.fn()}><button>Settings control</button></Modal>)
      control = screen.getByRole('button', { name: 'Settings control' })
    } else {
      outside.focus()
    }
    expect(document.activeElement).toBe(control)
    opener.remove()
    h.rerender({ drawer: false, collapsed: true, width: 56 })
    act(() => { vi.advanceTimersByTime(150) })
    expect(document.activeElement).toBe(control)
  } finally {
    opener.remove()
    outside.remove()
  }
})

it('closes a drawer opened from a focused SVG element', () => {
  const opener = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  opener.setAttribute('tabindex', '0')
  document.body.append(opener)
  try {
    opener.focus()
    expect(document.activeElement).toBe(opener)
    const h = mountShell({ drawer: true })
    const dialog = screen.getByRole('dialog', { name: 'Navigation' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    h.rerender({ collapsed: true })
    expect(dialog.hasAttribute('aria-modal')).toBe(false)
  } finally {
    opener.remove()
  }
})

it.each(['menu', 'outside', 'dialog'] as const)('closes an obscured sidebar menu while preserving %s focus', async (destination) => {
  function Content() {
    const [open, setOpen] = useState(true)
    return <><Menu open={open} onClose={() => { setOpen(false) }} portal
      anchor={<button>View options</button>} items={[{ id: 'flat', label: 'Flat list' }]} />
    {destination === 'dialog' && <Modal open title="Settings" closeLabel="Close" onClose={vi.fn()}><button>Settings control</button></Modal>}
    </>
  }
  render(<><button data-sidebar-opener>Open navigation</button><button>Outside control</button></>)
  const h = mountShell({ collapsed: true, width: 56, content: <Content /> })
  let target: HTMLElement = screen.getByRole('menuitem')
  if (destination === 'outside') target = screen.getByRole('button', { name: 'Outside control' })
  if (destination === 'dialog') target = screen.getByRole('button', { name: 'Settings control' })
  target.focus()
  screen.getByTestId('region').setAttribute('inert', '')
  h.rerender({ drawer: true })
  await waitFor(() => { expect(screen.queryByRole('menuitem')).toBeNull() })
  expect(document.activeElement).toBe(destination === 'menu'
    ? screen.getByRole('button', { name: 'Open navigation' }) : target)
})

it.each(['menu', 'outside', 'dialog'] as const)('returns global context-menu focus on collapse while preserving %s focus', (destination) => {
  render(<><button data-sidebar-opener>Open navigation</button><button>Outside control</button></>)
  const h = mountShell({ content: <button aria-controls="session-menu">Session actions</button> })
  screen.getByRole('button', { name: 'Session actions' }).focus()
  render(<div role="menu" id="session-menu"><button role="menuitem">Copy</button></div>)
  let target = screen.getByRole('menuitem')
  if (destination === 'outside') target = screen.getByRole('button', { name: 'Outside control' })
  if (destination === 'dialog') {
    render(<Modal open title="Settings" closeLabel="Close" onClose={vi.fn()}><button>Settings control</button></Modal>)
    target = screen.getByRole('button', { name: 'Settings control' })
  }
  target.focus()
  h.rerender({ drawer: true, collapsed: true })
  expect(document.activeElement).toBe(destination === 'menu'
    ? screen.getByRole('button', { name: 'Open navigation' }) : target)
})

it.each([false, true])('moves hidden sidebar focus only to an available opener (%s)', (hasOpener) => {
  render(<button data-sidebar-opener={hasOpener || undefined}>Open navigation</button>)
  const h = mountShell({ collapsed: true, width: 56 })
  const previous = screen.getByRole('button', { name: 'Open sidebar' })
  previous.focus()
  h.rerender({ drawer: true })
  const expected = hasOpener ? screen.getByRole('button', { name: 'Open navigation' }) : previous
  expect(document.activeElement).toBe(expected)
  if (hasOpener) expect(expected.hasAttribute('data-dsh-automatic-focus')).toBe(true)
})
