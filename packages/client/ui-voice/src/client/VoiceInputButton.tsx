/** The composer control that will dictate a draft, between the model selector and the send action. */

import { IconMicrophoneOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer voice seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './VoiceInputButton.module.css'

/** Full control props: the composer seat's runtime share, its owner share, and the locale seat. */
export type VoiceInputButtonProps =
  PropsRuntime<'conversation.input.voice'>
  & PropsLocale<'voice'>

/**
 * Name the voice-input control in the composer's trailing group.
 *
 * The control is placed and inert: it holds the microphone seat dictation will
 * drive, and states through `aria-disabled` and its tooltip that the
 * capability is not built. It follows the composer's locked state like its
 * neighbors, so a composer that refuses interaction does not leave one live
 * control behind, and renders for a chat Session only, the composition the
 * feature is being built for.
 * @param props - the composer seat's runtime share, its owner share, and the locale seat.
 * @returns the control, or null outside a chat Session.
 */
export function VoiceInputButton({ sessionId, useSessions, locked, t }: VoiceInputButtonProps) {
  const kind = useSessions(s => s.byId[sessionId]?.kind)

  if (kind !== 'chat') return null

  return (
    <button
      type="button"
      className={css.trigger}
      disabled={locked}
      aria-disabled="true"
      aria-label={t('input.label')}
      title={t('input.pending')}
    >
      <IconMicrophoneOutline16 size={16} />
    </button>
  )
}
