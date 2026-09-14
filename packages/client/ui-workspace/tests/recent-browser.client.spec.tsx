// @vitest-environment jsdom
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RecentBrowserProps } from '../src/client/contract/slots.ts'
import { createWorkspaceViewStore } from '../src/client/stores.ts'
import { RecentBrowser } from '../src/client/rows/RecentBrowser.tsx'
import { zh } from '../src/client/locales.ts'

// Every fixture carries the resource hook the resources plugin merges into GlobalStandardProps.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource']
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const t: RecentBrowserProps['t'] = makeTranslate(zh, commonZh)

const sid = (id: string) => id as SessionId
const summary = (id: string, updatedAt: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, kind: 'chat', running: false, blank: false, updatedAt, ...overrides,
})
const sessionState = (items: readonly SessionSummary[], overrides: Partial<SessionListState> = {}): SessionListState => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  current: undefined,
  phase: 'ready',
  subagentsByParent: {}, jobsBySession: {},
  currentAddress: undefined,
  ...overrides,
})
const workspaceState = (archivedSessionIds: readonly SessionId[] = []): WorkspaceSnapshot =>
  ({ items: [], archivedSessionIds, state: 'idle', phase: 'ready', error: null })
const noPendingInteraction: SessionPendingInteractionSnapshot = new Map()
function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

/** A chat, a blank current chat, a stale blank chat, and a work session. */
const mixed = sessionState([
  summary('chat-a', 2),
  summary('chat-blank', 3, { blank: true, pristine: true }),
  summary('stale-blank', 1, { blank: true }),
  summary('work-w', 5, { kind: 'work', cwd: '/projects/w' }),
], { current: sid('chat-blank') })

function mount(overrides: Partial<RecentBrowserProps> = {}) {
  const store = createWorkspaceViewStore().create()
  const props: RecentBrowserProps = {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: hook(mixed),
    useSessionPendingInteraction: hook(noPendingInteraction),
    usePanelInfo, useResource,
    useWorkspaces: hook(workspaceState()),
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    open: vi.fn(),
    renameSession: vi.fn(async () => {}),
    forkSession: vi.fn(),
    archiveSession: vi.fn(async () => {}),
    t,
    ...overrides,
  }
  const view = render(<RecentBrowser {...props} />)
  return { view, props, store }
}

/** Visible row titles in render order (the flat row also carries a relative time, which is not the title). */
function rowTitles(): string[] {
  return screen.getAllByRole('treeitem').map(row => row.querySelector('[class*="title"]')?.textContent ?? '')
}

/** Open the row menu of one session and pick a verb. */
function pickRowVerb(title: string, verb: string): void {
  fireEvent.click(screen.getByRole('button', { name: `会话“${title}”的操作` }))
  fireEvent.click(screen.getByRole('menuitem', { name: verb }))
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
    expect(rowTitles()).toEqual(['work-w', '新对话', 'chat-a'])

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

  it('renders nothing on the rail', () => {
    const b = mount({ wide: false })
    expect(b.view.container.innerHTML).toBe('')
  })

  it('renames through the row menu: composition and blank drafts never submit, Enter submits, acceptance closes', async () => {
    const b = mount()
    pickRowVerb('chat-a', '重命名')
    const input = screen.getByLabelText('会话名称') as HTMLInputElement
    expect(input.value).toBe('chat-a')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.compositionEnd(input)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.props.renameSession).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: ' Renamed ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.props.renameSession).toHaveBeenCalledExactlyOnceWith(sid('chat-a'), 'Renamed')
    await waitFor(() => { expect(screen.queryByLabelText('会话名称')).toBeNull() })
  })

  it('keeps a rejected rename open with its message, ignores Cancel while renaming, and Cancel closes when idle', async () => {
    let settle: () => void = () => {}
    const renameSession = vi.fn<RecentBrowserProps['renameSession']>()
      .mockRejectedValueOnce('denied')
      .mockRejectedValueOnce(new Error('title write failed'))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { settle = resolve }))
    mount({ renameSession })
    pickRowVerb('chat-a', '重命名')
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('denied') })
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('title write failed') })

    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    expect(screen.queryByRole('alert')).toBeNull()
    // In flight: the Cancel and Rename controls are disabled and closing is refused.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '取消' }).disabled).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByLabelText('会话名称')).toBeTruthy()
    settle()
    await waitFor(() => { expect(screen.queryByLabelText('会话名称')).toBeNull() })

    // A fresh open seeds a fresh draft; Cancel closes it.
    pickRowVerb('chat-a', '重命名')
    expect(screen.getByLabelText<HTMLInputElement>('会话名称').value).toBe('chat-a')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByLabelText('会话名称')).toBeNull()
    expect(renameSession).toHaveBeenCalledTimes(3)
  })

  it('forks and archives through the row menu and reports a rejected archive', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const archiveSession = vi.fn<RecentBrowserProps['archiveSession']>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('archive rejected'))
    const b = mount({ archiveSession })
    pickRowVerb('chat-a', '分叉会话')
    expect(b.props.forkSession).toHaveBeenCalledExactlyOnceWith(sid('chat-a'))
    pickRowVerb('chat-a', '归档会话')
    expect(archiveSession).toHaveBeenCalledWith(sid('chat-a'))
    pickRowVerb('chat-a', '归档会话')
    await waitFor(() => {
      expect(warning).toHaveBeenCalledWith('session archive rejected:', expect.any(Error))
    })
    expect(b.props.open).not.toHaveBeenCalled()
    warning.mockRestore()
  })
})
