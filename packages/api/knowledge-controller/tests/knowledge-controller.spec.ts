/**
 * What a picker may read and record, and what a panel may retrieve.
 *
 * The claim worth testing is that a recorded choice can only name knowledge
 * bases the member could search at the moment they chose — the log carries the
 * display names into a prompt, so a name it holds has to have been earned. A
 * member-run retrieval carries the opposite claim: it reaches no log at all,
 * so the tests pin that it appends nothing and needs no open Session.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  KnowledgeDocRef, KnowledgeError, KnowledgeRef,
  type KnowledgeBaseEntry, type KnowledgeDocumentPage, type KnowledgeDocumentsRequest,
  type KnowledgeSearchRequest, type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import { KnowledgeController, type KnowledgeScopeView } from '@deepseek-ai/dsh-api-knowledge-controller'

const REF_A = 'weknora:prod:690c0727-1af5-4b7a-8465-ebd2845f2266'
const REF_B = 'weknora:prod:08f25606-8876-49cc-b509-70e84828db08'

/** One authorized directory entry. */
function entry(ref: string, displayName: string): KnowledgeBaseEntry {
  return { ref: KnowledgeRef(ref), displayName, description: '', kind: 'document' }
}

/** One assembly: the controller over a scripted directory and one open Session. */
interface Mounted {
  controller: KnowledgeController
  /** The Session's log, which `choose` appends to. */
  events: { type: string; data: unknown }[]
  /** What the next directory read answers, or the failure it raises. */
  directory: readonly KnowledgeBaseEntry[] | Error
  /** What the next retrieval answers, or the failure it raises. */
  result: KnowledgeSearchResult | Error
  /** Every retrieval the controller asked for, in order. */
  searched: KnowledgeSearchRequest[]
  /** What the next document listing answers, or the failure it raises. */
  page: KnowledgeDocumentPage | Error
  /** Every document listing the controller asked for, in order. */
  listed: KnowledgeDocumentsRequest[]
}

/** One retrieved passage. */
function passage(ref: string, title: string, score: number): KnowledgeSearchResult['passages'][number] {
  return { ref: KnowledgeRef(ref), title, text: '一级故障 30 分钟内响应。', truncated: false, score }
}

/** Mount the controller with one open Session and a scripted knowledge service. */
async function mount(open = true): Promise<Mounted> {
  const ctx = new Context()
  const state: Mounted = {
    controller: undefined as unknown as KnowledgeController,
    events: [],
    directory: [entry(REF_A, '临港知识库'), entry(REF_B, '南昌知识库')],
    result: {
      query: '故障响应时间',
      searched: [entry(REF_A, '临港知识库')],
      passages: [passage(REF_A, '运维手册', 0.81), passage(REF_A, '值班制度', 0.42)],
      truncated: false,
    },
    searched: [],
    page: {
      ref: KnowledgeRef(REF_A),
      documents: [{
        docRef: KnowledgeDocRef(`${REF_A}/doc-1`),
        ref: KnowledgeRef(REF_A),
        title: '运维手册',
        fileName: '运维手册.pdf',
        fileType: 'pdf',
        byteSize: 20480,
        state: 'ready',
        updatedAt: 1756857600000,
      }],
      page: 1,
      pageSize: 20,
      total: 7,
    },
    listed: [],
  }
  ctx.provide('typert', { register: () => () => {} })
  ctx.provide('knowledge', {
    catalog: () => state.directory instanceof Error
      ? Promise.reject(state.directory)
      : Promise.resolve(state.directory),
    documents: (request: KnowledgeDocumentsRequest) => {
      state.listed.push(request)
      return state.page instanceof Error ? Promise.reject(state.page) : Promise.resolve(state.page)
    },
    search: (request: KnowledgeSearchRequest) => {
      state.searched.push(request)
      return state.result instanceof Error ? Promise.reject(state.result) : Promise.resolve(state.result)
    },
  })
  const session = {
    events: state.events,
    append: (type: string, data: unknown) => {
      state.events.push({ type, data })
    },
    snapshotEvents: () => state.events,
  }
  ctx.provide('agents', { get: () => open ? { session } : undefined })
  await ctx.plugin(KnowledgeController).await()
  state.controller = ctx.get('knowledgeController') as KnowledgeController
  return state
}

