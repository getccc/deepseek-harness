/**
 * What the web chip reads and records: the Remote reads a Session's switch
 * from its log and sets it, refusing a conversation that is not open or one
 * whose composition offers no switch, and recording nothing for a value the
 * log already states.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WebAccessController } from '@deepseek-ai/dsh-api-web-access-controller'

/** One assembly: the controller over one open Session's log. */
interface Mounted {
  controller: WebAccessController
  events: { type: string; data: unknown }[]
}

/** Mount the controller with one open Session (or none), seeded with the given log, under a deployment that permits search or not. */
async function mount(open = true, seed: { type: string; data: unknown }[] = [], permitted = true): Promise<Mounted> {
  const ctx = new Context()
  const events = [...seed]
  ctx.provide('typert', { register: () => () => {} })
  ctx.provide('web', { searchPermitted: () => Promise.resolve(permitted) })
  const session = { events, snapshotEvents: () => events, append: (type: string, data: unknown) => { events.push({ type, data }) } }
  ctx.provide('agents', { get: () => open ? { session } : undefined })
  await ctx.plugin(WebAccessController).await()
  return { controller: ctx.get('webAccessController') as WebAccessController, events }
}

const OFF = { type: 'web/access', data: { enabled: false } }
const ON = { type: 'web/access', data: { enabled: true } }

describe('webAccess Remote', () => {
  it('reads the last logged value', async () => {
    const { controller } = await mount(true, [{ type: 'turn/start', data: { turn: 1 } }, OFF, ON, OFF])
    expect(await controller.state('s1')).toEqual({ enabled: false })
  })

  it('sets the switch by recording one web/access event, and records nothing for the value already in force', async () => {
    const { controller, events } = await mount(true, [OFF])
    expect(await controller.set('s1', true)).toEqual({ enabled: true })
    expect(events).toEqual([OFF, ON])
    expect(await controller.set('s1', true)).toEqual({ enabled: true })
    expect(events).toEqual([OFF, ON])
    expect(await controller.set('s1', false)).toEqual({ enabled: false })
    expect(events).toEqual([OFF, ON, OFF])
    expect(await controller.state('s1')).toEqual({ enabled: false })
  })

  it('refuses a conversation whose composition offers no switch', async () => {
    const { controller, events } = await mount(true, [{ type: 'turn/start', data: { turn: 1 } }])
    await expect(controller.state('s1')).rejects.toMatchObject({ code: 'web-access/unavailable' })
    await expect(controller.set('s1', true)).rejects.toMatchObject({ code: 'web-access/unavailable' })
    expect(events).toHaveLength(1)
  })

  it('refuses a member the deployment does not permit to search, recording nothing', async () => {
    const { controller, events } = await mount(true, [OFF], false)
    await expect(controller.state('s1')).rejects.toMatchObject({ code: 'web-access/unavailable' })
    await expect(controller.set('s1', true)).rejects.toMatchObject({ code: 'web-access/unavailable' })
    expect(events).toEqual([OFF])
  })

  it('refuses a blank or mistyped request payload', async () => {
    const { controller } = await mount(true, [OFF])
    await expect(controller.state('')).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.set('', true)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    await expect(controller.set('s1', 'yes' as unknown as boolean)).rejects.toMatchObject({ code: 'gateway/bad-request' })
  })

  it('refuses a conversation that is not open here', async () => {
    const { controller } = await mount(false)
    await expect(controller.state('s1')).rejects.toMatchObject({ code: 'web-access/session-not-open' })
    await expect(controller.set('s1', true)).rejects.toMatchObject({ code: 'web-access/session-not-open' })
  })
})
