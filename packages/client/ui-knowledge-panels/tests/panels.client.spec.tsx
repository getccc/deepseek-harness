// @vitest-environment jsdom
/**
 * Both panels over scripted faces: what a member is told while a read is in
 * flight, when it is refused, and when it answers nothing — three states a
 * panel that rendered an empty list would collapse into one — and what a
 * result row does when it is selected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  KnowledgeChoice, KnowledgePassageView, KnowledgeSearchView,
} from '@deepseek-ai/dsh-api-knowledge-controller/types'
import { KnowledgeBasesGlyph, KnowledgeSearchGlyph } from '../src/client/Glyphs.tsx'
import { KnowledgeBasesPanel, type KnowledgeBasesPanelProps } from '../src/client/KnowledgeBasesPanel.tsx'
import { KnowledgeSearchPanel, type KnowledgeSearchPanelProps } from '../src/client/KnowledgeSearchPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const REF_A = 'weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'
const REF_B = 'weknora:prod:08f25606-8876-49cc-b509-70e84828db08'

// The framework-injected t seat, stubbed over the zh dictionary.
const t = makeTranslate(zh) as KnowledgeBasesPanelProps['t']

/** The authorized directory both panels read. */
const BASES: readonly KnowledgeChoice[] = [
  { knowledgeRef: REF_A, displayName: '临港知识库', description: '现场运维资料' },
  { knowledgeRef: REF_B, displayName: '南昌知识库', description: '' },
]

/** One passage as the controller answers it. */
function passage(patch: Partial<KnowledgePassageView> = {}): KnowledgePassageView {
  return {
    knowledgeRef: REF_A,
    knowledgeName: '临港知识库',
    title: '运维手册',
    text: '一级故障 30 分钟内响应。',
    truncated: false,
    score: 0.81,
    ...patch,
  }
}

/** Render the knowledge-base list over one scripted directory. */
function renderBases(directory: () => Promise<readonly KnowledgeChoice[]>, searchIn = vi.fn()) {
  const props = { directory, searchIn, t } as unknown as KnowledgeBasesPanelProps
  return { searchIn, view: render(<KnowledgeBasesPanel {...props} />) }
}

/** Render the retrieval panel over scripted faces and one requested selection. */
function renderSearch(options: {
  directory?: () => Promise<readonly KnowledgeChoice[]>
  search?: (query: string, refs: readonly string[]) => Promise<KnowledgeSearchView>
  discuss?: (ref: string, draft: string) => Promise<void>
  requested?: readonly string[]
} = {}) {
  const store = createSnapshotStore<readonly string[]>(options.requested ?? [])
  const directory = options.directory ?? (() => Promise.resolve(BASES))
  const search = vi.fn(options.search ?? (query => Promise.resolve(
    { query, searched: [], passages: [passage()], truncated: false },
  )))
  const discuss = vi.fn(options.discuss ?? (() => Promise.resolve()))
  const props = {
    directory, search, discuss, t, useRequested: bindSnapshotSelector(store),
  } as unknown as KnowledgeSearchPanelProps
  return { search, discuss, view: render(<KnowledgeSearchPanel {...props} />) }
}

/** The two ways a pending directory read finishes, held for a test to fire late. */
interface Settle {
  resolve: (rows: readonly KnowledgeChoice[]) => void
  reject: (reason: Error) => void
}

/** Let a settled promise reach the component that is no longer mounted. */
const settled = () => new Promise(resolve => setTimeout(resolve, 0))

/** Type a query and run the retrieval. */
function ask(query = '故障响应'): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: query } })
  fireEvent.click(screen.getByRole('button', { name: '检索' }))
}

