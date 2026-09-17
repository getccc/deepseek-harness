/**
 * What the composer control reads and records: the Remote reads a Session's
 * folded project choice beside the directory it may choose from, records a new
 * choice with the name the directory holds now, and refuses a project the
 * member may not analyze, a conversation that is not open, and a directory it
 * cannot read.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { BiError, BiProjectRef, type BiProjectEntry } from '@deepseek-ai/dsh-bi'
import { BiController } from '@deepseek-ai/dsh-api-bi-controller'

const DEMO = BiProjectRef('webi:prod:690c0727-1af5-4b7a-8465-ebd2845f2266')
const SALES = BiProjectRef('webi:prod:08f25606-8876-49cc-b509-70e84828db08')

/** One assembly: the controller over one open Session's log and a scripted directory. */
interface Mounted {
  controller: BiController
  events: { type: string; data: unknown }[]
  /** What the next directory read answers with, or throws. */
  directory: () => Promise<readonly BiProjectEntry[]>
  /** How many times the directory was read. */
  reads: () => number
}

/** Mount the controller with one open Session (or none) over a directory of two projects. */
async function mount(open = true): Promise<Mounted> {
  const ctx = new Context()
  const events: { type: string; data: unknown }[] = []
  let reads = 0
  const state: Mounted = {
    controller: undefined as unknown as BiController,
    events,
    directory: () => Promise.resolve([{ ref: DEMO, displayName: 'Demo YH' }, { ref: SALES, displayName: '销售分析' }]),
    reads: () => reads,
  }
  ctx.provide('typert', { register: () => () => {} })
  ctx.provide('bi', { catalog: () => { reads += 1; return state.directory() } })
  const session = { events, snapshotEvents: () => events, append: (type: string, data: unknown) => { events.push({ type, data }) } }
  ctx.provide('agents', { get: () => open ? { session } : undefined })
  await ctx.plugin(BiController).await()
  state.controller = ctx.get('biController') as BiController
  return state
}

describe('reading what a Session may choose from', () => {
  it('answers the directory beside a Session that has chosen nothing', async () => {
    const { controller } = await mount()
    expect(await controller.scope('s1')).toEqual({
      choices: [{ projectRef: DEMO, displayName: 'Demo YH' }, { projectRef: SALES, displayName: '销售分析' }],
      scope: { version: 1, mode: 'off' },
      unavailable: false,
    })
  })

  it('reads the directory on every open rather than caching it', async () => {
    const { controller, reads } = await mount()
    await controller.scope('s1')
    await controller.scope('s1')
    expect(reads()).toBe(2)
  })

  it('reports a recorded project the directory no longer holds as unavailable, keeping the recorded name', async () => {
    const mounted = await mount()
    await mounted.controller.choose('s1', 'selected', SALES)
    mounted.directory = () => Promise.resolve([{ ref: DEMO, displayName: 'Demo YH' }])
    const view = await mounted.controller.scope('s1')
    expect(view.scope).toEqual({ version: 1, mode: 'selected', project: { ref: SALES, displayName: '销售分析' } })
    expect(view.unavailable).toBe(true)
  })

  it('carries a directory failure as its closed reason', async () => {
    const mounted = await mount()
    mounted.directory = () => Promise.reject(new BiError('unauthenticated', 'not signed in'))
    await expect(mounted.controller.scope('s1')).rejects.toMatchObject({
      code: 'bi/unavailable', details: { reason: 'unauthenticated' },
    })
    mounted.directory = () => Promise.reject(new Error('socket hang up'))
    await expect(mounted.controller.scope('s1')).rejects.toMatchObject({
      code: 'bi/unavailable', details: { reason: 'control-plane-unreachable' },
    })
  })
})

describe('recording a choice', () => {
  it('records a chosen project with the name the directory holds now, and reads it back', async () => {
    const { controller, events } = await mount()
    const view = await controller.choose('s1', 'selected', DEMO)
    expect(events).toEqual([{ type: 'bi/scope', data: { version: 1, mode: 'selected', project: { ref: DEMO, displayName: 'Demo YH' } } }])
    expect(view.scope).toEqual({ version: 1, mode: 'selected', project: { ref: DEMO, displayName: 'Demo YH' } })
    expect(view.unavailable).toBe(false)
  })

  it('records off to leave BI analysis', async () => {
    const { controller, events } = await mount()
    await controller.choose('s1', 'selected', DEMO)
    expect((await controller.choose('s1', 'off')).scope).toEqual({ version: 1, mode: 'off' })
    expect(events.at(-1)).toEqual({ type: 'bi/scope', data: { version: 1, mode: 'off' } })
  })

  it.each([
    ['a project the directory does not hold', 'webi:prod:00000000-0000-4000-8000-000000000000'],
    ['a reference that is not one', 'sales'],
  ])('refuses %s without recording anything', async (_label, projectRef) => {
    const { controller, events } = await mount()
    await expect(controller.choose('s1', 'selected', projectRef))
      .rejects.toMatchObject({ code: 'bi/not-available', details: { projectRef } })
    expect(events).toEqual([])
  })

  it('refuses a selection that names no project', async () => {
    const { controller, events } = await mount()
    await expect(controller.choose('s1', 'selected')).rejects.toMatchObject({ code: 'bi/no-project' })
    await expect(controller.choose('s1', 'selected', '')).rejects.toMatchObject({ code: 'bi/no-project' })
    expect(events).toEqual([])
  })

  it('refuses a blank or unknown request payload', async () => {
    const { controller } = await mount()
    await expect(controller.choose('', 'off')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.choose('s1', 'all')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.scope('')).rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('refuses a conversation that is not open here, before reading the directory', async () => {
    const { controller, reads } = await mount(false)
    await expect(controller.scope('s1')).rejects.toMatchObject({ code: 'bi/session-not-open' })
    await expect(controller.choose('s1', 'selected', DEMO)).rejects.toMatchObject({ code: 'bi/session-not-open' })
    expect(reads()).toBe(0)
  })
})
