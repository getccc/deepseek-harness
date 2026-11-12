/** Composer transcription chip registration and localized copy. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone and voice seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { TranscribeChip } from './TranscribeChip.tsx'
import { en, zh, type VoiceKey } from './locales.ts'

export type { VoiceKey } from './locales.ts'
export type { TranscribeChipProps } from './TranscribeChip.tsx'
export type { VoiceInputButtonProps } from './VoiceInputButton.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer voice controls' copy. */
    voice: VoiceKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'voice'

/** Required services: the controls' slot registry and the locale registry. */
export const inject = ['locale', 'slots']

/**
 * Register the transcription chip; the voice seat is reserved for functional input plugins.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // After the shipped web switch (50) and before the deployment-added
    // knowledge and office chips (100): recording is a chat-composer control,
    // and a member reads it next to the switch it sits beside in the design.
    order: 60,
    locale: NS,
  }, TranscribeChip))

}
