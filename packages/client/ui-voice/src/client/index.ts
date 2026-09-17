/**
 * Composer voice plugin, browser half — the two controls the coming
 * record-and-transcribe and voice-input capability will drive: a chip in the
 * composer tool row beside the web switch, and a microphone button between the
 * model selector and the send action.
 *
 * Both are placed and inert. The seats, the order among the sibling chips, and
 * the copy are what this plugin settles now; each control says through
 * `aria-disabled` and its tooltip that the capability is not built, so the row
 * a member sees is the row the feature will arrive into. Neither control holds
 * state, reads a projection, or calls a Remote.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone and voice seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { TranscribeChip } from './TranscribeChip.tsx'
import { VoiceInputButton } from './VoiceInputButton.tsx'
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
 * Client plugin body: register the transcribe chip and the voice-input button.
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

  ctx.slots.inject('conversation.input.voice', () => ctx.slots.register({
    name: 'conversation.input.voice',
    locale: NS,
  }, VoiceInputButton))
}
