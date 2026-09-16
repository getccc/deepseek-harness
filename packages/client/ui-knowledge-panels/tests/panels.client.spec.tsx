// @vitest-environment jsdom
/**
 * Both panels over scripted faces: what a member is told while a read is in
 * flight, when it is refused, and when it answers nothing — three states a
 * panel that rendered an empty list would collapse into one — and what a
 * result row does when it is selected.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  KnowledgeChoice, KnowledgeDocumentContentView, KnowledgeDocumentView, KnowledgeDocumentsView,
  KnowledgePassageView, KnowledgeSearchView,
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
  { knowledgeRef: REF_A, displayName: '临港知识库', description: '现场运维资料', documentCount: 7, createdAt: 1756857600000 },
  { knowledgeRef: REF_B, displayName: '南昌知识库', description: '', documentCount: 0 },
]

/** One passage as the controller answers it. */
function passage(patch: Partial<KnowledgePassageView> = {}): KnowledgePassageView {
  return {
    knowledgeRef: REF_A,
    docRef: `${REF_A}/doc-1`,
    knowledgeName: '临港知识库',
    title: '运维手册',
    text: '一级故障 30 分钟内响应。',
    truncated: false,
    score: 0.81,
    ...patch,
  }
}

/** One document as the controller answers it. */
function document(patch: Partial<KnowledgeDocumentView> = {}): KnowledgeDocumentView {
  return {
    docRef: `${REF_A}/doc-1`,
    knowledgeRef: REF_A,
    title: '运维手册',
    fileName: '运维手册.pdf',
    fileType: 'pdf',
    byteSize: 20480,
    state: 'ready',
    updatedAt: 1756857600000,
    ...patch,
  }
}

/** One page as the controller answers it. */
function documentPage(patch: Partial<KnowledgeDocumentsView> = {}): KnowledgeDocumentsView {
  return { knowledgeRef: REF_A, documents: [document()], page: 1, pageSize: 20, total: 1, ...patch }
}

/** One text answer, which is what a scripted content read serves by default. */
function textContent(patch: Partial<Extract<KnowledgeDocumentContentView, { kind: 'text' }>> = {}): KnowledgeDocumentContentView {
  return {
    kind: 'text',
    docRef: `${REF_A}/doc-1`,
    fileName: '运维手册.pdf',
    text: '一级故障 30 分钟内响应。',
    truncated: false,
    ...patch,
  }
}

/** Render the knowledge-base list over scripted faces. */
function renderBases(
  directory: () => Promise<readonly KnowledgeChoice[]>,
  documents: (knowledgeRef: string, page: number) => Promise<KnowledgeDocumentsView> = () => Promise.resolve(documentPage()),
  content: (docRef: string) => Promise<KnowledgeDocumentContentView> = () => Promise.resolve(textContent()),
) {
  const listed = vi.fn(documents)
  const read = vi.fn(content)
  const props = { directory, documents: listed, content: read, t } as unknown as KnowledgeBasesPanelProps
  return { documents: listed, content: read, view: render(<KnowledgeBasesPanel {...props} />) }
}

/** Open the first knowledge base's card, which is what loads its documents. */
async function choose(name = '临港知识库'): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name, 'u') }))
}

/** Take the breadcrumb back up to the knowledge-base cards. */
async function back(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: '知识库' }))
}

/** Render the retrieval panel over scripted faces. */
function renderSearch(options: {
  directory?: () => Promise<readonly KnowledgeChoice[]>
  search?: (query: string, refs: readonly string[]) => Promise<KnowledgeSearchView>
  discuss?: (ref: string, draft: string) => Promise<void>
} = {}) {
  const directory = options.directory ?? (() => Promise.resolve(BASES))
  const search = vi.fn(options.search ?? (query => Promise.resolve(
    { query, searched: [], passages: [passage()], truncated: false },
  )))
  const discuss = vi.fn(options.discuss ?? (() => Promise.resolve()))
  const props = { directory, search, discuss, t } as unknown as KnowledgeSearchPanelProps
  return { search, discuss, view: render(<KnowledgeSearchPanel {...props} />) }
}

/** The two ways a pending directory read finishes, held for a test to fire late. */
interface Settle {
  resolve: (rows: readonly KnowledgeChoice[]) => void
  reject: (reason: Error) => void
}

/** The same, for a pending content read. */
interface ContentSettle {
  resolve: (content: KnowledgeDocumentContentView) => void
  reject: (reason: Error) => void
}

