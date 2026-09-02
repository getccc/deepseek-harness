// @vitest-environment jsdom
/**
 * The chip over the `knowledge` projection: it names what this conversation
 * may search, in the words the log recorded, and disappears entirely in a
 * build whose Host folds no knowledge scope.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { KnowledgeRef, KnowledgeScope } from '@deepseek-ai/dsh-knowledge'
import { KnowledgeChip, type KnowledgeChipProps } from '../src/client/KnowledgeChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const REF = 'weknora:prod:690c0727' as KnowledgeRef

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: KnowledgeChipProps['t'] = makeTranslate(zh, commonZh)

/** Render the chip over one projected scope. */
function setup(scope: KnowledgeScope | undefined) {
  const store = createSnapshotStore<{ value: KnowledgeScope | undefined }>({ value: scope })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const props = { useProjection, t } as unknown as KnowledgeChipProps
  return { store, view: render(<KnowledgeChip {...props} />) }
}

/** The two scopes that name nothing, and the line each one reads as. */
const NAMELESS: readonly (readonly [string, KnowledgeScope, string])[] = [
  ['off', { version: 1, mode: 'off' }, '知识库：关闭'],
  ['all', { version: 1, mode: 'all' }, '知识库：全部'],
]

describe('KnowledgeChip', () => {
  it('renders nothing where the Host folds no knowledge scope', () => {
    expect(setup(undefined).view.container.innerHTML).toBe('')
  })

  it.each(NAMELESS)('says the conversation is %s', (_label, scope, expected) => {
    setup(scope)
    expect(screen.getByTitle('本次对话可检索的知识库 — 用 /knowledge 更改').textContent).toBe(expected)
  })

  it('names the chosen knowledge bases, and follows the choice as it changes', () => {
    const { store } = setup({ version: 1, mode: 'selected', bases: [{ ref: REF, displayName: '临港知识库' }] })
    const chip = screen.getByTitle('本次对话可检索的知识库 — 用 /knowledge 更改')
    expect(chip.textContent).toBe('知识库：临港知识库')
    act(() => { store.set({ value: { version: 1, mode: 'off' } }) })
    expect(chip.textContent).toBe('知识库：关闭')
  })
})
