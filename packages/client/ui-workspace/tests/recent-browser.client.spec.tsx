// @vitest-environment jsdom
import type { GlobalStandardProps, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  bindSnapshotSelector, makeTranslate, SlotTestRuntime, usePinnedBrowserLanguages,
} from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RecentBrowserProps, SessionRowSeats } from '../src/client/contract/slots.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { RecentBrowser } from '../src/client/rows/RecentBrowser.tsx'
import { zh } from '../src/client/locales.ts'

// The assembled case asserts the shipped Chinese copy through the locale service.
usePinnedBrowserLanguages('zh-CN')

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t: RecentBrowserProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, kind: 'chat', running: false, blank: false, updatedAt, ...overrides,
  retainedBy: overrides.retainedBy ?? {},
})
const sessionState = (items: readonly SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  phase: 'ready',
  projectionsBySession: {},
})
const workspaceState = (
  archivedSessionIds: readonly SessionId[] = [],
  pinnedSessionIds: readonly SessionId[] = [],
): WorkspaceSnapshot => ({ items: [], archivedSessionIds, pinnedSessionIds, state: 'idle', phase: 'ready', error: null })
const noStatus: SessionStatusSnapshot = new Map()
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

/** A chat, a blank current chat, a stale blank chat, and a work session. */
const mixed = sessionState([
  summary('chat-a', 2),
  summary('chat-blank', 3, { blank: true, pristine: true, retainedBy: { mainView: 1 } }),
  summary('stale-blank', 1, { blank: true }),
  summary('work-w', 5, { kind: 'work', cwd: '/projects/w' }),
])

/** Row seats that render nothing: the browser has not shared its own. */
const noSeats: SessionRowSeats = { renderSlot: () => null }

function mount(overrides: Partial<RecentBrowserProps> = {}) {
  const store = createWorkspaceViewStore().create()
  const props: RecentBrowserProps = {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: hook(mixed),
    useSessionStatus: hook(noStatus),
    useSessionRetainInfo: () => undefined,
    usePanelInfo, useResource,
    useWorkspaces: hook(workspaceState()),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    open: vi.fn(),
    requestSessionRename: vi.fn(),
    notifyArchivedNotOpenable: vi.fn(),
    useRowSeats: hook(noSeats),
    t,
    ...overrides,
  }
  const view = render(<RecentBrowser {...props} />)
  return { view, props, store }
}

/** Visible row titles in render order (the row also carries a relative time, which is not the title). */
function rowTitles(): string[] {
  return screen.getAllByRole('treeitem').map(row => row.querySelector('[class*="title"]')?.textContent ?? '')
}

