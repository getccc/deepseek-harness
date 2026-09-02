// @vitest-environment jsdom
/**
 * The composer control over the `knowledge` projection: it names what this
 * conversation may search, opens the same choice the `/knowledge` picker
 * offers, applies each click at once, and disappears entirely in a build whose
 * Host folds no knowledge scope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { KnowledgeRef, KnowledgeScope } from '@deepseek-ai/dsh-knowledge'
import { KnowledgeSelect, type KnowledgeSelectProps } from '../src/client/KnowledgeSelect.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const REF_A = 'weknora:prod:690c0727' as KnowledgeRef
const REF_B = 'weknora:prod:08f25606' as KnowledgeRef

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: KnowledgeSelectProps['t'] = makeTranslate(zh, commonZh)

/** Render the control over one projected scope. */
function setup(scope: KnowledgeScope | undefined, apply = vi.fn().mockResolvedValue(undefined)) {
  const store = createSnapshotStore<{ value: KnowledgeScope | undefined }>({ value: scope })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const choices = vi.fn().mockResolvedValue([
    { knowledgeRef: REF_A, displayName: '临港知识库', description: '' },
    { knowledgeRef: REF_B, displayName: '南昌知识库', description: '' },
  ])
  const props = { useProjection, choices, apply, t } as unknown as KnowledgeSelectProps
  return { store, choices, apply, view: render(<KnowledgeSelect {...props} />) }
}

/** The control's own button. */
const trigger = (): HTMLElement => screen.getByTitle('本次对话可检索的知识库')

describe('KnowledgeSelect', () => {
  it('renders nothing where the Host folds no knowledge scope', () => {
    expect(setup(undefined).view.container.innerHTML).toBe('')
  })

  it('says the bare noun while nothing is chosen, and stays untinted', () => {
    // "Off" is where every conversation starts and stays unless asked, so the
    // control spends no width saying it.
    setup({ version: 1, mode: 'off' })
    expect(trigger().textContent).toBe('知识库')
    expect(trigger().className).not.toContain('triggerChosen')
  })

  it('names the choice and marks itself chosen, following it as it changes', () => {
    const { store } = setup({ version: 1, mode: 'selected', bases: [{ ref: REF_A, displayName: '临港知识库' }] })
    expect(trigger().textContent).toBe('临港知识库')
    expect(trigger().className).toContain('triggerChosen')
    act(() => { store.set({ value: { version: 1, mode: 'all' } }) })
    expect(trigger().textContent).toBe('全部已授权知识库')
    act(() => { store.set({ value: { version: 1, mode: 'off' } }) })
    expect(trigger().className).not.toContain('triggerChosen')
  })

  it('offers the whole-set row and the authorized directory, marking what is chosen', async () => {
    setup({ version: 1, mode: 'selected', bases: [{ ref: REF_B, displayName: '南昌知识库' }] })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByRole('menuitemcheckbox', { name: '临港知识库' })).toBeTruthy() })
    expect(screen.getByRole('menuitemcheckbox', { name: '南昌知识库' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemcheckbox', { name: '临港知识库' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('menuitemcheckbox', { name: '全部已授权知识库' })).toBeTruthy()
  })

  it('applies a clicked row at once and stays open for the next one', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    setup({ version: 1, mode: 'off' }, apply)
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('临港知识库')).toBeTruthy() })
    await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '临港知识库' })) })
    expect(apply).toHaveBeenCalledWith(REF_A)
    // A member choosing two knowledge bases should not reopen the menu between them.
    await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '南昌知识库' })) })
    expect(apply).toHaveBeenLastCalledWith(REF_B)
  })

  it('says so when a change could not be saved', async () => {
    const apply = vi.fn().mockRejectedValue(new Error('host rejected'))
    setup({ version: 1, mode: 'off' }, apply)
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('临港知识库')).toBeTruthy() })
    await act(async () => { fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '临港知识库' })) })
    await waitFor(() => { expect(screen.getByText('未能保存这次更改')).toBeTruthy() })
  })

  it('says so when the directory itself could not be read', async () => {
    const { choices } = setup({ version: 1, mode: 'off' })
    choices.mockRejectedValueOnce(new Error('unreachable'))
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('未能保存这次更改')).toBeTruthy() })
  })

  it('closes on a second click of its own control, and on an outside dismissal', async () => {
    const { choices } = setup({ version: 1, mode: 'off' })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByRole('menuitemcheckbox', { name: '临港知识库' })).toBeTruthy() })
    // The directory is read on open, not on close.
    await act(async () => { fireEvent.click(trigger()) })
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
    expect(choices).toHaveBeenCalledTimes(1)

    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByRole('menuitemcheckbox', { name: '临港知识库' })).toBeTruthy() })
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull()
  })
})
