/** The blank-session headline, greeting the member who is signed in. */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation.hero.headline slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TeamAccountLauncherInjected } from './TeamAccountLauncher.tsx'

/** Complete slot props for the hero greeting. */
export type HeroGreetingProps =
  PropsRuntime<'conversation.hero.headline'>
  & PropsLocale<'team.account'>
  & InjectFace<TeamAccountLauncherInjected>

/**
 * Greet the signed-in member above a new conversation.
 *
 * Until the identity arrives the line stays empty rather than greeting nobody:
 * this is the first thing on the page, and a name that appears and then changes
 * reads as the wrong member's.
 * @param props - the headline's own class, the locale seat, and the account reader.
 * @returns the greeting line, or an empty one until the member is known.
 */
export function HeroGreeting({ className, loadAccount, t }: HeroGreetingProps) {
  const [name, setName] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void loadAccount().then(
      (member) => { if (alive) setName(member.displayName) },
      () => { /* the launcher below reports an unreadable identity */ },
    )
    return () => { alive = false }
  }, [loadAccount])

  return <span className={className}>{name === undefined ? '' : t('hero.greeting', { name })}</span>
}
