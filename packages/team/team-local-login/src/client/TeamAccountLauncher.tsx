/** Team member identity and actions at the bottom of the Runner sidebar. */

import { useEffect, useState } from 'react'
import {
  IconEllipsisOutline16, IconSettingsOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings.launcher slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import type { TeamAccountKey } from './locales.ts'
import css from './TeamAccountLauncher.module.css'

/** Public identity fields safe to show in the local application. */
export interface TeamMemberIdentity {
  /** Organization-local sign-in name. */
  readonly loginName: string
  /** Name shown in the application. */
  readonly displayName: string
}

/** Registration-side operations for the account launcher. */
export interface TeamAccountLauncherInjected {
  /** Read the signed-in member from the Runner-local authenticated endpoint. */
  loadAccount: () => Promise<TeamMemberIdentity>
  /** End the team credential and browser session through the local logout route. */
  signOut: () => void
}

/** Complete slot props for the account launcher. */
export type TeamAccountLauncherProps =
  PropsRuntime<'settings.launcher'>
  & PropsLocale<'team.account'>
  & InjectFace<TeamAccountLauncherInjected>

/** Door-and-arrow icon for the destructive sign-out row. */
function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.4 2.2H3.7c-.8 0-1.5.7-1.5 1.5v8.6c0 .8.7 1.5 1.5 1.5h2.7M9.2 5.1 12.1 8l-2.9 2.9M5.3 8h6.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** First visible character used when an account has no profile image. */
export function accountInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? ''
}

/**
 * Render the member avatar/name button and its account menu.
 * @param props - composed slot props and local account operations.
 * @returns the sidebar account launcher.
 */
export function TeamAccountLauncher({ wide, openSettings, loadAccount, signOut, t }: TeamAccountLauncherProps) {
  const [open, setOpen] = useState(false)
  const [member, setMember] = useState<TeamMemberIdentity | undefined>()

  useEffect(() => {
    let live = true
    void loadAccount().then(
      (account) => { if (live) setMember(account) },
      // A missing legacy identity keeps a neutral member label; sign-out and
      // Settings remain available instead of making the sidebar unusable.
      () => {},
    )
    return () => { live = false }
  }, [loadAccount])

  const label = member?.displayName ?? member?.loginName ?? t('memberFallback')

  return (
    <Menu
      className={css.menu ?? ''}
      open={open}
      onClose={() => { setOpen(false) }}
      side="top"
      align="start"
      portal
      items={[
        { id: 'settings', label: t('settings'), icon: <IconSettingsOutline16 /> },
        { id: 'sign-out', label: t('signOut'), icon: <SignOutIcon />, danger: true },
      ]}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'settings') openSettings()
        else signOut()
      }}
      anchor={(
        <button
          type="button"
          className={`${css.launcher} ${wide ? css.wide : css.rail} ${open ? css.open : ''}`}
          aria-label={`${t('menu')}: ${label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          title={member?.loginName ?? label}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className={css.avatar} aria-hidden="true">{accountInitial(label)}</span>
          {wide && <span className={css.name}>{label}</span>}
          {wide && <IconEllipsisOutline16 className={css.more} />}
        </button>
      )}
    />
  )
}

/** The locale key constraint used by this component's typed translator. */
export type { TeamAccountKey }
