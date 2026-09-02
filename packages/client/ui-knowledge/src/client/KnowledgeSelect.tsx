/** The composer control naming — and choosing — what this conversation may search. */

import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, IconDataOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `knowledge` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-knowledge/client'
import type { KnowledgeChoice } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import { ALL_ROW_ID, chipLabel, chosenRows } from './scope.ts'
import css from './KnowledgeSelect.module.css'

/** What this control needs from the plugin that registered it. */
export interface KnowledgeSelectInjected {
  /** The knowledge bases this member may search right now. */
  choices: () => Promise<readonly KnowledgeChoice[]>
  /** Record one row click, as the whole choice it makes. */
  apply: (clicked: string) => Promise<void>
}

/** Full control props: the composer zone's runtime share, the locale seat, and the plugin's face. */
export type KnowledgeSelectProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<KnowledgeSelectInjected>
  & PropsLocale<'knowledge'>

/**
 * Choose this conversation's knowledge from the composer.
 *
 * The chosen rows are read from the `knowledge` projection rather than held
 * here: the picker opened by `/knowledge` writes the same Session event, so
 * whichever surface a member used, both show the same choice a moment later.
 * @param props - the composer zone's runtime share, the account-side face, and the locale seat.
 * @returns the control, or null in a build whose Host folds no knowledge scope.
 */
export function KnowledgeSelect({ useProjection, choices, apply, t }: KnowledgeSelectProps) {
  const scope = useProjection('knowledge')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<readonly KnowledgeChoice[]>([])
  const [failed, setFailed] = useState(false)

  if (scope === undefined) return null

  const chosen = chosenRows(scope)
  const label = chipLabel(scope, t)

  const items: MenuEntry[] = [
    { id: ALL_ROW_ID, label: t('chip.all') },
    ...rows.map(row => ({ id: row.knowledgeRef, label: row.displayName })),
  ]

  const show = (): void => {
    setOpen(!open)
    if (open) return
    setFailed(false)
    void choices().then(setRows, () => { setFailed(true) })
  }

  const choose = (id: string): void => {
    setFailed(false)
    // The menu stays open: a member choosing two knowledge bases should not
    // have to reopen it between them.
    void apply(id).catch(() => { setFailed(true) })
  }

  return (
    <Menu
      open={open}
      items={items}
      {...failed ? { footer: [{ type: 'label' as const, id: 'failed', text: t('menu.failed') }] } : {}}
      selectedIds={chosen}
      multiple
      onSelect={choose}
      onClose={() => { setOpen(false) }}
      side="top"
      anchor={
        <button
          type="button"
          className={clsx(css.trigger, scope.mode !== 'off' && css.triggerChosen)}
          aria-label={t('chip.aria', { state: label })}
          title={t('chip.title')}
          onClick={show}
        >
          <span className={css.icon} aria-hidden><IconDataOutline16 size={14} /></span>
          <span className={css.label}>{label}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}
