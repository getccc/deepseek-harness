/** The composer control choosing which office document this conversation should produce. */

import { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDownOutline14, IconListPenOutline16, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `office` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-office/client'
import type { OfficeKind } from '@deepseek-ai/dsh-office'
import css from './OfficeSelect.module.css'
import type { OfficeKey } from './locales.ts'

/**
 * The kinds this control offers, in display order. Mirrors the vocabulary's
 * `OFFICE_KINDS`; kept local because a client bundle may not import a runtime
 * value across plugins.
 */
const OFFICE_KINDS = ['word', 'excel', 'ppt', 'welinkin-ppt', 'chart'] as const satisfies readonly Exclude<OfficeKind, 'none'>[]

/** What this control needs from the plugin that registered it. */
export interface OfficeSelectInjected {
  /** Record one office-kind choice, as the whole choice it makes. */
  apply: (kind: OfficeKind) => Promise<void>
}

/** Full control props: the composer zone's runtime share, the locale seat, and the plugin's face. */
export type OfficeSelectProps =
  PropsRuntime<'conversation.input.left'>
  & InjectFace<OfficeSelectInjected>
  & PropsLocale<'office'>

/** One row's label key. */
function kindKey(kind: Exclude<OfficeKind, 'none'>): OfficeKey {
  return `kind.${kind}`
}

/**
 * Choose this conversation's office deliverable from the composer.
 *
 * Single-select: the chosen kind is read from the `office` projection rather
 * than held here, so a reload or a second browser shows the same choice.
 * Clicking the chosen kind again clears it back to no imposed format.
 * @param props - the composer zone's runtime share, the account-side face, and the locale seat.
 * @returns the control, or null in a build whose Host folds no office choice.
 */
export function OfficeSelect({ useProjection, apply, t }: OfficeSelectProps) {
  const choice = useProjection('office')
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)

  if (choice === undefined) return null

  const chosen = choice.kind !== 'none'
  const label = chosen ? t(kindKey(choice.kind)) : t('chip.label')

  const items: MenuEntry[] = OFFICE_KINDS.map(kind => ({ id: kind, label: t(kindKey(kind)) }))

  const choose = (id: string): void => {
    setFailed(false)
    // Clicking the chosen kind again clears the imposed format.
    const next = (id === choice.kind ? 'none' : id) as OfficeKind
    // Close on success; keep the menu open on failure so its footer can show.
    void apply(next).then(() => { setOpen(false) }, () => { setFailed(true) })
  }

  return (
    <Menu
      open={open}
      items={items}
      {...failed ? { footer: [{ type: 'label' as const, id: 'failed', text: t('menu.failed') }] } : {}}
      selectedId={chosen ? choice.kind : undefined}
      onSelect={choose}
      onClose={() => { setOpen(false) }}
      side="top"
      anchor={
        <button
          type="button"
          className={clsx(css.trigger, chosen && css.triggerChosen)}
          aria-label={t('chip.aria', { state: chosen ? label : t('chip.none') })}
          title={t('chip.title')}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.icon} aria-hidden><IconListPenOutline16 size={14} /></span>
          <span className={css.label}>{label}</span>
          <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
            <IconChevronDownOutline14 />
          </span>
        </button>
      }
    />
  )
}
