// @vitest-environment jsdom
/**
 * The composer control over the `office` projection: it names the chosen
 * office kind, offers the four kinds single-select, records a click, clears
 * the choice when the chosen kind is clicked again, and disappears entirely
 * in a build whose Host folds no office choice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { OfficeChoice } from '@deepseek-ai/dsh-office'
import { OfficeSelect, type OfficeSelectProps } from '../src/client/OfficeSelect.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: OfficeSelectProps['t'] = makeTranslate(zh, commonZh)

/** Render the control over one projected choice. */
function setup(choice: OfficeChoice | undefined, apply = vi.fn().mockResolvedValue(undefined)) {
  const store = createSnapshotStore<{ value: OfficeChoice | undefined }>({ value: choice })
  const useProjection = (_key: string, selector?: (v: unknown) => unknown) =>
    bindSnapshotSelector(store)(s => (selector ?? (v => v))(s.value))
  const props = { useProjection, apply, t } as unknown as OfficeSelectProps
  return { store, apply, view: render(<OfficeSelect {...props} />) }
}

/** The control's own button. */
const trigger = (): HTMLElement => screen.getByTitle('本次对话要生成的办公文档')

describe('OfficeSelect', () => {
  it('renders nothing where the Host folds no office choice', () => {
    expect(setup(undefined).view.container.innerHTML).toBe('')
  })

  it('says the bare noun while nothing is chosen, and stays untinted', () => {
    setup({ version: 1, kind: 'none' })
    expect(trigger().textContent).toBe('办公')
    expect(trigger().className).not.toContain('triggerChosen')
  })

  it('names the chosen kind and marks itself chosen, following it as it changes', () => {
    const { store } = setup({ version: 1, kind: 'ppt' })
    expect(trigger().textContent).toBe('PPT')
    expect(trigger().className).toContain('triggerChosen')
    act(() => { store.set({ value: { version: 1, kind: 'amec-ppt' } }) })
    expect(trigger().textContent).toBe('AMEC PPT 模版')
    act(() => { store.set({ value: { version: 1, kind: 'none' } }) })
    expect(trigger().className).not.toContain('triggerChosen')
  })

  it('offers the four kinds and marks the chosen one', async () => {
    setup({ version: 1, kind: 'excel' })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByRole('menuitem', { name: 'Word' })).toBeTruthy() })
    for (const label of ['Word', 'PPT', 'AMEC PPT 模版', 'Excel']) {
      expect(screen.getByRole('menuitem', { name: label })).toBeTruthy()
    }
  })

  it('records a click as the whole choice it makes', async () => {
    const { apply } = setup({ version: 1, kind: 'none' })
    await act(async () => { fireEvent.click(trigger()) })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'AMEC PPT 模版' })) })
    expect(apply).toHaveBeenCalledWith('amec-ppt')
  })

  it('clears the choice when the chosen kind is clicked again', async () => {
    const { apply } = setup({ version: 1, kind: 'word' })
    await act(async () => { fireEvent.click(trigger()) })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'Word' })) })
    expect(apply).toHaveBeenCalledWith('none')
  })

  it('closes on an outside pointer without recording anything', async () => {
    const { apply } = setup({ version: 1, kind: 'none' })
    await act(async () => { fireEvent.click(trigger()) })
    await waitFor(() => { expect(screen.getByRole('menuitem', { name: 'Word' })).toBeTruthy() })
    await act(async () => { fireEvent.pointerDown(document.body) })
    await waitFor(() => { expect(screen.queryByRole('menuitem', { name: 'Word' })).toBeNull() })
    expect(apply).not.toHaveBeenCalled()
  })

  it('shows a footer when a change cannot be saved', async () => {
    const apply = vi.fn().mockRejectedValue(new Error('nope'))
    setup({ version: 1, kind: 'none' }, apply)
    await act(async () => { fireEvent.click(trigger()) })
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'PPT' })) })
    await waitFor(() => { expect(screen.getByText('未能保存这次更改')).toBeTruthy() })
  })
})
