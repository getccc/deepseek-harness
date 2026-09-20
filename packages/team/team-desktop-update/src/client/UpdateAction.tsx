/**
 * The update control beside the member row at the sidebar foot. One button
 * whose meaning is the shell's phase: an accepted release invites the
 * download, a running download draws its own share of the circle, and a
 * failure invites a retry. A build with nothing to install renders nothing,
 * so the sidebar foot is unchanged for a member who is already current.
 */

import { useEffect, useState, type ReactElement } from 'react'
import clsx from 'clsx'
import {
  IconDownloadOutline16, IconRefreshOutline16, IconWarningOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the team.account.action slot declaration into this program.
import type {} from '@deepseek-ai/dsh-team-local-login/client'
import type { DesktopUpdateState } from './desktop-bridge.ts'
import css from './UpdateAction.module.css'

/** Radius of the progress ring in its own 32-unit viewBox. */
const RING_RADIUS = 14

/** Registration-side operations for the update control. */
export interface UpdateActionInjected {
  /**
   * Observe the shell's update state.
   * @param listener - called with each state the shell publishes.
   * @returns a function that stops the subscription.
   */
  subscribe: (listener: (state: DesktopUpdateState) => void) => () => void
  /**
   * Ask the release stream now, so a page opened after the shell's own check
   * renders what that check found.
   * @returns the state the check settled on.
   */
  check: () => Promise<DesktopUpdateState>
  /**
   * Download the accepted release and restart into it.
   * @returns nothing; the window closes when the installer takes over.
   */
  install: () => Promise<void>
}

/** Complete slot props for the update control. */
export type UpdateActionProps =
  PropsRuntime<'team.account.action'>
  & PropsLocale<'team.update'>
  & InjectFace<UpdateActionInjected>

/** The ring drawn around a running download. */
function ProgressRing({ percent }: { percent?: number | undefined }) {
  const circumference = 2 * Math.PI * RING_RADIUS
  const drawn = percent === undefined ? circumference * 0.25 : circumference * (percent / 100)
  return (
    <svg className={clsx(css.ring, percent === undefined && css.spin)} viewBox="0 0 32 32" aria-hidden="true">
      <circle className={css.ringTrack} cx="16" cy="16" r={RING_RADIUS} />
      <circle
        className={css.ringHead}
        cx="16"
        cy="16"
        r={RING_RADIUS}
        strokeDasharray={`${drawn} ${circumference}`}
      />
    </svg>
  )
}

/** What one phase puts on the button: its glyph, its words, and what a click does. */
function presentation(state: DesktopUpdateState, t: UpdateActionProps['t']): {
  glyph: ReactElement
  label: string
  title: string
  act: 'install' | 'check' | 'none'
  tone: string
} | undefined {
  const version = state.version ?? ''
  switch (state.phase) {
    case 'available':
      return {
        glyph: <IconDownloadOutline16 />,
        label: t('available.label'),
        title: t('available.title', { version }),
        act: 'install',
        tone: css.offered ?? '',
      }
    case 'installing':
      return {
        glyph: <ProgressRing percent={state.percent} />,
        label: t('installing.label'),
        title: state.percent === undefined
          ? t('installing.title.unknown', { version })
          : t('installing.title', { version, percent: String(state.percent) }),
        act: 'none',
        tone: css.working ?? '',
      }
    case 'ready':
      return {
        glyph: <IconRefreshOutline16 />,
        label: t('ready.label'),
        title: t('ready.title', { version }),
        act: 'none',
        tone: css.working ?? '',
      }
    case 'error':
      return {
        glyph: <IconWarningOutline16 />,
        label: t('error.label'),
        title: t('error.title', { message: state.message ?? '' }),
        act: 'check',
        tone: css.failed ?? '',
      }
    // A current build and a check in flight are not the member's business.
    case 'idle':
    case 'checking':
      return undefined
  }
}

/**
 * Render the sidebar update control.
 * @param props - composed slot props and the shell's update operations.
 * @returns the control, or nothing while there is no update to act on.
 */
export function UpdateAction({ wide, subscribe, check, install, t }: UpdateActionProps) {
  const [state, setState] = useState<DesktopUpdateState>({ phase: 'idle' })

  useEffect(() => {
    const stop = subscribe(setState)
    // The shell may have finished its own check before this page mounted, and
    // a subscription only carries what happens next.
    void check().then(setState, () => {})
    return stop
  }, [subscribe, check])

  const shown = presentation(state, t)
  if (shown === undefined) return null

  return (
    <Tooltip label={shown.title} delayMs={300} side="top">
      <button
        type="button"
        className={clsx(css.action, shown.tone, wide ? css.wide : css.rail)}
        aria-label={shown.label}
        disabled={shown.act === 'none'}
        onClick={() => {
          if (shown.act === 'install') void install()
          if (shown.act === 'check') void check().then(setState, () => {})
        }}
      >
        <span className={css.glyph} aria-hidden="true">{shown.glyph}</span>
      </button>
    </Tooltip>
  )
}
