/** The blank-session headline, greeting the member who is signed in. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation.hero.headline slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamAccountLauncherInjected } from './TeamAccountLauncher.tsx'
import { dayPartAt, type DayPart } from './day-parts.ts'
import css from './HeroGreeting.module.css'

/** Complete slot props for the hero greeting. */
export type HeroGreetingProps =
  PropsRuntime<'conversation.hero.headline'>
  & PropsLocale<'team.account'>
  & InjectFace<TeamAccountLauncherInjected>

/**
 * Follow the part of the day the greeting speaks from.
 *
 * A blank conversation can sit open across a boundary, so the line is read
 * from the clock rather than from the moment the page loaded.
 * @returns the current part, replaced as each one ends.
 */
function useDayPart(): DayPart {
  const [current, setCurrent] = useState(() => dayPartAt(new Date()))
  useEffect(() => {
    const timer = setTimeout(() => { setCurrent(dayPartAt(new Date())) }, current.endsIn)
    return () => { clearTimeout(timer) }
  }, [current])
  return current.part
}

/**
 * Greet the signed-in member above a new conversation.
 *
 * Until the identity arrives the line stays empty rather than greeting nobody:
 * this is the first thing on the page, and a name that appears and then changes
 * reads as the wrong member's.
 * @param props - the headline's own class, the locale seat, and the account reader.
 * @returns the greeting and its tagline, or an empty line until the member is known.
 */
export function HeroGreeting({ className, loadAccount, t }: HeroGreetingProps) {
  const [name, setName] = useState<string | undefined>(undefined)
  const part = useDayPart()

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
      <span>{t(`hero.${part}.greeting`, { name })}</span>
      <span className={css.tagline}>{t(`hero.${part}.tagline`)}</span>
    </span>
  )
}