describe('the knowledge-base list', () => {
  it('says it is reading, then names every authorized knowledge base', async () => {
    renderBases(() => Promise.resolve(BASES))
    expect(screen.getByText('正在读取知识库')).toBeTruthy()
    expect(await screen.findByText('临港知识库')).toBeTruthy()
    expect(screen.getByText('现场运维资料')).toBeTruthy()
    // A knowledge base whose upstream carries no description shows none.
    expect(screen.getByText('南昌知识库')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '检索这个知识库' })).toHaveLength(2)
  })

  it('tells a member with no access apart from one whose directory was refused', async () => {
    const empty = renderBases(() => Promise.resolve([]))
    expect(await screen.findByText('当前没有你可以访问的知识库')).toBeTruthy()
    empty.view.unmount()
    renderBases(() => Promise.reject(new Error('unreachable')))
    expect(await screen.findByText('知识库读取失败')).toBeTruthy()
  })

  it('reads again when a failed read is retried', async () => {
    let attempts = 0
    const directory = vi.fn(() => {
      attempts += 1
      return attempts === 1 ? Promise.reject(new Error('unreachable')) : Promise.resolve(BASES)
    })
    renderBases(directory)
    fireEvent.click(await screen.findByRole('button', { name: '重试' }))
    expect(await screen.findByText('临港知识库')).toBeTruthy()
    expect(directory).toHaveBeenCalledTimes(2)
  })

  it('asks for a retrieval in the knowledge base whose row was clicked', async () => {
    const bases = renderBases(() => Promise.resolve(BASES))
    fireEvent.click((await screen.findAllByRole('button', { name: '检索这个知识库' }))[0]!)
    expect(bases.searchIn).toHaveBeenCalledWith(REF_A)
  })

  it.each([
    ['answers', (settle: Settle) => { settle.resolve(BASES) }],
    ['is refused', (settle: Settle) => { settle.reject(new Error('unreachable')) }],
  ])('ignores a directory that %s after the panel is gone', async (_label, finish) => {
    const settle = {} as Settle
    const bases = renderBases(() => new Promise((resolve, reject) => {
      settle.resolve = resolve
      settle.reject = reject
    }))
    bases.view.unmount()
    finish(settle)
    await settled()
    expect(screen.queryByText('临港知识库')).toBeNull()
    expect(screen.queryByText('知识库读取失败')).toBeNull()
  })
})