/** The scope one view reports. */
function scopeOf(view: KnowledgeScopeView): unknown {
  return view.scope
}

describe('what a picker reads', () => {
  it('offers the authorized directory and reports a Session that has chosen nothing', async () => {
    const mounted = await mount()
    const view = await mounted.controller.scope('session-1')
    expect(view.choices.map(choice => choice.displayName)).toEqual(['临港知识库', '南昌知识库'])
    expect(scopeOf(view)).toEqual({ version: 1, mode: 'off' })
    expect(view.unavailable).toEqual([])
  })

  it('reads the directory afresh, so a revoked grant narrows the picker', async () => {
    const mounted = await mount()
    expect((await mounted.controller.scope('session-1')).choices).toHaveLength(2)
    mounted.directory = [entry(REF_A, '临港知识库')]
    expect((await mounted.controller.scope('session-1')).choices).toHaveLength(1)
  })

  it('reports a stale selection rather than quietly shrinking it', async () => {
    const mounted = await mount()
    await mounted.controller.choose('session-1', 'selected', [REF_A, REF_B])
    mounted.directory = [entry(REF_A, '临港知识库')]
    const view = await mounted.controller.scope('session-1')
    // The recorded choice is unchanged; the member is told which part of it no
    // longer resolves and can decide what to do about it.
    expect(scopeOf(view)).toMatchObject({ mode: 'selected' })
    expect(view.unavailable).toEqual([REF_B])
  })

  it('refuses a conversation that is not open here', async () => {
    const mounted = await mount(false)
    await expect(mounted.controller.scope('session-1')).rejects.toMatchObject({
      code: 'knowledge/session-not-open',
    })
  })

  it('says why knowledge could not be read, rather than showing an empty list', async () => {
    const mounted = await mount()
    mounted.directory = new KnowledgeError('unauthenticated')
    await expect(mounted.controller.scope('session-1')).rejects.toMatchObject({
      code: 'knowledge/unavailable', details: { reason: 'unauthenticated' },
    })
  })

  it('reports an unexpected failure as the Control Plane being unreachable', async () => {
    const mounted = await mount()
    mounted.directory = new Error('the disk is on fire')
    await expect(mounted.controller.scope('session-1')).rejects.toMatchObject({
      code: 'knowledge/unavailable', details: { reason: 'control-plane-unreachable' },
    })
  })
})