describe('RecentBrowser', () => {
  it('lists chat sessions newest-first by default, labels the current blank chat, and opens a row', () => {
    const b = mount()
    expect(screen.getByText('最近')).toBeTruthy()
    expect(rowTitles()).toEqual(['新对话', 'chat-a'])
    expect(screen.queryByText('work-w')).toBeNull()
    expect(screen.queryByText('stale-blank')).toBeNull()
    expect(screen.getByText('新对话').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByText('chat-a'))
    expect(b.props.open).toHaveBeenCalledExactlyOnceWith(sid('chat-a'))
  })

  it('switches the kind filter through the header menu and persists it in the shared store', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['聊天', '工作', '全部'])
    expect(screen.getByRole('menuitem', { name: '聊天' }).querySelector('svg')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '工作' }))
    expect(b.store.getSnapshot().recentFilter).toBe('work')
    expect(rowTitles()).toEqual(['work-w'])

    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '全部' }))
    expect(b.store.getSnapshot().recentFilter).toBe('all')
    // The current blank leads as the provisional row, then newest-first.
    expect(rowTitles()).toEqual(['新对话', 'work-w', 'chat-a'])

    // Escape closes the menu without picking.
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(b.store.getSnapshot().recentFilter).toBe('all')
  })

  it('shows the empty state, hides archived rows, and drops the selected look while a main panel is active', () => {
    mount({ useSessions: hook(sessionState([summary('work-only', 1, { kind: 'work' })])) })
    expect(screen.getByText('暂无对话')).toBeTruthy()
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0)
    cleanup()

    mount({ useWorkspaces: hook(workspaceState([sid('chat-a')])) })
    expect(rowTitles()).toEqual(['新对话'])
    cleanup()

    mount({ usePanelInfo: hook({ activePanelId: 'panel-a' as MainPanelId }) })
    expect(screen.getByText('新对话').closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('false')
  })

  it('leads with pinned rows and follows the browser\'s archived filter', () => {
    const sessions = hook(sessionState([summary('old-pin', 1), summary('newer', 3), summary('gone', 2)]))
    const workspaces = hook(workspaceState([sid('gone')], [sid('old-pin')]))
    const b = mount({ useSessions: sessions, useWorkspaces: workspaces })
    expect(rowTitles()).toEqual(['old-pin', 'newer'])
    expect(screen.getByRole('img', { name: '已置顶' })).toBeTruthy()
    cleanup()

    b.store.actions.setArchivedFilter('show')
    const shown = mount({ useSessions: sessions, useWorkspaces: workspaces })
    expect(rowTitles()).toEqual(['old-pin', 'newer', 'gone'])
    // An archived row explains instead of opening.
    fireEvent.click(screen.getByText('gone'))
    expect(shown.props.open).not.toHaveBeenCalled()
    expect(shown.props.notifyArchivedNotOpenable).toHaveBeenCalledOnce()
  })

  it('renders the browser\'s row seats for each non-blank row and raises rename from a title double-click', () => {
    const renderSlot = vi.fn((key: string) =>
      key === 'sidebar.workspaces.session.menu.item'
        ? <button type="button" role="menuitem">Seat action</button>
        : null)
    const b = mount({ useRowSeats: hook<SessionRowSeats>({ renderSlot }) })
    // Idle rows offer the leading seat and a hover-button strip; the blank row offers neither.
    expect(renderSlot).toHaveBeenCalledWith('sidebar.session.row.leading', { sessionId: sid('chat-a') })
    expect(renderSlot).toHaveBeenCalledWith(
      'sidebar.workspaces.session.row.action', { sessionId: sid('chat-a'), displayTitle: 'chat-a' },
    )
    expect(renderSlot).not.toHaveBeenCalledWith(
      'sidebar.workspaces.session.row.action', expect.objectContaining({ sessionId: sid('chat-blank') }),
    )
    // The row menu renders the menu-item seat with the menu's open state as hook context.
    fireEvent.click(screen.getByRole('button', { name: '会话“chat-a”的操作' }))
    expect(screen.getByRole('menuitem', { name: 'Seat action' })).toBeTruthy()
    expect(renderSlot).toHaveBeenCalledWith(
      'sidebar.workspaces.session.menu.item',
      { sessionId: sid('chat-a'), displayTitle: 'chat-a' },
      { hookContext: [true, expect.any(Function)] },
    )
    expect(b.props.open).not.toHaveBeenCalled()

    fireEvent.doubleClick(screen.getByText('chat-a'))
    expect(b.props.requestSessionRename).toHaveBeenCalledExactlyOnceWith(sid('chat-a'), 'chat-a')
  })

  it('reads a persisted view without an archived filter as hiding archived rows', () => {
    localStorage.setItem('dsh.workspace.view.v6', JSON.stringify({
      groupBy: 'workspace', orderBy: 'updated', recentFilter: 'chat', groupExpansion: {}, sessionOrderByAccount: {},
    }))
    const b = mount({ useWorkspaces: hook(workspaceState([sid('chat-a')])) })
    expect(b.store.getSnapshot().archivedFilter).toBeUndefined()
    expect(rowTitles()).toEqual(['新对话'])
  })

  it('renders nothing on the rail', () => {
    const b = mount({ wide: false })
    expect(b.view.container.innerHTML).toBe('')
  })
})

/** Test-owned shell role: the two browsing seats and the frame-wide overlay list. */
function SidebarFrame({ renderSlot }: PropsRenderSlots<'sidebar.workspaces' | 'sidebar.recent' | 'shell.overlay'>) {
  return (
    <>
      {renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} })}
      {renderSlot('sidebar.recent', { wide: true, expandSidebar: () => {} })}
      {renderSlot('shell.overlay', {})}
    </>
  )
}

describe('RecentBrowser assembled with the Workspace browser', () => {
  it('renders the shipped row actions through the seats the browser shares', async () => {
    const runtime = await SlotTestRuntime.create()
    runtime.ctx.provide('shortcuts', { register: () => () => {}, catalog: createSnapshotStore([]) })
    runtime.ctx.provide('layout', { selectPanel: vi.fn(), beginNavigation: () => new AbortController().signal })
    runtime.releaseWorkspaceSource()
    runtime.remote.provideNamespaces({ directoryPicker: {} })
    const locale = new LocaleRuntime(runtime.ctx)
    runtime.ctx.provide('locale', locale)
    runtime.slots.installLocale(locale)
    // No cwd: the list derives a chat Session, which only the Recent list shows.
    await runtime.sessions.add({ id: sid('c1'), summary: { title: 'Chat title', displayTitle: 'Chat title' } })
    await runtime.root.declare(
      {
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.recent': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      } as never,
      SidebarFrame as never,
    )
    await runtime.mount({ inject: [...inject], apply })
    const view = runtime.renderRoot()

    const row = (await view.findByText('Chat title')).closest('[role="treeitem"]')!
    fireEvent.click(within(row as HTMLElement).getByLabelText('会话“Chat title”的操作'))
    expect(view.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '置顶会话', '重命名', '分叉会话', '归档会话',
    ])
    // The rename row raises the overlay dialog the tree's rows use.
    fireEvent.click(view.getByRole('menuitem', { name: '重命名' }))
    expect(((await view.findByLabelText('会话名称')) as HTMLInputElement).value).toBe('Chat title')
    await runtime.dispose()
  })
})
