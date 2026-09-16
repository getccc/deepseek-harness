/**
 * The knowledge panels' browser half on a real SlotRegistry with fake Remote,
 * layout, Session, and composer faces: the plugin joins the sidebar-declared
 * panel-row list and the layout-declared `main` panels, carries a knowledge
 * base from one panel to the other, opens a discussion as one Session with one
 * recorded scope, and gives every entry back on teardown (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { KnowledgeBasesPanel } from '../src/client/KnowledgeBasesPanel.tsx'
import { KnowledgeSearchPanel } from '../src/client/KnowledgeSearchPanel.tsx'
import type { KnowledgeBasesInjected, KnowledgeSearchInjected } from '../src/client/index.ts'
import { BASES_PANEL, SEARCH_PANEL, apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const REF_A = 'weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'
const SID = 's-knowledge' as SessionId

/** One knowledge call, as the Remote received it. */
type Recorded =
  | { call: 'directory' }
  | { call: 'documents'; knowledgeRef: string; page?: number }
  | { call: 'documentContent'; docRef: string }
  | { call: 'search'; query: string; mode: string; knowledgeRefs?: string[] }
  | { call: 'choose'; sessionId: string; mode: string; knowledgeRefs?: string[] }
  | { call: 'chooseDocuments'; sessionId: string; documents: { docRef: string; title: string }[] }

/** Boot the plugin over fake Remote, layout, and Session faces. */
async function bench(declareSeats = true) {
  const ctx = new Context()
  const recorded: Recorded[] = []
  const opened: string[] = []
  const panels: (string | null)[] = []
  let refusal: string | undefined
  const answer = (value: unknown) => refusal === undefined
    ? Promise.resolve({ ok: true as const, value })
    : Promise.resolve({ ok: false as const, error: { code: 'knowledge/unavailable', message: refusal, details: {} } })
  const knowledge = {
    directory: () => {
      recorded.push({ call: 'directory' })
      return answer([{ knowledgeRef: REF_A, displayName: '临港知识库', description: '现场运维资料' }])
    },
    documents: (knowledgeRef: string, page?: number) => {
      recorded.push({ call: 'documents', knowledgeRef, ...(page === undefined ? {} : { page }) })
      return answer({ knowledgeRef, documents: [], page: page ?? 1, pageSize: 20, total: 0 })
    },
    documentContent: (docRef: string) => {
      recorded.push({ call: 'documentContent', docRef })
      return answer({ kind: 'text', docRef, fileName: '运维手册.pdf', text: '一级故障 30 分钟内响应。', truncated: false })
    },
    search: (query: string, mode: string, knowledgeRefs?: string[]) => {
      recorded.push({ call: 'search', query, mode, ...(knowledgeRefs === undefined ? {} : { knowledgeRefs }) })
      return answer({ query, searched: [], passages: [], truncated: false })
    },
    choose: (sessionId: string, mode: string, knowledgeRefs?: string[]) => {
      recorded.push({ call: 'choose', sessionId, mode, ...(knowledgeRefs === undefined ? {} : { knowledgeRefs }) })
      return answer({ choices: [], scope: { version: 1, mode: 'off' }, unavailable: [] })
    },
    chooseDocuments: (sessionId: string, documents: { docRef: string; title: string }[]) => {
      recorded.push({ call: 'chooseDocuments', sessionId, documents })
      return answer({ choices: [], scope: { version: 1, mode: 'off' }, unavailable: [] })
    },
  }
  ctx.provide('remote', { knowledge })
  ctx.provide('remote.knowledge', knowledge)
  ctx.provide('layout', { selectPanel: (id: string | null) => { panels.push(id) } })
  ctx.provide('sessions', {
    create: () => Promise.resolve(SID),
    open: (id: string) => { opened.push(id) },
  })
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  if (declareSeats) {
    slots.register({
      name: 'root',
      children: {
        'sidebar.panellist': { kind: 'list', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
      },
    } as never, () => null)
  }
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, fiber, slots, recorded, opened, panels,
    refuseNext: (message: string | undefined) => { refusal = message },
  }
}

/** The face one panel was registered with. */
function faceOf(b: Awaited<ReturnType<typeof bench>>, key: string): KnowledgeBasesInjected & KnowledgeSearchInjected {
  const entry = b.slots.entries('main').find(candidate => candidate.options.key === key)
  return (entry?.inject as unknown as () => KnowledgeBasesInjected & KnowledgeSearchInjected)()
}

