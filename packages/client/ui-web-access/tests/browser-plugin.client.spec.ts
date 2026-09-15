/**
 * ui-web-access browser half on a real SlotRegistry with fake Remote faces:
 * the plugin mounts the `webAccess` namespace, joins the conversation-declared
 * `conversation.input.left` list with the switch chip, records a set through
 * the Remote, folds a refusal into a user-visible failure line, and gives the
 * namespace and the entry back on teardown (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { WebAccessChip } from '../src/client/WebAccessChip.tsx'
import type { WebAccessChipInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-web' as SessionId

/** One recorded set, as the Remote received it. */
interface Recorded { sessionId: string; enabled: boolean | null }

/** Boot the plugin over fake Remote and slot faces. */
async function bench(declareZone = true) {
  const ctx = new Context()
  const recorded: Recorded[] = []
  let mounted = 0
  let refusal: string | undefined
  let stateRefusal: string | undefined
  const webAccess = {
    state: (sessionId: string) => {
      recorded.push({ sessionId, enabled: null })
      return stateRefusal === undefined
        ? Promise.resolve({ ok: true as const, value: { enabled: false } })
        : Promise.resolve({ ok: false as const, error: { code: 'web-access/unavailable', message: stateRefusal, details: {} } })
    },
    set: (sessionId: string, enabled: boolean) => {
      if (refusal !== undefined) {
        const message = refusal
        refusal = undefined
        return Promise.resolve({ ok: false as const, error: { code: 'web-access/unavailable', message, details: {} } })
      }
      recorded.push({ sessionId, enabled })
      return Promise.resolve({ ok: true as const, value: { enabled } })
    },
  }
  ctx.provide('remote', {
    webAccess,
    $mount: () => { mounted += 1; return Promise.resolve(() => { mounted -= 1; return Promise.resolve() }) },
  })
  ctx.provide('remote.webAccess', webAccess)
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  if (declareZone) {
    slots.register({
      name: 'root',
      children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
    } as never, () => null)
  }
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, fiber, recorded, slots, mounts: () => mounted,
    refuseNext: (message: string) => { refusal = message },
    refuseState: (message: string | undefined) => { stateRefusal = message },
  }
}

/** The chip's injected face for one Session. */
function face(b: Awaited<ReturnType<typeof bench>>): WebAccessChipInjected {
  const entry = b.slots.entries('conversation.input.left')[0]!
  return (entry.inject as unknown as (id: SessionId) => WebAccessChipInjected)(SID)
}

describe('ui-web-access browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['locale', 'remote', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the composer left zone', async () => {
    const b = await bench(false)
    expect(b.mounts()).toBe(1)
    expect(b.ctx.slots.entries('conversation.input.left')).toHaveLength(0)
    b.ctx.slots.register({
      name: 'root', children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(b.ctx.slots.entries('conversation.input.left')).toHaveLength(1)
    await b.fiber.dispose()
  })

  it('mounts the namespace, registers the chip, sets through the Remote, and gives both back on teardown', async () => {
    const b = await bench()
    expect(b.mounts()).toBe(1)
    const entry = b.slots.entries('conversation.input.left')[0]!
    expect(entry.component).toBe(WebAccessChip)
    const injected = face(b)

    // Offered exactly when the Host answers the state; a refusal hides the chip.
    await expect(injected.offered()).resolves.toBe(true)
    b.refuseState('this account is not allowed to search the web')
    await expect(injected.offered()).resolves.toBe(false)
    b.refuseState(undefined)
    expect(b.recorded).toEqual([{ sessionId: SID, enabled: null }, { sessionId: SID, enabled: null }])
    b.recorded.length = 0

    await expect(injected.setEnabled(true)).resolves.toBeNull()
    await expect(injected.setEnabled(false)).resolves.toBeNull()
    expect(b.recorded).toEqual([{ sessionId: SID, enabled: true }, { sessionId: SID, enabled: false }])

    // A refusal folds to the composer-visible line: the generated method
    // reports the RPC failure in its error branch.
    b.refuseNext('this conversation has no web switch')
    await expect(injected.setEnabled(true)).resolves.toBe('this conversation has no web switch (web-access/unavailable)')
    expect(b.recorded).toHaveLength(2)

    await b.fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
    expect(b.mounts()).toBe(0)
  })
})
