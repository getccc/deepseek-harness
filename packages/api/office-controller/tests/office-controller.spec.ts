/**
 * What the office chip reads and records: the Remote reads a Session's folded
 * office choice and records a new one, refusing a kind this build does not know
 * and a conversation that is not open.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { OfficeController } from '@deepseek-ai/dsh-api-office-controller'

/** One assembly: the controller over one open Session's log. */
interface Mounted {
  controller: OfficeController
  events: { type: string; data: unknown }[]
}

/** Mount the controller with one open Session (or none). */
async function mount(open = true): Promise<Mounted> {
  const ctx = new Context()
  const events: { type: string; data: unknown }[] = []
  ctx.provide('typert', { register: () => () => {} })
  const session = { events, append: (type: string, data: unknown) => { events.push({ type, data }) } }
  ctx.provide('agents', { get: () => open ? { session } : undefined })
  await ctx.plugin(OfficeController).await()
  return { controller: ctx.get('officeController') as OfficeController, events }
}

describe('office Remote', () => {
  it('reads a Session that has chosen nothing as none', async () => {
    const { controller } = await mount()
    expect((await controller.scope('s1')).choice).toEqual({ version: 1, kind: 'none' })
  })

  it('records a chosen kind and reads it back', async () => {
    const { controller, events } = await mount()
    expect((await controller.choose('s1', 'ppt')).choice).toEqual({ version: 1, kind: 'ppt' })
    expect(events).toEqual([{ type: 'office/kind', data: { version: 1, kind: 'ppt' } }])
    expect((await controller.scope('s1')).choice).toEqual({ version: 1, kind: 'ppt' })
  })

  it('records none to clear an imposed format', async () => {
    const { controller } = await mount()
    expect((await controller.choose('s1', 'none')).choice).toEqual({ version: 1, kind: 'none' })
  })

  it('refuses a kind this build does not know', async () => {
    const { controller, events } = await mount()
    await expect(controller.choose('s1', 'pdf')).rejects.toMatchObject({ failure: { code: 'bad-request' } })
    expect(events).toEqual([])
  })

  it('refuses a blank request payload', async () => {
    const { controller } = await mount()
    await expect(controller.choose('', 'ppt')).rejects.toMatchObject({ failure: { code: 'bad-request' } })
    await expect(controller.scope('')).rejects.toMatchObject({ failure: { code: 'bad-request' } })
  })

  it('refuses a conversation that is not open here', async () => {
    const { controller } = await mount(false)
    await expect(controller.scope('s1')).rejects.toMatchObject({ failure: { code: 'not-found' } })
    await expect(controller.choose('s1', 'ppt')).rejects.toMatchObject({ failure: { code: 'not-found' } })
  })
})
