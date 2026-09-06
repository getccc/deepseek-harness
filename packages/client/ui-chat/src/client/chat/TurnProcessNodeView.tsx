import { memo, useMemo } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AssistantIdentityOwnerProps, ChatNodeViewProps } from '../contract/slots.ts'
import { formatMessageClock } from './message-chrome.ts'
import { useCalendarDay } from './use-calendar-day.ts'
import css from './TurnProcessNodeView.module.css'

/** Turn-level process disclosure controller. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, renderIdentity, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  // A shown control opens the Turn's activity, so it carries the identity
  // header above the process it summarizes; the Turn is closed by then.
  const day = useCalendarDay()
  const startTime = node.location.kind === 'turn' ? node.location.turn.start?.time : undefined
  const identity = useMemo<AssistantIdentityOwnerProps>(() => ({
    turn: node.data.turn,
    status: 'settled',
    clock: startTime === undefined ? undefined : formatMessageClock(startTime, t, day),
  }), [day, node.data.turn, startTime, t])
  if (!turnProcess.foldable) return null
  const open = turnProcess.open
  const labels: string[] = []
  if (node.data.toolCallCount > 0) {
    labels.push(t(
      node.data.toolCallCount === 1
        ? 'message.turnProcess.toolCalls.one'
        : 'message.turnProcess.toolCalls.other',
      { count: node.data.toolCallCount },
    ))
  }
  if (node.data.messageCount > 0) {
    labels.push(t(
      node.data.messageCount === 1
        ? 'message.turnProcess.messages.one'
        : 'message.turnProcess.messages.other',
      { count: node.data.messageCount },
    ))
  }
  if (node.data.subagentCount > 0) {
    labels.push(t(
      node.data.subagentCount === 1
        ? 'message.turnProcess.subagents.one'
        : 'message.turnProcess.subagents.other',
      { count: node.data.subagentCount },
    ))
  }
  const label = labels.length === 0
    ? t('message.turnProcess.thoughtForAWhile')
    : labels.join(t('message.turnProcess.separator'))
  return (
    <>
      {renderIdentity(identity)}
      <button
        type="button"
        className={css.root}
        data-open={open || undefined}
        data-turn-process={node.data.turn}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        aria-expanded={open}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <span className={css.label}>{label}</span>
        <IconChevronDownOutline14 className={css.chevron} />
      </button>
    </>
  )
})
