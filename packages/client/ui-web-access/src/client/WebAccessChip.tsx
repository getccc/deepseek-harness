/** The composer control switching web search and page fetching on or off for this conversation. */

import { useEffect, useRef, useState } from 'react'
import { IconGlobeOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `webAccess` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-web/client'
import css from './WebAccessChip.module.css'

/** What this control needs from the plugin that registered it. */
export interface WebAccessChipInjected {
  /**
   * Set the switch by executing `/web on` or `/web off`.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  setEnabled: (enabled: boolean) => Promise<string | null>
}

/** Full control props: the composer zone's runtime share, the plugin's face, and the locale seat. */
export type WebAccessChipProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<WebAccessChipInjected>
  & PropsLocale<'webAccess'>

/**
 * Switch this conversation's web access from the composer.
 *
 * The state is read from the `webAccess` projection rather than held here:
 * the `/web` command writes the same Session event, so whichever way a member
 * flipped it, the chip and the model agree a moment later. A click sends the
 * opposite of the projected state and waits for the projection to confirm.
 * @param props - the composer zone's runtime share, the plugin's face, and the locale seat.
 * @returns the control, or null for a Session whose composition offers no switch.
 */
export function WebAccessChip({ useProjection, setEnabled, t }: WebAccessChipProps) {
  const access = useProjection('webAccess')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  if (access === undefined || access.enabled === null) return null
  const on = access.enabled

  const flip = (): void => {
    setBusy(true)
    setError(null)
    void setEnabled(!on).then((failure) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={on ? `${css.trigger} ${css.triggerOn}` : css.trigger}
        aria-pressed={on}
        aria-label={t(on ? 'chip.on.aria' : 'chip.off.aria')}
        title={t(on ? 'chip.on.title' : 'chip.off.title')}
        disabled={busy}
        onClick={flip}
      >
        <span className={css.icon} aria-hidden><IconGlobeOutline14 size={14} /></span>
        <span className={css.label}>{t('chip.label')}</span>
      </button>
      {error !== null && <span className={css.error} role="status" title={error}>{t('chip.failed')}</span>}
    </span>
  )
}