describe('ui-knowledge-panels browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['locale', 'remote', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until the sidebar and the layout declare their seats', async () => {
    const b = await bench(false)
    expect(b.ctx.slots.entries('sidebar.panellist')).toHaveLength(0)
    b.ctx.slots.register({
      name: 'root',
      children: {
        'sidebar.panellist': { kind: 'list', scope: 'root' },
        'main': { kind: 'keyed', scope: 'root' },
      },
    } as never, () => null)
    await Promise.resolve()
    expect(b.ctx.slots.entries('sidebar.panellist')).toHaveLength(2)
    await b.fiber.dispose()
  })

  it('registers one row and one panel per surface, in reading order and in the active locale', async () => {
    const b = await bench()
    const rows = b.slots.entries('sidebar.panellist')
    expect(rows.map(row => row.options.id)).toEqual([BASES_PANEL, SEARCH_PANEL])
    // The label is a thunk read per row draw, so it follows the active locale
    // (English in this bench) without the entry being registered again.
    expect(rows.map(row => (row.options.label as () => string)())).toEqual(['Knowledge', 'Knowledge search'])
    const main = b.slots.entries('main')
    expect(main.map(entry => entry.options.key)).toEqual([BASES_PANEL, SEARCH_PANEL])
    expect(main.map(entry => entry.component)).toEqual([KnowledgeBasesPanel, KnowledgeSearchPanel])
    await b.fiber.dispose()
    expect(b.slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(b.slots.entries('main')).toHaveLength(0)
  })

  it('reads the directory through the Remote and folds a refusal into a rejection', async () => {
    const b = await bench()
    const face = faceOf(b, BASES_PANEL)
    await expect(face.directory()).resolves.toEqual([
      { knowledgeRef: REF_A, displayName: '临港知识库', description: '现场运维资料' },
    ])
    b.refuseNext('private knowledge could not be read')
    await expect(face.directory()).rejects.toThrow('private knowledge could not be read (knowledge/unavailable)')
    await b.fiber.dispose()
  })

  it('lists one knowledge base\u2019s documents, and folds a refusal into a rejection', async () => {
    const b = await bench()
    const face = faceOf(b, BASES_PANEL)
    await expect(face.documents(REF_A, 2)).resolves.toMatchObject({ knowledgeRef: REF_A, page: 2 })
    expect(b.recorded).toEqual([{ call: 'documents', knowledgeRef: REF_A, page: 2 }])
    b.refuseNext('that knowledge base is not available to this member')
    await expect(face.documents(REF_A, 1))
      .rejects.toThrow('that knowledge base is not available to this member (knowledge/unavailable)')
    await b.fiber.dispose()
  })

  it('reads one document\u2019s content through the Remote', async () => {
    const b = await bench()
    const face = faceOf(b, BASES_PANEL)
    await expect(face.content(`${REF_A}/doc-1`)).resolves.toMatchObject({ kind: 'text' })
    expect(b.recorded).toEqual([{ call: 'documentContent', docRef: `${REF_A}/doc-1` }])
    b.refuseNext('that document is not available')
    await expect(face.content(`${REF_A}/doc-1`))
      .rejects.toThrow('that document is not available (knowledge/unavailable)')
    await b.fiber.dispose()
  })

  it('asks for everything when nothing is selected, and for the selection when something is', async () => {
    const b = await bench()
    const face = faceOf(b, SEARCH_PANEL)
    await face.search('故障响应', [])
    await face.search('故障响应', [REF_A])
    expect(b.recorded).toEqual([
      { call: 'search', query: '故障响应', mode: 'all', knowledgeRefs: [] },
      { call: 'search', query: '故障响应', mode: 'selected', knowledgeRefs: [REF_A] },
    ])
    await b.fiber.dispose()
  })

  it('opens a discussion as one Session, narrowed to the document by its title before it is shown', async () => {
    const b = await bench()
    await faceOf(b, SEARCH_PANEL).discuss({ knowledgeRef: REF_A, docRef: `${REF_A}/doc-1`, title: '运维手册.pdf' })
    expect(b.recorded).toEqual([{
      call: 'chooseDocuments', sessionId: SID, documents: [{ docRef: `${REF_A}/doc-1`, title: '运维手册.pdf' }],
    }])
    expect(b.opened).toEqual([SID])
    // Leaving the panel is what puts the member in the conversation they just
    // opened, where the document sits above an empty composer.
    expect(b.panels).toEqual([null])
    await b.fiber.dispose()
  })

  it('falls back to the knowledge base for a result that named no document', async () => {
    const b = await bench()
    await faceOf(b, SEARCH_PANEL).discuss({ knowledgeRef: REF_A, title: '运维手册' })
    // The narrowest scope such a result supports: without a document
    // reference there is nothing narrower to record.
    expect(b.recorded).toEqual([{ call: 'choose', sessionId: SID, mode: 'selected', knowledgeRefs: [REF_A] }])
    await b.fiber.dispose()
  })

  it('records no scope and opens nothing when the choice is refused', async () => {
    const b = await bench()
    b.refuseNext('that knowledge base is not available to this member')
    await expect(faceOf(b, SEARCH_PANEL).discuss({ knowledgeRef: REF_A, docRef: `${REF_A}/doc-1`, title: '运维手册' }))
      .rejects.toThrow('that knowledge base is not available to this member (knowledge/unavailable)')
    expect(b.opened).toEqual([])
    await b.fiber.dispose()
  })
})
