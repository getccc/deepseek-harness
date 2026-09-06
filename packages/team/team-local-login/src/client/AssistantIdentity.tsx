/** The header that opens each of 小微's turns in the transcript: face, name, role tag, and clock. */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation.chat.assistant-identity slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { XIAOWEI_FACE_SIZE, XIAOWEI_FACE_SOURCE } from '../xiaowei-avatar.ts'
import css from './AssistantIdentity.module.css'

/** Complete slot props for the turn identity header. */
export type AssistantIdentityProps =
  PropsRuntime<'conversation.chat.assistant-identity'>
  & PropsLocale<'team.account'>

/**
 * Open one turn's assistant activity with 小微's face, name, role tag, and the
 * turn's clock.
 *
 * The face hangs in the gutter left of the content column where the column
 * leaves room, so the name and everything below it share one left edge; the
 * name is the header's text, so the face is decorative to a screen reader.
 * @param props - the turn's streaming status and clock, and the locale seat.
 * @returns the identity header.
 */
export function AssistantIdentity({ status, clock, t }: AssistantIdentityProps) {
  return (
    <span className={css.identity} data-status={status}>
      <img
        className={css.face}
        src={XIAOWEI_FACE_SOURCE}
        width={XIAOWEI_FACE_SIZE}
        height={XIAOWEI_FACE_SIZE}
        alt=""
      />
      <span className={css.name}>{t('assistant.name')}</span>
      <span className={css.tag}>{t('assistant.tag')}</span>
      {clock !== undefined && <span className={css.clock}>{clock}</span>}
    </span>
  )
}
