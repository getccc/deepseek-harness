// @vitest-environment jsdom
/**
 * The composer control over the `bi` projection: it names the chosen project
 * with the name the Session recorded, offers the authorized projects
 * single-select when opened, records a click and closes, clears the choice
 * when the chosen project is clicked again, says so when the directory is
 * empty, stale, or unreadable, and disappears entirely in a build whose Host
 * folds no BI scope.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { BiProjectRef, BiScope } from '@deepseek-ai/dsh-bi'
import { BiSelect, type BiDirectoryView, type BiSelectProps } from '../src/client/BiSelect.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const DEMO = 'webi:prod:690c0727' as BiProjectRef
const SALES = 'webi:prod:08f25606' as BiProjectRef
const DIRECTORY: BiDirectoryView = {
  choices: [{ projectRef: DEMO, displayName: 'Demo YH' }, { projectRef: SALES, displayName: '销售分析' }],
  unavailable: false,
}

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: BiSelectProps['t'] = makeTranslate(zh, commonZh)

/** Render the control over one projected scope, for a session of one kind (work unless said). */
function setup(
  scope: BiScope | undefined,
  apply = vi.fn().mockResolvedValue(undefined),
  kind: 'work' | 'chat' = 'work',
  directory: BiDirectoryView = DIRECTORY,
) {
  const store = createSnapshotStore<{ value: BiScope | undefined }>({ value: scope })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const sessions = createSnapshotStore({ byId: { s1: { kind } } })
  const choices = vi.fn().mockResolvedValue(directory)
  const props = {
    sessionId: 's1', useSessions: bindSnapshotSelector(sessions), useProjection, choices, apply, t,
  } as unknown as BiSelectProps
  return { store, choices, apply, view: render(<BiSelect {...props} />) }
}

/** The control's own button. */
const trigger = (): HTMLElement => screen.getByTitle('本次对话分析的 BI 项目')

/** Open the menu and wait for the directory rows. */
async function openMenu(): Promise<void> {
  await act(async () => { fireEvent.click(trigger()) })
  await waitFor(() => { expect(screen.getByRole('menuitem', { name: 'Demo YH' })).toBeTruthy() })
}

const SELECTED: BiScope = { version: 1, mode: 'selected', project: { ref: DEMO, displayName: 'Demo YH' } }

describe('BiSelect', () => {
  it('renders nothing where the Host folds no BI scope', () => {
    expect(setup(undefined).view.container.innerHTML).toBe('')
  })

  it('renders nothing for a chat session, whatever the Host folds', () => {
    // The kind is the session row's word: a chat session runs no BI tool, so
    // a scope the Host still projects has nothing to govern.
    expect(setup(SELECTED, undefined, 'chat').view.container.innerHTML).toBe('')
  })

  it('says the bare noun while nothing is chosen, and stays untinted', () => {
    setup({ version: 1, mode: 'off' })
    expect(trigger().textContent).toBe('BI分析')
    expect(trigger().className).not.toContain('triggerChosen')
    expect(trigger().getAttribute('aria-label')).toBe('BI 分析：未选择')
  })

  it('names the recorded project and marks itself chosen, following the projection as it changes', () => {
    const { store } = setup(SELECTED)
    expect(trigger().textContent).toBe('Demo YH')
    expect(trigger().className).toContain('triggerChosen')
    expect(trigger().getAttribute('aria-label')).toBe('BI 分析：Demo YH')
    // The name shown is the one the log recorded, whatever the directory calls it now.
    act(() => { store.set({ value: { ...SELECTED, project: { ref: DEMO, displayName: '演示项目' } } }) })
    expect(trigger().textContent).toBe('演示项目')
    act(() => { store.set({ value: { version: 1, mode: 'off' } }) })
    expect(trigger().className).not.toContain('triggerChosen')
  })

  it('offers the authorized directory single-select when opened, marking the chosen project', async () => {
    const { choices } = setup(SELECTED)
    expect(choices).not.toHaveBeenCalled()
    await openMenu()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Demo YH', '销售分析'])
    expect(choices).toHaveBeenCalledTimes(1)
  })

  it('records a click as the whole choice it makes, and closes', async () => {
    const { apply } = setup({ version: 1, mode: 'off' })
    await openMenu()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: '销售分析' })) })
    expect(apply).toHaveBeenCalledWith(SALES)
    await waitFor(() => { expect(screen.queryByRole('menuitem')).toBeNull() })
  })

  it('clears the choice when the chosen project is clicked again', async () => {
    const { apply } = setup(SELECTED)
    await openMenu()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Demo YH' })) })
    expect(apply).toHaveBeenCalledWith(undefined)
  })

  it('says so when a change could not be saved, and stays open', async () => {
    const apply = vi.fn().mockRejectedValue(new Error('host rejected'))
    setup({ version: 1, mode: 'off' }, apply)
    await openMenu()
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Demo YH' })) })
    await waitFor(() => { expect(screen.getByText('未能保存这次更改')).toBeTruthy() })
    expect(screen.getByRole('menuitem', { name: 'Demo YH' })).toBeTruthy()
  })

  it('says so when the directory itself could not be read', async () => {
    const { choices } = setup({ version: 1, mode: 'off' })
    choices.mockRejectedValueOnce(new Error('unreachable'))
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('未能保存这次更改')).toBeTruthy() })
  })

  it('says so when the member may analyze no project', async () => {
    setup({ version: 1, mode: 'off' }, undefined, 'work', { choices: [], unavailable: false })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('没有可分析的 BI 项目')).toBeTruthy() })
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('says so when the recorded project is no longer one the member may analyze', async () => {
    setup(SELECTED, undefined, 'work', { choices: [{ projectRef: SALES, displayName: '销售分析' }], unavailable: true })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByText('当前项目已不可用，请重新选择')).toBeTruthy() })
    // The chip still names what the log recorded until the member changes it.
    expect(trigger().textContent).toBe('Demo YH')
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
