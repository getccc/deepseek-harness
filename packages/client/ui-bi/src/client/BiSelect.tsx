/** The composer control choosing which BI project this conversation analyzes. */

import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, IconTrendOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `bi` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-bi/client'
import type { BiChoice } from '@deepseek-ai/dsh-api-bi-controller/types'
import css from './BiSelect.module.css'

/** What one open of the control reads: the directory, and whether the recorded choice is still in it. */
export interface BiDirectoryView {
  /** The projects this member may analyze right now. */
  readonly choices: readonly BiChoice[]
  /** Whether the Session's recorded project is one the directory no longer holds. */
  readonly unavailable: boolean
}

/** What this control needs from the plugin that registered it. */
export interface BiSelectInjected {
  /** The projects this member may analyze right now, read when the menu opens. */
  choices: () => Promise<BiDirectoryView>
  /** Record one choice as the whole choice it makes: a project, or none. */
  apply: (projectRef: string | undefined) => Promise<void>
}

/** Full control props: the composer zone's runtime share, the locale seat, and the plugin's face. */
export type BiSelectProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<BiSelectInjected>
  & PropsLocale<'bi'>

/**
 * Choose this conversation's BI project from the composer.
 *
 * Single-select: the chosen project is read from the `bi` projection rather
 * than held here, so a reload or a second browser shows the same choice, and
 * the name shown is the one the Session recorded, which is what the prompt
 * says. The directory is read when the menu opens, so a grant revoked since
 * the last open narrows the rows. Clicking the chosen project again clears it.
 * @param props - the composer zone's runtime share, the account-side face, and the locale seat.
 * @returns the control, or null in a build whose Host folds no BI scope or for
 * a chat Session, whose tool-less preset has no chart to run.
 */
export function BiSelect({ sessionId, useSessions, useProjection, choices, apply, t }: BiSelectProps) {
  const scope = useProjection('bi')
  const kind = useSessions(s => s.byId[sessionId]?.kind)
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<readonly BiChoice[] | undefined>(undefined)
  const [stale, setStale] = useState(false)
  const [failed, setFailed] = useState(false)

  if (scope === undefined || kind === 'chat') return null

  const chosenRef = scope.mode === 'selected' ? scope.project.ref : undefined
  const label = scope.mode === 'selected' ? scope.project.displayName : t('chip.label')

  const items: MenuEntry[] = (rows ?? []).map(row => ({ id: row.projectRef, label: row.displayName }))

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
    // Clicking the chosen project again leaves BI analysis.
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
          <span className={css.icon} aria-hidden><IconTrendOutline14 size={14} /></span>
          <span className={css.label}>{label}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}
