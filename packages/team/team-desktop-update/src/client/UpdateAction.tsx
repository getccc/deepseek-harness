/**
 * The update control beside the member row at the sidebar foot. One button
 * whose meaning is the shell's phase: an accepted release invites the
 * download, a running download draws its own share of the circle, and a
 * failure invites a retry. A build with nothing to install renders nothing,
 * so the sidebar foot is unchanged for a member who is already current.
 */

import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import {
  IconDownloadOutlineRegular, IconRefreshOutlineRegular, IconWarningOutlineRegular, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the team.account.action slot declaration into this program.
import type {} from '@deepseek-ai/dsh-team-local-login/client'
import type { DesktopUpdateState } from './desktop-bridge.ts'
import css from './UpdateAction.module.css'

/** Radius of the progress ring in its own 32-unit viewBox. */
const RING_RADIUS = 14

/** The two bars a paused download shows in place of its ring. */
function PauseGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.5" y="1.5" width="2.6" height="9" rx="1" fill="currentColor" />
      <rect x="6.9" y="1.5" width="2.6" height="9" rx="1" fill="currentColor" />
    </svg>
  )
}

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
  /**
   * Stop the download in flight.
   * @returns when the download has been told to stop.
   */
  pause: () => Promise<void>
}

/** Complete slot props for the update control. */
export type UpdateActionProps =
  PropsRuntime<'team.account.action'>
  & PropsLocale<'team.update'>
  & InjectFace<UpdateActionInjected>

/**
 * The ring drawn around a running download, with the percentage inside it.
 *
 * The number is the point of the ring at this size: a member wants to know
 * whether a 295 MB transfer is a minute or a quarter of an hour from done,
 * which the arc alone does not say.
 */
function ProgressRing({ percent }: { percent?: number | undefined }) {
  const circumference = 2 * Math.PI * RING_RADIUS
  const drawn = percent === undefined ? circumference * 0.25 : circumference * (percent / 100)
  return (
    <span className={css.ringWrap}>
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
      {percent !== undefined && <span className={css.ringLabel}>{percent}</span>}
    </span>
  )
}

/** What one phase puts on the button: its glyph, its words, and what a click does. */
function presentation(state: DesktopUpdateState, t: UpdateActionProps['t']): {
  glyph: ReactElement
  label: string
  title: string
  act: 'install' | 'check' | 'pause' | 'none'
  tone: string
} | undefined {
  const version = state.version ?? ''
  switch (state.phase) {
    case 'available':
      return {
        glyph: <IconDownloadOutlineRegular />,
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
        // The same button stops it, which is where a member looks for that.
        act: 'pause',
        tone: css.working ?? '',
      }
    case 'paused':
      return {
        glyph: <PauseGlyph />,
        label: t('paused.label'),
        title: t('paused.title', { version }),
        act: 'install',
        tone: css.offered ?? '',
      }
    case 'ready':
      return {
        glyph: <IconRefreshOutlineRegular />,
        label: t('ready.label'),
        title: t('ready.title', { version }),
        act: 'none',
        tone: css.working ?? '',
      }
    case 'error':
      return {
        glyph: <IconWarningOutlineRegular />,
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
export function UpdateAction({ wide, subscribe, check, install, pause, t }: UpdateActionProps) {
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

  // The deployment refuses this build: the control stays, and the member is
  // also told in front of everything, because nothing they do in the
  // application counts until the update is taken.
  const blockade = state.required !== true ? null : createPortal(
    <div className={css.blockade} role="alertdialog" aria-modal="true" aria-label={t('required.title')}>
      <div className={css.blockadeCard}>
        <div className={css.blockadeTitle}>{t('required.title')}</div>
        <div className={css.blockadeBody}>{t('required.body', { version: state.version ?? '' })}</div>
        <button
          type="button"
          className={css.blockadeButton}
          disabled={state.phase !== 'available'}
          onClick={() => { void install() }}
        >
          {t(state.phase === 'available' ? 'required.action' : 'required.working')}
        </button>
      </div>
    </div>,
    globalThis.document.body,
  )

  return (
    <>
      {blockade}
      <Tooltip label={shown.title} delayMs={300} side="top">
        <button
          type="button"
          className={clsx(css.action, shown.tone, wide ? css.wide : css.rail)}
          aria-label={shown.label}
          disabled={shown.act === 'none'}
          onClick={() => {
            if (shown.act === 'install') void install()
            if (shown.act === 'pause') void pause()
            if (shown.act === 'check') void check().then(setState, () => {})
          }}
        >
          <span className={css.glyph} aria-hidden="true">{shown.glyph}</span>
        </button>
      </Tooltip>
    </>
  )
}
