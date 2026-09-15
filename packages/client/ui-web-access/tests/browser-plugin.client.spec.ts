/**
 * ui-web-access browser half on a real SlotRegistry: the plugin joins the
 * conversation-declared `conversation.input.left` list with the web switch
 * chip; the injected face executes /web on|off and folds admission outcomes
 * into null (admitted) or a user-visible failure line; teardown removes the
 * entry (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { WebAccessChip } from '../src/client/WebAccessChip.tsx'
import type { WebAccessChipInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-web' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({ ok: true, value: { commandId: 'c1', result: { kind: 'success' as const } } }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, execute }
}

describe('ui-web-access browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the composer left zone', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('remote', { commands: {} })
    ctx.provide('remote.commands', {})
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.left')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.left')).toHaveLength(1)
  })

  it('registers the chip, executes /web on and off, and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.left')[0]!
    expect(entry.component).toBe(WebAccessChip)
    const injected = (entry.inject as unknown as (id: SessionId) => WebAccessChipInjected)(SID)

    await expect(injected.setEnabled(true)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web on', [])
    await expect(injected.setEnabled(false)).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/web off', [])

    // Business failure folds to the composer-visible line: the generated method
    // reports the RPC failure in its error branch.
    b.execute.mockResolvedValueOnce({
      ok: false,
      error: new RemoteError('session/not-found', 'gone', { sessionId: SID }),
    } as never)
    await expect(injected.setEnabled(true)).resolves.toBe('gone (session/not-found)')

    // Unmatched admission (no switch composed host-side) is also a failure line.
    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(injected.setEnabled(false)).resolves.toBe('unknown command: /web off')

    // The command's own refusal carries its text.
    b.execute.mockResolvedValueOnce({ ok: true, value: { commandId: 'c2', result: { kind: 'error', text: 'Usage: /web [on|off]' } } } as never)
    await expect(injected.setEnabled(true)).resolves.toBe('Usage: /web [on|off]')

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
  })
})
