/**
 * What the composer control reads and records: the Remote reads a Session's
 * folded category choice beside the directory it may choose from, records a new
 * choice with the name the directory holds now, and refuses a category the
 * member may not analyze, a conversation that is not open, and a directory it
 * cannot read.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { GmoError, GmoCategoryRef, type GmoCategoryEntry } from '@deepseek-ai/dsh-gmo'
import { GmoController } from '@deepseek-ai/dsh-api-gmo-controller'

const DEMO = GmoCategoryRef('exceltools:gmo:gb')
const SALES = GmoCategoryRef('exceltools:gmo:mfc')

/** One assembly: the controller over one open Session's log and a scripted directory. */
interface Mounted {
  controller: GmoController
  events: { type: string; data: unknown }[]
  /** What the next directory read answers with, or throws. */
  directory: () => Promise<readonly GmoCategoryEntry[]>
  /** How many times the directory was read. */
  reads: () => number
}

/** Mount the controller with one open Session (or none) over a directory of two categories. */
async function mount(open = true): Promise<Mounted> {
  const ctx = new Context()
  const events: { type: string; data: unknown }[] = []
  let reads = 0
  // The directory is read through `state` so a test can replace it after mounting.
  const state = {
    events,
    directory: (): Promise<readonly GmoCategoryEntry[]> => Promise.resolve([{ ref: DEMO, displayName: 'GB / GL 分配' }, { ref: SALES, displayName: 'MFC 分配' }]),
    reads: () => reads,
  }
  ctx.provide('typert', { register: () => () => {} })
  ctx.provide('gmo', { catalog: () => { reads += 1; return state.directory() } })
  const session = { events, snapshotEvents: () => events, append: (type: string, data: unknown) => { events.push({ type, data }) } }
  ctx.provide('agents', { get: () => open ? { session } : undefined })
  await ctx.plugin(GmoController).await()
  return Object.assign(state, { controller: ctx.get('gmoController') as GmoController })
}

describe('reading what a Session may choose from', () => {
  it('answers the directory beside a Session that has chosen nothing', async () => {
    const { controller } = await mount()
    expect(await controller.scope('s1')).toEqual({
      choices: [{ categoryRef: DEMO, displayName: 'GB / GL 分配' }, { categoryRef: SALES, displayName: 'MFC 分配' }],
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

  it('reports a recorded category the directory no longer holds as unavailable, keeping the recorded name', async () => {
    const mounted = await mount()
    await mounted.controller.choose('s1', 'selected', SALES)
    mounted.directory = () => Promise.resolve([{ ref: DEMO, displayName: 'GB / GL 分配' }])
    const view = await mounted.controller.scope('s1')
    expect(view.scope).toEqual({ version: 1, mode: 'selected', category: { ref: SALES, displayName: 'MFC 分配' } })
    expect(view.unavailable).toBe(true)
  })

  it('carries a directory failure as its closed reason', async () => {
    const mounted = await mount()
    mounted.directory = () => Promise.reject(new GmoError('unauthenticated', 'not signed in'))
    await expect(mounted.controller.scope('s1')).rejects.toMatchObject({
      code: 'gmo/unavailable', details: { reason: 'unauthenticated' },
    })
    mounted.directory = () => Promise.reject(new Error('socket hang up'))
    await expect(mounted.controller.scope('s1')).rejects.toMatchObject({
      code: 'gmo/unavailable', details: { reason: 'control-plane-unreachable' },
    })
  })
})

describe('recording a choice', () => {
  it('records a chosen category with the name the directory holds now, and reads it back', async () => {
    const { controller, events } = await mount()
    const view = await controller.choose('s1', 'selected', DEMO)
    expect(events).toEqual([{ type: 'gmo/scope', data: { version: 1, mode: 'selected', category: { ref: DEMO, displayName: 'GB / GL 分配' } } }])
    expect(view.scope).toEqual({ version: 1, mode: 'selected', category: { ref: DEMO, displayName: 'GB / GL 分配' } })
    expect(view.unavailable).toBe(false)
  })

  it('records off to leave GMO supply-chain analysis', async () => {
    const { controller, events } = await mount()
    await controller.choose('s1', 'selected', DEMO)
    expect((await controller.choose('s1', 'off')).scope).toEqual({ version: 1, mode: 'off' })
    expect(events.at(-1)).toEqual({ type: 'gmo/scope', data: { version: 1, mode: 'off' } })
  })

  it.each([
    ['a category the directory does not hold', 'exceltools:gmo:nope'],
    ['a reference that is not one', 'sales'],
  ])('refuses %s without recording anything', async (_label, categoryRef) => {
    const { controller, events } = await mount()
    await expect(controller.choose('s1', 'selected', categoryRef))
      .rejects.toMatchObject({ code: 'gmo/not-available', details: { categoryRef } })
    expect(events).toEqual([])
  })

  it('refuses a selection that names no category', async () => {
    const { controller, events } = await mount()
    await expect(controller.choose('s1', 'selected')).rejects.toMatchObject({ code: 'gmo/no-category' })
    await expect(controller.choose('s1', 'selected', '')).rejects.toMatchObject({ code: 'gmo/no-category' })
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
    await expect(controller.scope('s1')).rejects.toMatchObject({ code: 'gmo/session-not-open' })
    await expect(controller.choose('s1', 'selected', DEMO)).rejects.toMatchObject({ code: 'gmo/session-not-open' })
    expect(reads()).toBe(0)
  })
})
