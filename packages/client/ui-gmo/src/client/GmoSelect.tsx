/** The composer control choosing which GMO category this conversation analyzes. */

import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutlineRegular, IconDatabaseOutlineMedium, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `gmo` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-gmo/client'
import type { GmoChoice } from '@deepseek-ai/dsh-api-gmo-controller/types'
import css from './GmoSelect.module.css'

/** What one open of the control reads: the directory, and whether the recorded choice is still in it. */
export interface GmoDirectoryView {
  /** The categories this member may analyze right now. */
  readonly choices: readonly GmoChoice[]
  /** Whether the Session's recorded category is one the directory no longer holds. */
  readonly unavailable: boolean
}

/** What this control needs from the plugin that registered it. */
export interface GmoSelectInjected {
  /** The categories this member may analyze right now, read when the menu opens. */
  choices: () => Promise<GmoDirectoryView>
  /** Record one choice as the whole choice it makes: a category, or none. */
  apply: (categoryRef: string | undefined) => Promise<void>
}

/** Full control props: the composer zone's runtime share, the locale seat, and the plugin's face. */
export type GmoSelectProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<GmoSelectInjected>
  & PropsLocale<'gmo'>

/**
 * Choose this conversation's GMO category from the composer.
 *
 * Single-select: the chosen category is read from the `gmo` projection rather
 * than held here, so a reload or a second browser shows the same choice, and
 * the name shown is the one the Session recorded, which is what the prompt
 * says. The directory is read when the menu opens, so a grant revoked since
 * the last open narrows the rows. Clicking the chosen category again clears it.
 * @param props - the composer zone's runtime share, the account-side face, and the locale seat.
 * @returns the control, or null in a build whose Host folds no GMO scope or for
 * a chat Session, whose tool-less preset has no GMO tools to offer.
 */
export function GmoSelect({ sessionId, useSessions, useProjection, choices, apply, t }: GmoSelectProps) {
  const scope = useProjection('gmo')
  const kind = useSessions(s => s.byId[sessionId]?.kind)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<readonly GmoChoice[] | undefined>(undefined)
  const [stale, setStale] = useState(false)
  const [failed, setFailed] = useState(false)

  if (scope === undefined || kind === 'chat') return null

  const chosenRef = scope.mode === 'selected' ? scope.category.ref : undefined
  const label = scope.mode === 'selected' ? scope.category.displayName : t('chip.label')

  const items: MenuEntry[] = (rows ?? []).map(row => ({ id: row.categoryRef, label: row.displayName }))

  const footer = [
    ...failed ? [{ type: 'label' as const, id: 'failed', text: t('menu.failed') }] : [],
    ...stale ? [{ type: 'label' as const, id: 'unavailable', text: t('menu.unavailable') }] : [],
    ...rows !== undefined && rows.length === 0 ? [{ type: 'label' as const, id: 'empty', text: t('menu.empty') }] : [],
  ]

  const show = (): void => {
    setOpen(!open)
    if (open) return
    setFailed(false)
    void choices().then((view) => {
      setRows(view.choices)
      setStale(view.unavailable)
    }, () => { setFailed(true) })
  }

  const choose = (id: string): void => {
    setFailed(false)
    // Clicking the chosen category again leaves GMO supply-chain analysis.
    const next = id === chosenRef ? undefined : id
    // Close on success; keep the menu open on failure so its footer can show.
    void apply(next).then(() => { setOpen(false) }, () => { setFailed(true) })
  }

  return (
    <Menu
      open={open}
      items={items}
      {...footer.length === 0 ? {} : { footer }}
      selectedId={chosenRef}
      onSelect={choose}
      onClose={() => { setOpen(false) }}
      side="top"
      anchor={
        <button
          type="button"
          className={clsx(css.trigger, chosenRef !== undefined && css.triggerChosen)}
          aria-label={t('chip.aria', { state: chosenRef === undefined ? t('chip.none') : label })}
          title={t('chip.title')}
          onClick={show}
        >
          <span className={css.icon} aria-hidden><IconDatabaseOutlineMedium size={14} /></span>
          <span className={css.label}>{label}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutlineRegular />
          </span>
        </button>
      }
    />
  )
}
