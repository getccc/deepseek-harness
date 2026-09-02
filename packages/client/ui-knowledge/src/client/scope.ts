/**
 * What the picker draws and what a picked set means.
 *
 * Kept apart from the plugin body so the mapping between a member's ticks and
 * the scope the Session records can be read and tested on its own: it is the
 * step where a UI gesture becomes a recorded fact the model will see.
 */

import type { KnowledgeChoice, KnowledgeScopeView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import type { SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import type { KnowledgeScope } from '@deepseek-ai/dsh-knowledge'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * The whole-set row's id.
 *
 * A `:` keeps it out of the reference space — a `KnowledgeRef` is
 * `provider:source:id`, three segments — so no knowledge base can ever collide
 * with it.
 */
export const ALL_ROW_ID = 'all'

/** One recorded choice, as the Remote takes it. */
export interface KnowledgeChoiceRequest {
  readonly mode: 'off' | 'all' | 'selected'
  readonly knowledgeRefs: string[]
}

/**
 * The rows one picker offers.
 *
 * A base the directory no longer holds is still listed, unticked and named as
 * unavailable, so a member sees what they are about to lose rather than
 * finding their choice silently shorter. The names come from the log for those
 * rows, because the directory is exactly where they stopped being.
 * @param view - the authorized directory, the Session's scope, and its stale references.
 * @param t - the `knowledge` namespace translator.
 * @returns the rows to draw, whole-set row first.
 */
export function optionsOf(view: KnowledgeScopeView, t: TranslateNS<'knowledge'>): SelectOption[] {
  const selected = view.scope.mode === 'selected' ? view.scope.bases : []
  const chosen = new Set(selected.map(base => base.ref as string))
  const rows: SelectOption[] = [{
    id: ALL_ROW_ID,
    label: t('option.all'),
    detail: t('option.all.detail'),
    exclusive: true,
    ...view.scope.mode === 'all' ? { active: true } : {},
  }]
  for (const choice of view.choices) rows.push(row(choice, chosen.has(choice.knowledgeRef)))
  for (const ref of view.unavailable) {
    rows.push({
      id: ref,
      label: selected.find(base => base.ref as string === ref)?.displayName ?? ref,
      detail: t('option.unavailable'),
    })
  }
  return rows
}

/** One authorized knowledge base's row. */
function row(choice: KnowledgeChoice, active: boolean): SelectOption {
  return {
    id: choice.knowledgeRef,
    label: choice.displayName,
    ...choice.description === '' ? {} : { detail: choice.description },
    ...active ? { active: true } : {},
  }
}

/**
 * What a ticked set asks the Session to record.
 *
 * Ticking nothing is how a member turns knowledge off: it is the same gesture
 * as unticking their last knowledge base, and reading it as "no change" would
 * leave them no way to stop searching.
 * @param options - the rows the member left ticked.
 * @returns the mode and references to record.
 */
export function choiceOf(options: readonly SelectOption[]): KnowledgeChoiceRequest {
  if (options.length === 0) return { mode: 'off', knowledgeRefs: [] }
  if (options.some(option => option.id === ALL_ROW_ID)) return { mode: 'all', knowledgeRefs: [] }
  return { mode: 'selected', knowledgeRefs: options.map(option => option.id) }
}

/**
 * The composer chip's line for one Session's scope.
 * @param scope - the Session's folded knowledge scope.
 * @param t - the `knowledge` namespace translator.
 * @returns the chip's text.
 */
export function chipLabel(scope: KnowledgeScope, t: TranslateNS<'knowledge'>): string {
  switch (scope.mode) {
    case 'off':
      // The bare noun: a control that says "off" spends the composer's width
      // on the state a conversation starts in and stays in unless asked.
      return t('chip.label')
    case 'all':
      return t('chip.all')
    case 'selected':
      return scope.bases.map(base => base.displayName).join('、')
  }
}

/**
 * The choice one click on a menu row makes, over the choice in force.
 *
 * The whole-set row and the individual ones displace each other, exactly as
 * they do in the picker: a member who clicks a knowledge base while everything
 * is chosen means that knowledge base, not everything plus it.
 * @param scope - the Session's current scope.
 * @param clicked - the row id that was clicked, `ALL_ROW_ID` or a reference.
 * @returns the choice to record.
 */
export function toggleScope(scope: KnowledgeScope, clicked: string): KnowledgeChoiceRequest {
  if (clicked === ALL_ROW_ID) {
    return scope.mode === 'all' ? { mode: 'off', knowledgeRefs: [] } : { mode: 'all', knowledgeRefs: [] }
  }
  const chosen = scope.mode === 'selected' ? scope.bases.map(base => base.ref as string) : []
  const refs = chosen.includes(clicked) ? chosen.filter(ref => ref !== clicked) : [...chosen, clicked]
  return refs.length === 0 ? { mode: 'off', knowledgeRefs: [] } : { mode: 'selected', knowledgeRefs: refs }
}

/**
 * The menu rows shown as chosen for one scope.
 * @param scope - the Session's current scope.
 * @returns the row ids to mark.
 */
export function chosenRows(scope: KnowledgeScope): readonly string[] {
  switch (scope.mode) {
    case 'off':
      return []
    case 'all':
      return [ALL_ROW_ID]
    case 'selected':
      return scope.bases.map(base => base.ref as string)
  }
}
