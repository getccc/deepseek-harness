/**
 * The browser half on a real SlotRegistry: the plugin joins the
 * launcher-declared `team.account.action` list only when a desktop shell
 * exposes the bridge, passes the shell's three calls to the control, and gives
 * the entry back on teardown (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { UpdateAction, type UpdateActionInjected } from '../src/client/UpdateAction.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { DESKTOP_UPDATE_PROTOCOL, desktopUpdateBridge } from '../src/client/desktop-bridge.ts'

/** Install a shell bridge on the page for one test. */
function installBridge(protocolVersion = DESKTOP_UPDATE_PROTOCOL) {
  const stop = vi.fn()
  const bridge = {
    protocolVersion,
    check: vi.fn().mockResolvedValue({ phase: 'available', version: '2.4.0' }),
    install: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(() => stop),
  }
  ;(globalThis as { dshTeamDesktop?: unknown }).dshTeamDesktop = bridge
  return { bridge, stop }
}

/** Boot the browser half over a real registry and the launcher's declared list. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'team.account.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, slots }
}

afterEach(() => {
  delete (globalThis as { dshTeamDesktop?: unknown }).dshTeamDesktop
})

describe('desktop update browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['locale', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('registers nothing without a shell, and nothing for a shell of another protocol', async () => {
    const plain = await bench()
    expect(plain.slots.entries('team.account.action')).toHaveLength(0)
    await plain.fiber.dispose()

    installBridge(DESKTOP_UPDATE_PROTOCOL + 1)
    expect(desktopUpdateBridge()).toBeUndefined()
    const stranger = await bench()
    expect(stranger.slots.entries('team.account.action')).toHaveLength(0)
    await stranger.fiber.dispose()
  })

  it('registers the control over the shell bridge and gives the entry back on teardown', async () => {
    const { bridge } = installBridge()
    const b = await bench()
    const entry = b.slots.entries('team.account.action')[0]
    expect(entry?.component).toBe(UpdateAction)

    const injected = (entry?.inject as unknown as () => UpdateActionInjected)()
    const listener = vi.fn()
    injected.subscribe(listener)
    await injected.check()
    await injected.install()
    expect(bridge.subscribe).toHaveBeenCalledWith(listener)
    expect(bridge.check).toHaveBeenCalledTimes(1)
    expect(bridge.install).toHaveBeenCalledTimes(1)

    await b.fiber.dispose()
    expect(b.slots.entries('team.account.action')).toHaveLength(0)
  })
})
