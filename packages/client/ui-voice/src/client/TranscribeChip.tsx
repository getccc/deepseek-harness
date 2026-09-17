/** The composer control that will record a conversation and write its transcript. */

import { IconWaveformOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './TranscribeChip.module.css'

/** Full control props: the composer zone's runtime share and the locale seat. */
export type TranscribeChipProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'voice'>

/**
 * Name the recording control in the composer tool row, beside the web switch.
 *
 * The control is placed and inert: it holds the label, the glyph, and the seat
 * the recorder will drive, and states through `aria-disabled` and its tooltip
 * that the capability is not built, so nothing here promises a click will do
 * something. It renders for a chat Session only, the composition the feature
 * is being built for.
 * @param props - the composer zone's runtime share and the locale seat.
 * @returns the control, or null outside a chat Session.
 */
export function TranscribeChip({ sessionId, useSessions, t }: TranscribeChipProps) {
  const kind = useSessions(s => s.byId[sessionId]?.kind)

  if (kind !== 'chat') return null

  return (
    <button
      type="button"
      className={css.trigger}
      aria-disabled="true"
      aria-label={t('transcribe.label')}
      title={t('transcribe.pending')}
    >
      <span className={css.icon} aria-hidden><IconWaveformOutline14 size={14} /></span>
      <span className={css.label}>{t('transcribe.label')}</span>
    </button>
  )
}