describe('the retrieval panel', () => {
  it('offers every authorized knowledge base as a scope, with everything chosen by default', async () => {
    renderSearch()
    expect(await screen.findByRole('button', { name: '临港知识库' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部知识库' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('starts from the knowledge base the list asked for, and drops one the directory no longer holds', async () => {
    const kept = renderSearch({ requested: [REF_A] })
    await waitFor(() => { expect(screen.getByRole('button', { name: '临港知识库' }).getAttribute('aria-pressed')).toBe('true') })
    expect(screen.getByRole('button', { name: '全部知识库' }).getAttribute('aria-pressed')).toBe('false')
    kept.view.unmount()
    renderSearch({ requested: ['weknora:prod:00000000-0000-4000-8000-000000000000'] })
    await waitFor(() => { expect(screen.getByRole('button', { name: '全部知识库' }).getAttribute('aria-pressed')).toBe('true') })
  })

  it('searches everything until a knowledge base is picked, and only that one afterwards', async () => {
    const panel = renderSearch()
    await screen.findByRole('button', { name: '临港知识库' })
    ask()
    await waitFor(() => { expect(panel.search).toHaveBeenCalledWith('故障响应', []) })
    fireEvent.click(screen.getByRole('button', { name: '临港知识库' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await waitFor(() => { expect(panel.search).toHaveBeenLastCalledWith('故障响应', [REF_A]) })
    // Clicking the chosen knowledge base again takes it back out of the scope.
    fireEvent.click(screen.getByRole('button', { name: '临港知识库' }))
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    await waitFor(() => { expect(panel.search).toHaveBeenLastCalledWith('故障响应', []) })
    // Every knowledge base at once is its own choice, not the absence of one.
    fireEvent.click(screen.getByRole('button', { name: '临港知识库' }))
    fireEvent.click(screen.getByRole('button', { name: '全部知识库' }))
    fireEvent.click(screen.getByRole('button', { name: '检索' }))
    await waitFor(() => { expect(panel.search).toHaveBeenLastCalledWith('故障响应', []) })
    expect(panel.search).toHaveBeenCalledTimes(4)
  })

  it('ranks the passages under their document and says how far the answer goes', async () => {
    renderSearch({
      search: query => Promise.resolve({
        query,
        searched: [],
        passages: [passage(), passage({ score: 0.44, text: '二级故障 2 小时内响应。', truncated: true })],
        truncated: true,
      }),
    })
    await screen.findByRole('button', { name: '临港知识库' })
    ask()
    expect(await screen.findByText('运维手册')).toBeTruthy()
    expect(screen.getByText('相似度 0.81')).toBeTruthy()
    expect(screen.getByText('共 2 段，来自 1 篇原文')).toBeTruthy()
    expect(screen.getByText('（本段已截断）')).toBeTruthy()
    expect(screen.getByText('结果已达上限，缩小检索范围可以看到更多')).toBeTruthy()
  })

  it('tells an answer with nothing in it apart from a refused retrieval', async () => {
    const nothing = renderSearch({
      search: query => Promise.resolve({ query, searched: [], passages: [], truncated: false }),
    })
    ask()
    expect(await screen.findByText('没有检索到相关内容')).toBeTruthy()
    nothing.view.unmount()
    renderSearch({ search: () => Promise.reject(new Error('refused')) })
    ask()
    expect(await screen.findByText('检索失败')).toBeTruthy()
  })

  it('does not ask for a blank query, and types without asking', () => {
    const panel = renderSearch()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(panel.search).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '检索' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '故障' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'a' })
    expect(panel.search).not.toHaveBeenCalled()
  })

  it('opens a discussion with the passage quoted, and reports one it could not open', async () => {
    const panel = renderSearch()
    ask()
    fireEvent.click(await screen.findByRole('button', { name: '讨论这篇原文' }))
    await waitFor(() => {
      expect(panel.discuss).toHaveBeenCalledWith(REF_A, '关于《运维手册》中的这段内容：\n\n> 一级故障 30 分钟内响应。\n\n')
    })
    panel.view.unmount()
    renderSearch({ discuss: () => Promise.reject(new Error('no session')) })
    ask()
    fireEvent.click(await screen.findByRole('button', { name: '讨论这篇原文' }))
    expect(await screen.findByText('无法打开讨论')).toBeTruthy()
  })

  it('offers no scope at all when the directory cannot be read', async () => {
    renderSearch({ directory: () => Promise.reject(new Error('unreachable')) })
    await waitFor(() => { expect(screen.queryByRole('button', { name: '临港知识库' })).toBeNull() })
    // The retrieval itself still runs: what the Control Plane authorizes is
    // decided on the call, not by a directory the browser failed to read.
    expect(screen.getByRole('button', { name: '全部知识库' })).toBeTruthy()
  })

  it.each([
    ['answers', (settle: Settle) => { settle.resolve(BASES) }],
    ['is refused', (settle: Settle) => { settle.reject(new Error('unreachable')) }],
  ])('ignores a directory that %s after the panel is gone', async (_label, finish) => {
    const settle = {} as Settle
    const panel = renderSearch({
      directory: () => new Promise((resolve, reject) => {
        settle.resolve = resolve
        settle.reject = reject
      }),
    })
    panel.view.unmount()
    finish(settle)
    await settled()
    expect(screen.queryByRole('button', { name: '临港知识库' })).toBeNull()
  })
})

describe('the navigation rows', () => {
  it('wear the knowledge glyph and the retrieval glyph at the size the sidebar asks for', () => {
    const props = { size: 18 } as unknown as Parameters<typeof KnowledgeBasesGlyph>[0]
    const bases = render(<KnowledgeBasesGlyph {...props} />)
    expect(bases.container.querySelector('svg')?.getAttribute('width')).toBe('18')
    cleanup()
    const search = render(<KnowledgeSearchGlyph {...props} />)
    expect(search.container.querySelector('svg')?.getAttribute('width')).toBe('18')
  })
})
