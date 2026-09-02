import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `knowledge` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-tool-knowledge/client'
import { chipLabel } from './scope.ts'
import css from './KnowledgeChip.module.css'

/** Full chip props: the composer zone's runtime share & the locale seat. */
export type KnowledgeChipProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'knowledge'>

/**
 * What this conversation may search, read from the host-computed `knowledge`
 * projection. It reports rather than acts: the choice is made in `/knowledge`,
 * and a chip that also changed it would be a second way to write the same
 * Session event.
 * @param props - the composer zone's runtime share and the locale seat.
 * @returns the chip, or null in a build whose Host folds no knowledge scope.
 */
export function KnowledgeChip({ useProjection, t }: KnowledgeChipProps) {
  const scope = useProjection('knowledge')
  if (scope === undefined) return null
  return (
    <span className={css.chip} title={t('chip.title')}>
      <span className={css.icon} aria-hidden><IconDataOutline16 size={14} /></span>
      <span className={css.label}>{chipLabel(scope, t)}</span>
    </span>
  )
}
