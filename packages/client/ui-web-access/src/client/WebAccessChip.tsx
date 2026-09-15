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
   * Whether the Host offers this conversation a switch at all: the composition
   * mounts one and the deployment permits this member to search.
   * @returns true when the chip should render.
   */
  offered: () => Promise<boolean>
  /**
   * Set the switch through the `webAccess` Remote.
   * @returns null once recorded; a user-visible failure line otherwise.
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
 * the Remote and the `/web` command write the same Session event, so
 * whichever way a member flipped it, the chip and the model agree a moment
 * later. A click sends the opposite of the projected state and waits for the
 * projection to confirm.
 * The chip renders only once the Host has said the switch is offered to this
 * member: the projection alone cannot say that, because a member whose grant
 * was revoked still has the log an earlier session wrote.
 * @param props - the composer zone's runtime share, the plugin's face, and the locale seat.
 * @returns the control, or null for a Session that is offered no switch.
 */
export function WebAccessChip({ sessionId, useProjection, offered, setEnabled, t }: WebAccessChipProps) {
  const access = useProjection('webAccess')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Asked when the conversation opens, and again when the projection first
  // carries a value: the Host logs a fresh Session's initial value only after
  // its own permission decision lands, so an ask that raced ahead of it was
  // refused for a reason that has since gone.
  const projected = access !== undefined && access.enabled !== null
  useEffect(() => {
    setShown(false)
    void offered().then((yes) => {
      if (aliveRef.current) setShown(yes)
    }, () => {
      // An unanswered question hides the chip: a control the Host may refuse is
      // worse than none.
      if (aliveRef.current) setShown(false)
    })
  }, [sessionId, offered, projected])

  // Spelled out rather than through `projected` so the value narrows to a boolean.
  if (!shown || access === undefined || access.enabled === null) return null
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
