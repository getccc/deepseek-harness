/** The blank-session headline, greeting the member who is signed in. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation.hero.headline slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamAccountLauncherInjected } from './TeamAccountLauncher.tsx'
import { XIAOWEI_FACE_SIZE, XIAOWEI_FACE_SOURCE } from '../xiaowei-avatar.ts'
import { halfHourAt, type HalfHourWindow } from './day-parts.ts'
import css from './HeroGreeting.module.css'

/** Complete slot props for the hero greeting. */
export type HeroGreetingProps =
  PropsRuntime<'conversation.hero.headline'>
  & PropsLocale<'team.account'>
  & InjectFace<TeamAccountLauncherInjected>

/**
 * Follow the half hour the headline speaks from.
 *
 * A blank conversation can sit open across a boundary, so both lines are
 * read from the clock rather than from the moment the page loaded.
 * @returns the current part and half hour, replaced as each half hour ends.
 */
function useHalfHour(): HalfHourWindow {
  const [current, setCurrent] = useState(() => halfHourAt(new Date()))
  useEffect(() => {
    const timer = setTimeout(() => { setCurrent(halfHourAt(new Date())) }, current.endsIn)
    return () => { clearTimeout(timer) }
  }, [current])
  return current
}

/**
 * Greet the signed-in member above a new conversation, as 小微.
 *
 * Until the identity arrives the headline stays empty rather than greeting
 * nobody: this is the first thing on the page, and a name that appears and
 * then changes reads as the wrong member's. The face waits with the words so
 * the block lands once, not in two steps.
 * @param props - the headline's own class, the locale seat, and the account reader.
 * @returns 小微's face over the greeting for the part of the day and the tagline
 * for its half hour, or an empty line until the member is known.
 */
export function HeroGreeting({ className, loadAccount, t }: HeroGreetingProps) {
  const [name, setName] = useState<string | undefined>(undefined)
  const { part, halfHour } = useHalfHour()

  useEffect(() => {
    let alive = true
    void loadAccount().then(
      (member) => { if (alive) setName(member.displayName) },
      () => { /* the launcher below reports an unreadable identity */ },
    )
    return () => { alive = false }
  }, [loadAccount])

  if (name === undefined) return <span className={className} />
  return (
    <span className={`${className} ${css.greeting}`}>
      <img
        className={css.face}
        src={XIAOWEI_FACE_SOURCE}
        width={XIAOWEI_FACE_SIZE}
        height={XIAOWEI_FACE_SIZE}
        alt={t('assistant.name')}
      />
      <span>{t(`hero.${part}.greeting`, { name })}</span>
      <span className={css.tagline}>{t(`hero.tagline.${halfHour}`)}</span>
    </span>
  )
}
