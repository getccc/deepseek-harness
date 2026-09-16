/** The composer control that will analyze a workspace's data and report on it. */

import { IconTrendOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './BiAnalysisChip.module.css'

/** Full control props: the composer zone's runtime share and the locale seat. */
export type BiAnalysisChipProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'bi'>

/**
 * Name the BI-analysis control in the composer tool row, after the office chip.
 *
 * The control is placed and inert: it holds the label, the glyph, and the seat
 * the analysis will drive, and states through `aria-disabled` and its tooltip
 * that the capability is not built, so nothing here promises a click will do
 * something. It renders for a work Session only, the composition the feature
 * is being built for.
 * @param props - the composer zone's runtime share and the locale seat.
 * @returns the control, or null outside a work Session.
 */
export function BiAnalysisChip({ sessionId, useSessions, t }: BiAnalysisChipProps) {
  const kind = useSessions(s => s.byId[sessionId]?.kind)

  if (kind !== 'work') return null

  return (
    <button
      type="button"
      className={css.trigger}
      aria-disabled="true"
      aria-label={t('chip.label')}
      title={t('chip.pending')}
    >
      <span className={css.icon} aria-hidden><IconTrendOutline14 size={14} /></span>
      <span className={css.label}>{t('chip.label')}</span>
    </button>
  )
}
