/**
 * The browser half on a real cordis Context with fake Remote and slot faces:
 * the plugin mounts the Team-only `gmo` namespace, seats the composer control
 * after the office chip, reads the directory and records a choice through the
 * Remote, and gives both back on teardown (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { GmoSelect, type GmoSelectInjected } from '../src/client/GmoSelect.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-gmo' as SessionId
const DEMO = 'exceltools:gmo:gb'

/** One recorded choice, as the Remote received it. */
interface Recorded { sessionId: string; mode: string; categoryRef?: string }

/** Boot the plugin over fake Remote and slot faces. */
async function bench(refuse?: string, refuseScope?: string) {
  const ctx = new Context()
  const recorded: Recorded[] = []
  let mounted = 0
  let refusal = refuse
  let scopeReads = 0
  const gmo = {
    scope: (_sessionId: string) => {
      scopeReads += 1
      if (refuseScope !== undefined) {
        return Promise.resolve({ ok: false as const, error: { code: 'gmo/unavailable', message: refuseScope, details: {} } })
      }
      return Promise.resolve({
        ok: true as const,
        value: { choices: [{ categoryRef: DEMO, displayName: 'GB / GL 分配' }], scope: { version: 1, mode: 'off' }, unavailable: false },
      })
    },
    choose: (sessionId: string, mode: string, categoryRef?: string) => {
      if (refusal !== undefined) {
        const message = refusal
        refusal = undefined
        return Promise.resolve({ ok: false as const, error: { code: 'gmo/not-available', message, details: {} } })
      }
      recorded.push(categoryRef === undefined ? { sessionId, mode } : { sessionId, mode, categoryRef })
      return Promise.resolve({ ok: true as const, value: { choices: [], scope: { version: 1, mode }, unavailable: false } })
    },
  }
  ctx.provide('remote', {
    gmo,
    $mount: () => { mounted += 1; return Promise.resolve(() => { mounted -= 1; return Promise.resolve() }) },
  })
  ctx.provide('remote.gmo', gmo)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  // No jsdom `window` in this lane, so browser-language detection never runs:
  // state the asserted locale explicitly.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, locale, recorded, slots, mounts: () => mounted, scopeReads: () => scopeReads }
}

/** The control's injected face for one Session. */
function face(b: Awaited<ReturnType<typeof bench>>): GmoSelectInjected {
  const seat = b.slots.entries('conversation.input.left')[0]!
  const inject: unknown = seat.inject
  if (typeof inject !== 'function') throw new Error('the composer seat holds no injected face')
  return (inject as (id: SessionId) => GmoSelectInjected)(SID)
}

describe('what the plugin installs', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['locale', 'remote', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('mounts the gmo namespace and seats the control after the BI chip, and gives both back', async () => {
    const b = await bench()
    expect(b.mounts()).toBe(1)
    const seat = b.slots.entries('conversation.input.left')[0]!
    expect(seat).toMatchObject({ locale: 'gmo', options: { id: 'gmo', order: 130 } })
    expect(seat.component).toBe(GmoSelect)
    await b.fiber.dispose()
    expect(b.mounts()).toBe(0)
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
  })

  it('registers the copy the control reads, in both languages', async () => {
    const b = await bench()
    expect(b.locale.bind('gmo')('chip.label')).toBe('GMO供应链')
    b.locale.setLocale('en')
    expect(b.locale.bind('gmo')('chip.label')).toBe('GMO supply chain')
    await b.fiber.dispose()
  })
})

describe('what the composer control is given', () => {
  it('reads the directory through the gmo Remote, with whether the recorded choice went stale', async () => {
    const b = await bench()
    expect(await face(b).choices()).toEqual({ choices: [{ categoryRef: DEMO, displayName: 'GB / GL 分配' }], unavailable: false })
    expect(b.scopeReads()).toBe(1)
  })

  it('records a chosen category, and none, through the gmo Remote', async () => {
    const b = await bench()
    await face(b).apply(DEMO)
    await face(b).apply(undefined)
    expect(b.recorded).toEqual([
      { sessionId: SID, mode: 'selected', categoryRef: DEMO },
      { sessionId: SID, mode: 'off' },
    ])
  })

  it('carries a directory refusal to the control that asked', async () => {
    const b = await bench(undefined, 'the GMO category directory could not be read')
    await expect(face(b).choices()).rejects.toThrow('the GMO category directory could not be read (gmo/unavailable)')
  })

  it('carries a refusal to the control that asked', async () => {
    const b = await bench('that GMO category is not available to this member')
    await expect(face(b).apply('exceltools:gmo:nope')).rejects.toThrow('that GMO category is not available to this member (gmo/not-available)')
  })
})