/** The same, for a pending document listing. */
interface PageSettle {
  resolve: (page: KnowledgeDocumentsView) => void
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
    // What the Control Plane recorded about each knowledge base: its document
    // count and the day the source created it.
    expect(screen.getByText('7 篇文档')).toBeTruthy()
    expect(screen.getByText('创建于 2025-09-03')).toBeTruthy()
    // The card is the only control: opening the knowledge base is the gesture.
    expect(screen.queryByRole('button', { name: '检索这个知识库' })).toBeNull()
  })

  it('leaves the footer out for a knowledge base the Control Plane reports neither fact for', async () => {
    renderBases(() => Promise.resolve([{ knowledgeRef: REF_B, displayName: '南昌知识库', description: '' }]))
    expect(await screen.findByText('南昌知识库')).toBeTruthy()
    expect(screen.queryByText(/篇文档/u)).toBeNull()
    expect(screen.queryByText(/创建于/u)).toBeNull()
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

  it('narrows a discussion to the knowledge base for a result that named no document', async () => {
    const panel = renderSearch({
      search: (query) => {
        const { docRef: _docRef, ...noDocument } = passage()
        return Promise.resolve({ query, searched: [], passages: [noDocument], truncated: false })
      },
    })
    ask()
    fireEvent.click(await screen.findByRole('button', { name: '讨论这篇原文' }))
    await waitFor(() => {
      expect(panel.discuss).toHaveBeenCalledWith(
        { knowledgeRef: REF_A },
        '关于《运维手册》中的这段内容：\n\n> 一级故障 30 分钟内响应。\n\n',
      )
    })
  })

  it('opens a discussion with the passage quoted, and reports one it could not open', async () => {
    const panel = renderSearch()
    ask()
    fireEvent.click(await screen.findByRole('button', { name: '讨论这篇原文' }))
    await waitFor(() => {
      expect(panel.discuss).toHaveBeenCalledWith(
        { knowledgeRef: REF_A, docRef: `${REF_A}/doc-1` },
        '关于《运维手册》中的这段内容：\n\n> 一级故障 30 分钟内响应。\n\n',
      )
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

describe('the documents in one knowledge base', () => {
  it('asks for nothing until a knowledge base is opened, then lists its first page', async () => {
    const bases = renderBases(() => Promise.resolve(BASES))
    expect(await screen.findByText('你有权限的知识库，点击卡片查看其中的文档')).toBeTruthy()
    expect(bases.documents).not.toHaveBeenCalled()
    await choose()
    await waitFor(() => { expect(bases.documents).toHaveBeenCalledWith(REF_A, 1) })
    expect(await screen.findByText('运维手册')).toBeTruthy()
    expect(screen.getByText('可检索')).toBeTruthy()
    expect(screen.getByText('共 1 篇')).toBeTruthy()
    expect(screen.getByText('第 1 页')).toBeTruthy()
    expect(screen.getByText('20KB')).toBeTruthy()
    // The day comes from the timestamp the source reported, read as this
    // computer's calendar reads it.
    expect(screen.getByText('2025-09-03')).toBeTruthy()
  })

  it('takes the breadcrumb back to the cards, and keeps the heading on the way in', async () => {
    renderBases(() => Promise.resolve(BASES))
    await choose()
    // The level a member is on is the heading; the level above it is a control.
    expect((await screen.findByRole('heading')).textContent).toBe('临港知识库')
    expect(screen.getByText('点击一份文档，在右侧查看它的内容')).toBeTruthy()
    await back()
    expect((await screen.findByRole('heading')).textContent).toBe('知识库')
    expect(screen.getByText('南昌知识库')).toBeTruthy()
  })

  it('says a knowledge base carries no description rather than leaving the card blank', async () => {
    renderBases(() => Promise.resolve(BASES))
    expect(await screen.findByText('无描述')).toBeTruthy()
    expect(screen.getByText('现场运维资料')).toBeTruthy()
  })

  it('names a document by its file name when the source holds no title', async () => {
    const bases = renderBases(
      () => Promise.resolve(BASES),
      () => Promise.resolve(documentPage({ documents: [document({ title: '', fileType: '', byteSize: 0 })] })),
    )
    await choose()
    expect(await screen.findByText('运维手册.pdf')).toBeTruthy()
    expect(bases.documents).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['processing', '解析中'],
    ['unavailable', '不可检索'],
  ])('says a %s document is not searchable yet', async (state, label) => {
    renderBases(
      () => Promise.resolve(BASES),
      () => Promise.resolve(documentPage({ documents: [document({ state: state as KnowledgeDocumentView['state'] })] })),
    )
    await choose()
    expect(await screen.findByText(label)).toBeTruthy()
  })

  it('tells an empty knowledge base apart from a listing it could not read', async () => {
    const empty = renderBases(
      () => Promise.resolve(BASES),
      () => Promise.resolve(documentPage({ documents: [], total: 0 })),
    )
    await choose()
    expect(await screen.findByText('这个知识库里还没有文档')).toBeTruthy()
    empty.view.unmount()
    renderBases(() => Promise.resolve(BASES), () => Promise.reject(new Error('refused')))
    await choose()
    expect(await screen.findByText('文档列表读取失败')).toBeTruthy()
  })

  it('pages forward while there is more, and back from where it got to', async () => {
    const bases = renderBases(
      () => Promise.resolve(BASES),
      (_ref, page) => Promise.resolve(documentPage({ page, pageSize: 1, total: 3 })),
    )
    await choose()
    expect(await screen.findByText('第 1 页')).toBeTruthy()
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(await screen.findByText('第 2 页')).toBeTruthy()
    expect(bases.documents).toHaveBeenLastCalledWith(REF_A, 2)
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => { expect(bases.documents).toHaveBeenLastCalledWith(REF_A, 1) })
  })

  it('stops paging at the end the total names', async () => {
    renderBases(
      () => Promise.resolve(BASES),
      (_ref, page) => Promise.resolve(documentPage({ page, pageSize: 2, total: 2 })),
    )
    await choose()
    await screen.findByText('第 1 页')
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true)
  })

  it('offers another page on a full one when the source reports no total', async () => {
    renderBases(
      () => Promise.resolve(BASES),
      (_ref, page) => Promise.resolve({
        knowledgeRef: REF_A,
        documents: [document(), document({ docRef: `${REF_A}/doc-2` })],
        page,
        pageSize: 2,
      }),
    )
    await choose()
    await screen.findByText('第 1 页')
    // A full page with no total is the one case where "there may be more" is
    // the honest answer; the count itself is not shown.
    expect(screen.queryByText(/共 .* 篇/u)).toBeNull()
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(false)
  })

  it('starts the new knowledge base at its first page', async () => {
    const bases = renderBases(
      () => Promise.resolve(BASES),
      (_ref, page) => Promise.resolve(documentPage({ page, pageSize: 1, total: 9 })),
    )
    await choose()
    await screen.findByText('第 1 页')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => { expect(bases.documents).toHaveBeenLastCalledWith(REF_A, 2) })
    await back()
    await choose('南昌知识库')
    await waitFor(() => { expect(bases.documents).toHaveBeenLastCalledWith(REF_B, 1) })
  })

  it.each([
    ['answers', (settle: PageSettle) => { settle.resolve(documentPage()) }],
    ['is refused', (settle: PageSettle) => { settle.reject(new Error('too late')) }],
  ])('ignores a listing that %s after the panel is gone', async (_label, finish) => {
    const settle = {} as PageSettle
    const bases = renderBases(
      () => Promise.resolve(BASES),
      () => new Promise((resolve, reject) => {
        settle.resolve = resolve
        settle.reject = reject
      }),
    )
    await choose()
    bases.view.unmount()
    finish(settle)
    await settled()
    expect(screen.queryByText('运维手册')).toBeNull()
    expect(screen.queryByText('文档列表读取失败')).toBeNull()
  })
})

describe('one document in the drawer', () => {
  /** Choose the knowledge base, then open its first document. */
  async function open(): Promise<void> {
    await choose()
    fireEvent.click(await screen.findByRole('button', { name: /运维手册/u }))
  }

  it('asks for nothing until a document is opened', async () => {
    const bases = renderBases(() => Promise.resolve(BASES))
    await choose()
    expect(await screen.findByText('运维手册')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bases.content).not.toHaveBeenCalled()
  })

  it.each([
    ['the close control', () => { fireEvent.click(screen.getByRole('button', { name: '关闭' })) }],
    ['a click beside it', () => { fireEvent.click(screen.getByTestId('knowledge-drawer-scrim')) }],
    ['the Escape key', () => { fireEvent.keyDown(window, { key: 'Escape' }) }],
    ['another key doing nothing', () => { fireEvent.keyDown(window, { key: 'a' }) }],
  ])('stays or closes on %s', async (label, act) => {
    renderBases(() => Promise.resolve(BASES))
    await open()
    await screen.findByText('一级故障 30 分钟内响应。')
    act()
    if (label === 'another key doing nothing') {
      expect(screen.getByRole('dialog')).toBeTruthy()
      return
    }
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('draws parsed text, and says when it was cut', async () => {
    const bases = renderBases(
      () => Promise.resolve(BASES), undefined,
      () => Promise.resolve(textContent({ truncated: true })),
    )
    await open()
    await waitFor(() => { expect(bases.content).toHaveBeenCalledWith(`${REF_A}/doc-1`) })
    expect(await screen.findByText('一级故障 30 分钟内响应。')).toBeTruthy()
    expect(screen.getByText('（内容已截断）')).toBeTruthy()
  })

  it('draws a text file the source served as bytes', async () => {
    renderBases(
      () => Promise.resolve(BASES), undefined,
      () => Promise.resolve({
        kind: 'bytes',
        docRef: `${REF_A}/doc-1`,
        fileName: '说明.md',
        contentType: 'text/markdown; charset=utf-8',
        // "# 标题" in base64, so the decode path is what is being read here.
        base64: 'IyDmoIfpopg=',
      }),
    )
    await open()
    expect(await screen.findByText('# 标题')).toBeTruthy()
  })

  it.each([
    ['an image', 'image/png', 'img'],
    ['a PDF', 'application/pdf', 'object'],
  ])('draws %s from an object URL', async (_label, contentType, tag) => {
    const created: string[] = []
    const revoked: string[] = []
    const url = globalThis.URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown }
    url.createObjectURL = (blob: Blob) => {
      const href = `blob:${String(created.length)}#${blob.type}`
      created.push(href)
      return href
    }
    url.revokeObjectURL = (href: string) => { revoked.push(href) }
    const bases = renderBases(
      () => Promise.resolve(BASES), undefined,
      () => Promise.resolve({
        kind: 'bytes', docRef: `${REF_A}/doc-1`, fileName: '图.png', contentType, base64: 'AQID',
      }),
    )
    await open()
    await waitFor(() => { expect(created).toHaveLength(1) })
    expect(bases.view.container.querySelector(tag)?.getAttribute(tag === 'img' ? 'src' : 'data')).toBe(created[0])
    // The URL goes away with the column: one that outlived it would keep the
    // file readable from a page that is no longer showing it.
    bases.view.unmount()
    expect(revoked).toEqual(created)
    delete url.createObjectURL
    delete url.revokeObjectURL
  })

  it('says so for a file it cannot draw here', async () => {
    const url = globalThis.URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown }
    url.createObjectURL = () => 'blob:office'
    url.revokeObjectURL = () => {}
    renderBases(
      () => Promise.resolve(BASES), undefined,
      () => Promise.resolve({
        kind: 'bytes',
        docRef: `${REF_A}/doc-1`,
        fileName: '报告.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        base64: 'AQID',
      }),
    )
    await open()
    expect(await screen.findByText('这里还不能显示这种文件，请在对话中打开它')).toBeTruthy()
    delete url.createObjectURL
    delete url.revokeObjectURL
  })

  it('reports a read it could not complete', async () => {
    renderBases(
      () => Promise.resolve(BASES), undefined,
      () => Promise.reject(new Error('refused')),
    )
    await open()
    expect(await screen.findByText('文档内容读取失败')).toBeTruthy()
  })

  it('forgets the open document when another knowledge base is opened', async () => {
    renderBases(() => Promise.resolve(BASES))
    await open()
    await screen.findByText('一级故障 30 分钟内响应。')
    await back()
    await choose('南昌知识库')
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it.each([
    ['answers', (settle: ContentSettle) => { settle.resolve(textContent()) }],
    ['is refused', (settle: ContentSettle) => { settle.reject(new Error('too late')) }],
  ])('ignores a read that %s after the column is gone', async (_label, finish) => {
    const settle = {} as ContentSettle
    const bases = renderBases(
      () => Promise.resolve(BASES), undefined,
      () => new Promise((resolve, reject) => {
        settle.resolve = resolve
        settle.reject = reject
      }),
    )
    await open()
    bases.view.unmount()
    finish(settle)
    await settled()
    expect(screen.queryByText('一级故障 30 分钟内响应。')).toBeNull()
    expect(screen.queryByText('文档内容读取失败')).toBeNull()
  })
})
