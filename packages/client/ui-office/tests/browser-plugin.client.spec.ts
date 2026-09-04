/**
 * The browser half on a real cordis Context with fake Remote and slot faces:
 * the plugin mounts the Team-only `office` namespace, seats the composer chip,
 * records a chosen kind, and gives both back on teardown (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DeliverablesService, ProducedFileRecognizer } from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { OfficeSelect, type OfficeSelectInjected } from '../src/client/OfficeSelect.tsx'
import { UNIVER_EXPORT_RECOGNIZER } from '../src/client/deliverables.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-office' as SessionId

/** One recorded choice, as the Remote received it. */
interface Recorded { sessionId: string; kind: string }

/** Boot the plugin over fake Remote and slot faces. */
async function bench(refuse?: string) {
  const ctx = new Context()
  const recorded: Recorded[] = []
  let mounted = 0
  let refusal = refuse
  const office = {
    scope: () => Promise.resolve({ ok: true as const, value: { choice: { version: 1, kind: 'none' } } }),
    choose: (sessionId: string, kind: string) => {
      if (refusal !== undefined) {
        const message = refusal
        refusal = undefined
        return Promise.resolve({ ok: false as const, error: { code: 'bad-request', message, details: {} } })
      }
      recorded.push({ sessionId, kind })
      return Promise.resolve({ ok: true as const, value: { choice: { version: 1, kind } } })
    },
  }
  ctx.provide('remote', {
    office,
    $mount: () => { mounted += 1; return Promise.resolve(() => { mounted -= 1; return Promise.resolve() }) },
  })
  ctx.provide('remote.office', office)
  const recognized: ProducedFileRecognizer[] = []
  const deliverables: DeliverablesService = {
    recognize: (recognizer) => {
      recognized.push(recognizer)
      return () => { recognized.splice(recognized.indexOf(recognizer), 1) }
    },
  }
  ctx.provide('deliverables', deliverables)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, fiber, recorded, recognized, slots, mounts: () => mounted, refuseNextChoice: (m: string) => { refusal = m },
  }
}

/** The control's injected face for one Session. */
function face(b: Awaited<ReturnType<typeof bench>>): OfficeSelectInjected {
  const seat = b.slots.entries('conversation.input.left')[0]!
  return (seat.inject as unknown as (id: SessionId) => OfficeSelectInjected)(SID)
}

describe('what the plugin installs', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['deliverables', 'locale', 'remote', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('mounts the office namespace and seats the composer chip, and gives both back', async () => {
    const b = await bench()
    expect(b.mounts()).toBe(1)
    const seat = b.slots.entries('conversation.input.left')[0]!
    expect(seat).toMatchObject({ locale: 'office', options: { id: 'office', order: 110 } })
    expect(seat.component).toBe(OfficeSelect)
    await b.fiber.dispose()
    expect(b.mounts()).toBe(0)
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
  })

  it('teaches the produced-files row the office export, and forgets it on teardown', async () => {
    const b = await bench()
    expect(b.recognized).toEqual([UNIVER_EXPORT_RECOGNIZER])
    // `univer_export` names the document it wrote in `output`; a call without one produced nothing.
    expect(UNIVER_EXPORT_RECOGNIZER.tool).toBe('univer_export')
    expect(UNIVER_EXPORT_RECOGNIZER.path({ file: 'docs/plan.univer', unitId: 'u-1', output: 'docs/plan.docx' }))
      .toBe('docs/plan.docx')
    expect(UNIVER_EXPORT_RECOGNIZER.path({ file: 'docs/plan.univer', unitId: 'u-1' })).toBeNull()
    expect(UNIVER_EXPORT_RECOGNIZER.path({ output: 7 })).toBeNull()
    await b.fiber.dispose()
    expect(b.recognized).toEqual([])
  })
})

describe('what the composer control is given', () => {
  it('records a chosen kind through the office Remote', async () => {
    const b = await bench()
    await face(b).apply('amec-ppt')
    expect(b.recorded).toEqual([{ sessionId: SID, kind: 'amec-ppt' }])
  })

  it('carries a refusal to the control that asked', async () => {
    const b = await bench('unknown office kind')
    await expect(face(b).apply('pdf' as never)).rejects.toThrow('unknown office kind (bad-request)')
  })
})