describe('what a picker records', () => {
  it('records off and all without naming anything', async () => {
    const mounted = await mount()
    await mounted.controller.choose('session-1', 'all')
    expect(mounted.events.at(-1)).toEqual({ type: 'knowledge/scope', data: { version: 1, mode: 'all' } })
    await mounted.controller.choose('session-1', 'off')
    expect(mounted.events.at(-1)).toEqual({ type: 'knowledge/scope', data: { version: 1, mode: 'off' } })
  })

  it('records the display name beside each chosen reference', async () => {
    const mounted = await mount()
    await mounted.controller.choose('session-1', 'selected', [REF_A])
    // The prompt names knowledge bases from the log, so the name has to be in
    // the log rather than resolved later from a directory.
    expect(mounted.events.at(-1)).toEqual({
      type: 'knowledge/scope',
      data: {
        version: 1,
        mode: 'selected',
        bases: [{ ref: REF_A, displayName: '临港知识库' }],
      },
    })
  })

  it('answers with the scope as it now stands', async () => {
    const mounted = await mount()
    const view = await mounted.controller.choose('session-1', 'selected', [REF_B])
    expect(scopeOf(view)).toMatchObject({ mode: 'selected', bases: [{ displayName: '南昌知识库' }] })
  })

  it('refuses a reference this member is not authorized for, and records nothing', async () => {
    const mounted = await mount()
    mounted.directory = [entry(REF_A, '临港知识库')]
    await expect(mounted.controller.choose('session-1', 'selected', [REF_A, REF_B]))
      .rejects.toMatchObject({ code: 'knowledge/not-available', details: { knowledgeRef: REF_B } })
    expect(mounted.events).toEqual([])
  })

  it('refuses a reference that is not one at all', async () => {
    const mounted = await mount()
    await expect(mounted.controller.choose('session-1', 'selected', ['not-a-reference']))
      .rejects.toMatchObject({ code: 'knowledge/not-available' })
    expect(mounted.events).toEqual([])
  })

  it.each([
    ['an empty selection', 'selected', []],
    ['a selection with no list at all', 'selected', undefined],
  ])('refuses %s', async (_label, mode, refs) => {
    const mounted = await mount()
    await expect(mounted.controller.choose('session-1', mode, refs))
      .rejects.toMatchObject({ code: 'knowledge/empty-selection' })
    expect(mounted.events).toEqual([])
  })

  it.each([
    ['an unknown mode', 'everything', undefined],
    ['an empty session id', 'all', undefined],
  ])('refuses %s as a malformed request', async (label, mode, refs) => {
    const mounted = await mount()
    const sessionId = label === 'an empty session id' ? '' : 'session-1'
    await expect(mounted.controller.choose(sessionId, mode, refs))
      .rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('refuses to record in a conversation that is not open here', async () => {
    const mounted = await mount(false)
    await expect(mounted.controller.choose('session-1', 'all'))
      .rejects.toMatchObject({ code: 'knowledge/session-not-open' })
    expect(mounted.events).toEqual([])
  })
})

describe('what a member retrieves for themselves', () => {
  it('answers ranked passages, each naming the knowledge base it came from', async () => {
    const mounted = await mount()
    const view = await mounted.controller.search('故障响应时间', 'all')
    expect(mounted.searched).toEqual([{ query: '故障响应时间', scope: { mode: 'all' } }])
    expect(view.query).toBe('故障响应时间')
    expect(view.searched.map(choice => choice.displayName)).toEqual(['临港知识库'])
    expect(view.passages.map(row => [row.title, row.knowledgeName, row.score]))
      .toEqual([['运维手册', '临港知识库', 0.81], ['值班制度', '临港知识库', 0.42]])
  })

  it('appends nothing to the Session log and needs no Session at all', async () => {
    const mounted = await mount(false)
    await mounted.controller.search('故障响应时间', 'all')
    expect(mounted.events).toEqual([])
  })

  it('carries a selection and a requested maximum through unchanged', async () => {
    const mounted = await mount()
    await mounted.controller.search('故障响应时间', 'selected', [REF_A, REF_B], 5)
    expect(mounted.searched).toEqual([{
      query: '故障响应时间',
      scope: { mode: 'selected', refs: [REF_A, REF_B] },
      maxResults: 5,
    }])
  })

  it('names a passage from a knowledge base the answer did not name at all', async () => {
    const mounted = await mount()
    mounted.result = {
      query: '故障响应时间',
      searched: [],
      passages: [passage(REF_A, '运维手册', 0.81)],
      truncated: true,
    }
    const view = await mounted.controller.search('故障响应时间', 'all')
    // An unnamed source is shown as unnamed rather than dropped: the passage
    // was retrieved, and hiding it would tell the member less than it knows.
    expect(view.passages).toEqual([{
      knowledgeRef: REF_A, knowledgeName: '', title: '运维手册',
      text: '一级故障 30 分钟内响应。', truncated: false, score: 0.81,
    }])
    expect(view.truncated).toBe(true)
  })

  it.each([
    ['an empty selection', 'selected', [], 'knowledge/empty-selection'],
    ['a selection with no list at all', 'selected', undefined, 'knowledge/empty-selection'],
    ['a reference that is not one at all', 'selected', ['not-a-reference'], 'knowledge/not-available'],
  ])('refuses %s before reaching the Control Plane', async (_label, mode, refs, code) => {
    const mounted = await mount()
    await expect(mounted.controller.search('故障响应时间', mode, refs))
      .rejects.toMatchObject({ code })
    expect(mounted.searched).toEqual([])
  })

  it.each([
    ['an empty query', '', 'all'],
    ['the off mode, which is a Session choice rather than a retrieval', '故障响应时间', 'off'],
  ])('refuses %s as a malformed request', async (_label, query, mode) => {
    const mounted = await mount()
    await expect(mounted.controller.search(query, mode)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(mounted.searched).toEqual([])
  })

  it('reports the closed reason a refused retrieval carries', async () => {
    const mounted = await mount()
    mounted.result = new KnowledgeError('scope-incompatible')
    await expect(mounted.controller.search('故障响应时间', 'all')).rejects.toMatchObject({
      code: 'knowledge/unavailable', details: { reason: 'scope-incompatible' },
    })
  })
})

describe('what a panel reads before it retrieves', () => {
  it('answers the authorized directory without a Session', async () => {
    const mounted = await mount(false)
    expect(await mounted.controller.directory())
      .toEqual([
        { knowledgeRef: REF_A, displayName: '临港知识库', description: '' },
        { knowledgeRef: REF_B, displayName: '南昌知识库', description: '' },
      ])
  })

  it('says why the directory could not be read', async () => {
    const mounted = await mount()
    mounted.directory = new KnowledgeError('control-plane-unreachable')
    await expect(mounted.controller.directory()).rejects.toMatchObject({
      code: 'knowledge/unavailable', details: { reason: 'control-plane-unreachable' },
    })
  })
})

describe('what a member browses', () => {
  it('lists one knowledge base without a Session, naming each document by reference', async () => {
    const mounted = await mount(false)
    const view = await mounted.controller.documents(REF_A, 2, 5)
    expect(mounted.listed).toEqual([{ ref: REF_A, page: 2, pageSize: 5 }])
    expect(view).toEqual({
      knowledgeRef: REF_A,
      documents: [{
        docRef: `${REF_A}/doc-1`,
        knowledgeRef: REF_A,
        title: '运维手册',
        fileName: '运维手册.pdf',
        fileType: 'pdf',
        byteSize: 20480,
        state: 'ready',
        updatedAt: 1756857600000,
      }],
      page: 1,
      pageSize: 20,
      total: 7,
    })
    expect(mounted.events).toEqual([])
  })

  it('asks for no page when the caller names none', async () => {
    const mounted = await mount()
    await mounted.controller.documents(REF_A)
    expect(mounted.listed).toEqual([{ ref: REF_A }])
  })

  it('leaves out a timestamp and a total the source did not report', async () => {
    const mounted = await mount()
    mounted.page = {
      ref: KnowledgeRef(REF_A),
      documents: [{
        docRef: KnowledgeDocRef(`${REF_A}/doc-2`),
        ref: KnowledgeRef(REF_A),
        title: '值班制度',
        fileName: '',
        fileType: '',
        byteSize: 0,
        state: 'processing',
        updatedAt: undefined,
      }],
      page: 1,
      pageSize: 20,
      total: undefined,
    }
    const view = await mounted.controller.documents(REF_A)
    // The Remote boundary carries JSON: a field whose value is undefined is a
    // field that is not there, which is what "the source did not say" means.
    expect('total' in view).toBe(false)
    expect('updatedAt' in (view.documents[0] ?? {})).toBe(false)
  })

  it('refuses a reference that is not one, before reaching the Control Plane', async () => {
    const mounted = await mount()
    await expect(mounted.controller.documents('not-a-reference'))
      .rejects.toMatchObject({ code: 'knowledge/not-available' })
    expect(mounted.listed).toEqual([])
  })

  it.each([
    ['an empty reference', '', 1],
    ['a page below one', REF_A, 0],
  ])('refuses %s as a malformed request', async (_label, ref, page) => {
    const mounted = await mount()
    await expect(mounted.controller.documents(ref, page)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    expect(mounted.listed).toEqual([])
  })

  it('reports the closed reason a refused listing carries', async () => {
    const mounted = await mount()
    mounted.page = new KnowledgeError('not-allowed')
    await expect(mounted.controller.documents(REF_A)).rejects.toMatchObject({
      code: 'knowledge/unavailable', details: { reason: 'not-allowed' },
    })
  })
})
