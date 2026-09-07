/** The header that opens each of 小微's turns in the transcript: figure, name, role tag, and clock. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation.chat.assistant-identity slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { XIAOWEI_FIGURE_HEIGHT, XIAOWEI_FIGURE_SOURCE, XIAOWEI_FIGURE_WIDTH } from '../xiaowei-avatar.ts'
import css from './AssistantIdentity.module.css'

/** Complete slot props for the turn identity header. */
export type AssistantIdentityProps =
  PropsRuntime<'conversation.chat.assistant-identity'>
  & PropsLocale<'team.account'>

/**
 * Open one turn's assistant activity with 小微's figure, name, role tag, and the
 * turn's clock.
 *
 * The figure hangs in the gutter left of the content column where the column
 * leaves room, so the name and everything below it share one left edge; the
 * name is the header's text, so the figure is decorative to a screen reader.
 * @param props - the turn's streaming status and clock, and the locale seat.
 * @returns the identity header.
 */
export function AssistantIdentity({ status, clock, t }: AssistantIdentityProps) {
  return (
    <span className={css.identity} data-status={status}>
      <img
        className={css.figure}
        src={XIAOWEI_FIGURE_SOURCE}
        width={XIAOWEI_FIGURE_WIDTH}
        height={XIAOWEI_FIGURE_HEIGHT}
        alt=""
      />
      <span className={css.name}>{t('assistant.name')}</span>
      <span className={css.tag}>{t('assistant.tag')}</span>
      {clock !== undefined && <span className={css.clock}>{clock}</span>}
    </span>
  )
}
