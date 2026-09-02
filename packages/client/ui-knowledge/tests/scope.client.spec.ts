/**
 * The step where a member's ticks become a recorded fact.
 *
 * What is asserted here is the mapping in both directions: what the picker
 * shows for a scope, and what a ticked set asks the Session to record. The
 * model reads the result of this mapping, so a row that lies about the current
 * choice, or a set that records something the member did not tick, is a
 * defect in what the model is told.
 */

import { describe, expect, it } from 'vitest'
import type { KnowledgeScopeView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import type { KnowledgeRef, KnowledgeScope } from '@deepseek-ai/dsh-knowledge'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '../src/client/locales.ts'
import { ALL_ROW_ID, chipLabel, choiceOf, chosenRows, optionsOf, toggleScope } from '../src/client/scope.ts'

const REF_A = 'weknora:prod:690c0727' as KnowledgeRef
const REF_B = 'weknora:prod:08f25606' as KnowledgeRef

const t = makeTranslate(zh, commonZh) as unknown as Parameters<typeof optionsOf>[1]

/** One directory answer over two knowledge bases. */
function view(scope: KnowledgeScope, unavailable: readonly string[] = []): KnowledgeScopeView {
  return {
    choices: [
      { knowledgeRef: REF_A, displayName: '临港知识库', description: '园区运维手册' },
      { knowledgeRef: REF_B, displayName: '南昌知识库', description: '' },
    ],
    scope,
    unavailable,
  }
}

describe('what the picker shows', () => {
  it('offers the whole-set row first, and it cannot be ticked beside a base', () => {
    const rows = optionsOf(view({ version: 1, mode: 'off' }), t)
    expect(rows[0]).toMatchObject({ id: ALL_ROW_ID, label: '全部已授权知识库', exclusive: true })
    expect(rows.map(row => row.label)).toEqual(['全部已授权知识库', '临港知识库', '南昌知识库'])
    expect(rows.some(row => row.active === true)).toBe(false)
  })

  it('opens with the current choice already ticked', () => {
    const selected = optionsOf(view({
      version: 1, mode: 'selected', bases: [{ ref: REF_B, displayName: '南昌知识库' }],
    }), t)
    expect(selected.filter(row => row.active === true).map(row => row.id)).toEqual([REF_B])
    const all = optionsOf(view({ version: 1, mode: 'all' }), t)
    expect(all.filter(row => row.active === true).map(row => row.id)).toEqual([ALL_ROW_ID])
  })

  it('carries a description as the row detail, and omits an empty one', () => {
    const rows = optionsOf(view({ version: 1, mode: 'off' }), t)
    expect(rows[1]).toMatchObject({ detail: '园区运维手册' })
    expect(rows[2]).not.toHaveProperty('detail')
  })

  it('still names a base that went away, unticked and said to be gone', () => {
    // The member is shown what they are about to lose. The name comes from the
    // log, because the directory is exactly where it stopped being.
    const rows = optionsOf(view({
      version: 1, mode: 'selected', bases: [{ ref: REF_A, displayName: '归档知识库' }],
    }, [REF_A]), t)
    const gone = rows.at(-1)
    expect(gone).toMatchObject({ id: REF_A, label: '归档知识库' })
    expect(gone?.detail).toContain('已不可用')
    expect(gone?.active).toBeUndefined()
  })

  it('falls back to the reference when the log holds no name for a stale one', () => {
    const rows = optionsOf(view({ version: 1, mode: 'all' }, [REF_B]), t)
    expect(rows.at(-1)).toMatchObject({ id: REF_B, label: REF_B })
  })
})

describe('what a ticked set records', () => {
  it('reads an empty set as off, which is how a member stops searching', () => {
    expect(choiceOf([])).toEqual({ mode: 'off', knowledgeRefs: [] })
  })

  it('reads the whole-set row as all, naming nothing', () => {
    expect(choiceOf([{ id: ALL_ROW_ID, label: '全部已授权知识库' }]))
      .toEqual({ mode: 'all', knowledgeRefs: [] })
  })

  it('reads ticked bases as exactly those references', () => {
    expect(choiceOf([{ id: REF_A, label: '临港知识库' }, { id: REF_B, label: '南昌知识库' }]))
      .toEqual({ mode: 'selected', knowledgeRefs: [REF_A, REF_B] })
  })
})

/** The two scopes that name nothing, and the line each one reads as. */
const NAMELESS: readonly (readonly [string, KnowledgeScope, string])[] = [
  ['off', { version: 1, mode: 'off' }, '知识库'],
  ['all', { version: 1, mode: 'all' }, '全部已授权知识库'],
]

describe('what the chip says', () => {
  it.each(NAMELESS)('names the %s mode', (_label, scope, expected) => {
    expect(chipLabel(scope, t)).toBe(expected)
  })

  it('names every chosen knowledge base, as the prompt does', () => {
    expect(chipLabel({
      version: 1,
      mode: 'selected',
      bases: [{ ref: REF_A, displayName: '临港知识库' }, { ref: REF_B, displayName: '南昌知识库' }],
    }, t)).toBe('临港知识库、南昌知识库')
  })
})

describe('what one click on a menu row changes', () => {
  const chosen = (refs: readonly string[]): KnowledgeScope => (refs.length === 0
    ? { version: 1, mode: 'off' }
    : { version: 1, mode: 'selected', bases: refs.map(ref => ({ ref: ref as KnowledgeRef, displayName: ref })) })

  it('turns the whole-set row on, and off again', () => {
    expect(toggleScope({ version: 1, mode: 'off' }, ALL_ROW_ID)).toEqual({ mode: 'all', knowledgeRefs: [] })
    expect(toggleScope({ version: 1, mode: 'all' }, ALL_ROW_ID)).toEqual({ mode: 'off', knowledgeRefs: [] })
  })

  it('adds and removes one knowledge base, and reads the last removal as off', () => {
    expect(toggleScope(chosen([]), REF_A)).toEqual({ mode: 'selected', knowledgeRefs: [REF_A] })
    expect(toggleScope(chosen([REF_A, REF_B]), REF_A)).toEqual({ mode: 'selected', knowledgeRefs: [REF_B] })
    expect(toggleScope(chosen([REF_A]), REF_A)).toEqual({ mode: 'off', knowledgeRefs: [] })
  })

  it('reads a knowledge base clicked while everything is chosen as that one alone', () => {
    // The two rows displace each other here exactly as they do in the picker.
    expect(toggleScope({ version: 1, mode: 'all' }, REF_A)).toEqual({ mode: 'selected', knowledgeRefs: [REF_A] })
  })

  it('marks the rows one scope has chosen', () => {
    expect(chosenRows({ version: 1, mode: 'off' })).toEqual([])
    expect(chosenRows({ version: 1, mode: 'all' })).toEqual([ALL_ROW_ID])
    expect(chosenRows(chosen([REF_A, REF_B]))).toEqual([REF_A, REF_B])
  })
})
