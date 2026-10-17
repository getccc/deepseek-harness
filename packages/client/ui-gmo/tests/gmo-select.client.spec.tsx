// @vitest-environment jsdom
/**
 * The composer control over the `gmo` projection: it names the chosen category
 * with the name the Session recorded, offers the authorized categories
 * single-select when opened, records a click and closes, clears the choice
 * when the chosen category is clicked again, says so when the directory is
 * empty, stale, or unreadable, and disappears entirely in a build whose Host
 * folds no GMO scope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { GmoCategoryRef, GmoScope } from '@deepseek-ai/dsh-gmo'
import { GmoSelect, type GmoDirectoryView, type GmoSelectProps } from '../src/client/GmoSelect.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const DEMO = 'exceltools:gmo:gb' as GmoCategoryRef
const SALES = 'exceltools:gmo:mfc' as GmoCategoryRef
const DIRECTORY: GmoDirectoryView = {
  choices: [{ categoryRef: DEMO, displayName: 'GB / GL 分配' }, { categoryRef: SALES, displayName: 'MFC 分配' }],
  unavailable: false,
}

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: GmoSelectProps['t'] = makeTranslate(zh, commonZh)

/** Render the control over one projected scope, for a session of one kind (work unless said). */
function setup(
  scope: GmoScope | undefined,
  apply = vi.fn().mockResolvedValue(undefined),
  kind: 'work' | 'chat' = 'work',
  directory: GmoDirectoryView = DIRECTORY,
) {
  const store = createSnapshotStore<{ value: GmoScope | undefined }>({ value: scope })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const sessions = createSnapshotStore({ byId: { s1: { kind } } })
  const choices = vi.fn().mockResolvedValue(directory)
  const props = {
    sessionId: 's1', useSessions: bindSnapshotSelector(sessions), useProjection, choices, apply, t,
  } as GmoSelectProps
  return { store, choices, apply, view: render(<GmoSelect {...props} />) }
}

/** The control's own button. */
const trigger = (): HTMLElement => screen.getByTitle('本次对话查询的 GMO供应链分类')

/** Open the menu and wait for the directory rows. */
async function openMenu(): Promise<void> {
  await act(async () => { fireEvent.click(trigger()) })
  await waitFor(() => { expect(screen.getByRole('menuitem', { name: 'GB / GL 分配' })).toBeTruthy() })
}

const SELECTED: GmoScope = { version: 1, mode: 'selected', category: { ref: DEMO, displayName: 'GB / GL 分配' } }

describe('GmoSelect', () => {
  it('renders nothing where the Host folds no GMO scope', () => {
    expect(setup(undefined).view.container.innerHTML).toBe('')
  })

  it('renders nothing for a chat session, whatever the Host folds', () => {
    // The kind is the session row's word: a chat session runs no GMO tool, so
    // a scope the Host still categories has nothing to govern.
    expect(setup(SELECTED, undefined, 'chat').view.container.innerHTML).toBe('')
  })

  it('says the bare noun while nothing is chosen, and stays untinted', () => {
    setup({ version: 1, mode: 'off' })
    expect(trigger().textContent).toBe('GMO供应链')
    expect(trigger().className).not.toContain('triggerChosen')
    expect(trigger().getAttribute('aria-label')).toBe('GMO供应链：未选择')
  })

  it('names the recorded category and marks itself chosen, following the projection as it changes', () => {
    const { store } = setup(SELECTED)
    expect(trigger().textContent).toBe('GB / GL 分配')
    expect(trigger().className).toContain('triggerChosen')
    expect(trigger().getAttribute('aria-label')).toBe('GMO供应链：GB / GL 分配')
    // The name shown is the one the log recorded, whatever the directory calls it now.
    act(() => { store.set({ value: { ...SELECTED, category: { ref: DEMO, displayName: '供应链 GB' } } }) })
    expect(trigger().textContent).toBe('供应链 GB')
    act(() => { store.set({ value: { version: 1, mode: 'off' } }) })
    expect(trigger().className).not.toContain('triggerChosen')
  })

  it('offers the authorized directory single-select when opened, marking the chosen category', async () => {
    const { choices } = setup(SELECTED)
    expect(choices).not.toHaveBeenCalled()
    await openMenu()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['GB / GL 分配', 'MFC 分配'])
    expect(choices).toHaveBeenCalledTimes(1)
  })

  it('records a click as the whole choice it makes, and closes', async () => {
    const { apply } = setup({ version: 1, mode: 'off' })
    await openMenu()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'MFC 分配' })) })
    expect(apply).toHaveBeenCalledWith(SALES)
    await waitFor(() => { expect(screen.queryByRole('menuitem')).toBeNull() })
  })

  it('clears the choice when the chosen category is clicked again', async () => {
    const { apply } = setup(SELECTED)
    await openMenu()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'GB / GL 分配' })) })
    expect(apply).toHaveBeenCalledWith(undefined)
  })

  it('says so when a change could not be saved, and stays open', async () => {
    const apply = vi.fn().mockRejectedValue(new Error('host rejected'))
    setup({ version: 1, mode: 'off' }, apply)
    await openMenu()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'GB / GL 分配' })) })
    await waitFor(() => { expect(screen.getByText('未能保存这次更改')).toBeTruthy() })
    expect(screen.getByRole('menuitem', { name: 'GB / GL 分配' })).toBeTruthy()
  })

  it('says so when the directory itself could not be read', async () => {
    const { choices } = setup({ version: 1, mode: 'off' })
    choices.mockRejectedValueOnce(new Error('unreachable'))
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('未能保存这次更改')).toBeTruthy() })
  })

  it('says so when the member may analyze no category', async () => {
    setup({ version: 1, mode: 'off' }, undefined, 'work', { choices: [], unavailable: false })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('没有可查询的 GMO供应链分类')).toBeTruthy() })
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('says so when the recorded category is no longer one the member may analyze', async () => {
    setup(SELECTED, undefined, 'work', { choices: [{ categoryRef: SALES, displayName: 'MFC 分配' }], unavailable: true })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('当前分类已不可用，请重新选择')).toBeTruthy() })
    // The chip still names what the log recorded until the member changes it.
    expect(trigger().textContent).toBe('GB / GL 分配')
  })

  it('closes on a second click of its own control, and on an outside dismissal, without recording anything', async () => {
    const { apply, choices } = setup({ version: 1, mode: 'off' })
    await openMenu()
    // The directory is read on open, not on close.
    await act(async () => { fireEvent.click(trigger()) })
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(choices).toHaveBeenCalledTimes(1)

    await openMenu()
    await act(async () => { fireEvent.pointerDown(document.body) })
    await waitFor(() => { expect(screen.queryByRole('menuitem')).toBeNull() })
    expect(apply).not.toHaveBeenCalled()
  })
})
