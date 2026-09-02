/**
 * What a picker may read and what it may record.
 *
 * The claim worth testing is that a recorded choice can only name knowledge
 * bases the member could search at the moment they chose — the log carries the
 * display names into a prompt, so a name it holds has to have been earned.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { KnowledgeError, KnowledgeRef, type KnowledgeBaseEntry } from '@deepseek-ai/dsh-knowledge'
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
}

/** Mount the controller with one open Session and a scripted knowledge service. */
async function mount(open = true): Promise<Mounted> {
  const ctx = new Context()
  const state: Mounted = {
    controller: undefined as unknown as KnowledgeController,
    events: [],
    directory: [entry(REF_A, '临港知识库'), entry(REF_B, '南昌知识库')],
  }
  ctx.provide('typert', { register: () => () => {} })
  ctx.provide('knowledge', {
    catalog: () => state.directory instanceof Error
      ? Promise.reject(state.directory)
      : Promise.resolve(state.directory),
    search: () => Promise.reject(new Error('not used here')),
  })
  const session = {
    events: state.events,
    append: (type: string, data: unknown) => {
      state.events.push({ type, data })
    },
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
      failure: { code: 'not-found' },
    })
  })

  it('says why knowledge could not be read, rather than showing an empty list', async () => {
    const mounted = await mount()
    mounted.directory = new KnowledgeError('unauthenticated')
    await expect(mounted.controller.scope('session-1')).rejects.toMatchObject({
      failure: { code: 'unavailable', details: { reason: 'unauthenticated' } },
    })
  })

  it('reports an unexpected failure as the Control Plane being unreachable', async () => {
    const mounted = await mount()
    mounted.directory = new Error('the disk is on fire')
    await expect(mounted.controller.scope('session-1')).rejects.toMatchObject({
      failure: { code: 'unavailable', details: { reason: 'control-plane-unreachable' } },
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
      .rejects.toMatchObject({ failure: { code: 'bad-request', details: { knowledgeRef: REF_B } } })
    expect(mounted.events).toEqual([])
  })

  it('refuses a reference that is not one at all', async () => {
    const mounted = await mount()
    await expect(mounted.controller.choose('session-1', 'selected', ['not-a-reference']))
      .rejects.toMatchObject({ failure: { code: 'bad-request' } })
    expect(mounted.events).toEqual([])
  })

  it.each([
    ['an empty selection', 'selected', []],
    ['a selection with no list at all', 'selected', undefined],
  ])('refuses %s', async (_label, mode, refs) => {
    const mounted = await mount()
    await expect(mounted.controller.choose('session-1', mode, refs))
      .rejects.toMatchObject({ failure: { code: 'bad-request' } })
    expect(mounted.events).toEqual([])
  })

  it.each([
    ['an unknown mode', 'everything', undefined],
    ['an empty session id', 'all', undefined],
  ])('refuses %s as a malformed request', async (label, mode, refs) => {
    const mounted = await mount()
    const sessionId = label === 'an empty session id' ? '' : 'session-1'
    await expect(mounted.controller.choose(sessionId, mode, refs))
      .rejects.toMatchObject({ failure: { code: 'bad-request' } })
  })

  it('refuses to record in a conversation that is not open here', async () => {
    const mounted = await mount(false)
    await expect(mounted.controller.choose('session-1', 'all'))
      .rejects.toMatchObject({ failure: { code: 'not-found' } })
    expect(mounted.events).toEqual([])
  })
})
