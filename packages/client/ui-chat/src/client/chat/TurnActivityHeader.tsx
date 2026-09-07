import { memo, useMemo } from 'react'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AssistantIdentityOwnerProps, ChatViewSlotProps, RenderAssistantIdentity } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { useCalendarDay } from './use-calendar-day.ts'

/** Props of the header that opens one Turn's assistant activity. */
export interface TurnActivityHeaderProps {
  /** The Turn whose activity the owning seat leads. */
  readonly turn: TurnLocation
  /** The leading Assistant step's own time, read when the Turn's start is outside the loaded window. */
  readonly stepTime: number | undefined
  readonly renderIdentity: RenderAssistantIdentity
  readonly t: ChatViewSlotProps['t']
}

/**
 * The identity header above the first row of a Turn's assistant activity.
 * Only the leading seat mounts it, so the calendar-day tick behind the clock
 * runs once per Turn rather than once per row.
 */
export const TurnActivityHeader = memo(function TurnActivityHeader({
  turn, stepTime, renderIdentity, t,
}: TurnActivityHeaderProps) {
  const day = useCalendarDay()
  const time = turn.start?.time ?? stepTime
  const identity = useMemo<AssistantIdentityOwnerProps>(() => ({
    turn: turn.turn,
    status: turn.status === 'open' ? 'running' : 'settled',
    clock: time === undefined ? undefined : formatMessageClock(time, t, day),
  }), [day, t, time, turn.status, turn.turn])
  return <>{renderIdentity(identity)}</>
})
