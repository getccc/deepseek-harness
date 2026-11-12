/**
 * The browser half on a real cordis Context with fake slot and locale faces:
 * the plugin contributes the transcription chip and leaves the microphone seat free.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TranscribeChip } from '../src/client/TranscribeChip.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

/** Boot the plugin over a real slot registry and locale runtime. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'conversation.input.left': { kind: 'list', scope: 'session' },
      'conversation.input.voice': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  // No jsdom `window` in this lane, so browser-language detection never runs:
  // state the asserted locale explicitly.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, locale, slots }
}

describe('what the plugin installs', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['locale', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('seats the chip beside the web switch, leaves voice input free, and removes the chip on disposal', async () => {
    const b = await bench()
    const chip = b.slots.entries('conversation.input.left')[0]!
    expect(chip).toMatchObject({ locale: 'voice', options: { id: 'voice', order: 60 } })
    expect(chip.component).toBe(TranscribeChip)
    expect(b.slots.entries('conversation.input.voice')).toHaveLength(0)
    await b.fiber.dispose()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
    expect(b.slots.entries('conversation.input.voice')).toHaveLength(0)
  })

  it('registers the copy both controls read, in both languages', async () => {
    const b = await bench()
    expect(b.locale.bind('voice')('transcribe.label')).toBe('录音转写')
    b.locale.setLocale('en')
    expect(b.locale.bind('voice')('input.label')).toBe('Voice input')
    await b.fiber.dispose()
  })
})
