// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import {
  ChangePasswordDialog, type ChangePasswordDialogProps, type ChangePasswordFailure, type ChangePasswordResult,
} from '../src/client/ChangePasswordDialog.tsx'
import { en, zh } from '../src/client/locales.ts'

usePinnedBrowserLanguages('zh-CN')
afterEach(cleanup)

/** Translate with the Chinese dictionary, filling `{name}` parameters. */
const t = ((key: keyof typeof zh, params?: Record<string, unknown>) =>
  zh[key].replace(/\{(\w+)\}/gu, (_, name: string) => String(params?.[name]))) as ChangePasswordDialogProps['t']

/** Render the open dialog over one change operation. */
function open(changePassword: ChangePasswordDialogProps['changePassword'], onClose = vi.fn()) {
  render(<ChangePasswordDialog open onClose={onClose} changePassword={changePassword} t={t} />)
  return onClose
}

/** Fill the three fields and submit. */
function submit(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: current } })
  fireEvent.change(screen.getByLabelText('新密码'), { target: { value: next } })
  fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: '确认修改' }))
}

describe('the password dialog', () => {
  it('renders nothing while closed', () => {
    render(<ChangePasswordDialog open={false} onClose={vi.fn()} changePassword={vi.fn()} t={t} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps every field a password field the browser treats as a new or current password', () => {
    open(vi.fn())
    expect(screen.getByLabelText('当前密码').getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByLabelText('新密码').getAttribute('autocomplete')).toBe('new-password')
    expect(screen.getByLabelText('确认新密码').getAttribute('type')).toBe('password')
  })

  /** The error text shown under one field, or undefined when it shows none. */
  function errorUnder(label: string): string | undefined {
    const describedBy = screen.getByLabelText(label).getAttribute('aria-describedby')
    return describedBy === null ? undefined : document.getElementById(describedBy)?.textContent ?? undefined
  }

  it('says under each empty field that it is missing, without calling the Host', () => {
    const change = vi.fn()
    open(change)
    submit('', '', '')
    expect(errorUnder('当前密码')).toBe(zh['password.error.currentEmpty'])
    expect(errorUnder('新密码')).toBe(zh['password.error.newEmpty'])
    expect(errorUnder('确认新密码')).toBe(zh['password.error.confirmEmpty'])
    expect(screen.getByLabelText('当前密码').getAttribute('aria-invalid')).toBe('true')
    submit('Old-pass-1', 'New-pass-1', '')
    expect(errorUnder('当前密码')).toBeUndefined()
    expect(errorUnder('确认新密码')).toBe(zh['password.error.confirmEmpty'])
    expect(change).not.toHaveBeenCalled()
  })

  it('puts a mismatch under the confirmation field', () => {
    const change = vi.fn()
    open(change)
    submit('Old-pass-1', 'New-pass-1', 'New-pass-2')
    expect(errorUnder('确认新密码')).toBe(zh['password.error.mismatch'])
    expect(errorUnder('新密码')).toBeUndefined()
    expect(change).not.toHaveBeenCalled()
  })

  it('clears the error under a field as soon as that field is edited', () => {
    open(vi.fn())
    submit('', 'New-pass-1', 'New-pass-1')
    expect(errorUnder('当前密码')).toBeDefined()
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'O' } })
    expect(errorUnder('当前密码')).toBeUndefined()
  })

  it('submits once while waiting, then shows the done message and forgets what was typed', async () => {
    let settle!: (result: ChangePasswordResult) => void
    const change = vi.fn(() => new Promise<ChangePasswordResult>((resolve) => { settle = resolve }))
    const onClose = open(change)
    submit('Old-pass-1', 'New-pass-1', 'New-pass-1')

    expect(change).toHaveBeenCalledWith('Old-pass-1', 'New-pass-1')
    const pending = screen.getByRole('button', { name: '正在修改…' })
    expect(pending).toHaveProperty('disabled', true)
    fireEvent.submit(pending.closest('form')!)
    expect(change).toHaveBeenCalledOnce()

    settle({ ok: true })
    expect((await screen.findByRole('status')).textContent).toBe(zh['password.done'])
    expect(screen.queryByLabelText('当前密码')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps what was typed after a refusal so the member can fix it', async () => {
    const change = vi.fn().mockResolvedValue({ ok: false, reason: 'current-incorrect' })
    open(change)
    submit('Wrong-pass-1', 'New-pass-1', 'New-pass-1')
    await waitFor(() => { expect(errorUnder('当前密码')).toBe(zh['password.error.incorrect']) })
    expect(screen.getByLabelText<HTMLInputElement>('新密码').value).toBe('New-pass-1')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '确认修改' }).disabled).toBe(false)
  })

  it('forgets what was typed when the dialog is closed', () => {
    const onClose = open(vi.fn())
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'Old-pass-1' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByLabelText<HTMLInputElement>('当前密码').value).toBe('')
  })

  it('puts each refusal under the field it is about, and states why in its own words', async () => {
    const cases: [ChangePasswordFailure, '当前密码' | '新密码' | 'form', string][] = [
      [{ reason: 'current-incorrect' }, '当前密码', zh['password.error.incorrect']],
      [{ reason: 'unchanged' }, '新密码', zh['password.error.same']],
      [{ reason: 'weak' }, '新密码', zh['password.error.weak']],
      [{ reason: 'weak', policy: { minLength: 10, requiredClasses: [] } }, '新密码',
        '新密码不符合密码规则：至少 10 个字符。'],
      [{ reason: 'weak', policy: { minLength: 8, requiredClasses: ['uppercase', 'digit'] } }, '新密码',
        '新密码不符合密码规则：至少 8 个字符，且必须包含大写字母、数字。'],
      [{ reason: 'expired' }, 'form', zh['password.error.expired']],
      [{ reason: 'unreachable' }, 'form', zh['password.error.unreachable']],
      [{ reason: 'update-required' }, 'form', zh['password.error.update']],
      [{ reason: 'unsupported' }, 'form', zh['password.error.unsupported']],
      [{ reason: 'failed' }, 'form', zh['password.error.failed']],
    ]
    const change = vi.fn()
    open(change)
    for (const [failure, where, line] of cases) {
      change.mockResolvedValueOnce({ ok: false, ...failure })
      submit('Old-pass-1', 'New-pass-1', 'New-pass-1')
      await waitFor(() => { expect(screen.getAllByRole('alert')).toHaveLength(1) })
      expect(screen.getByRole('alert').textContent).toBe(line)
      if (where === 'form') {
        // Not about one field: the line is a child of the form, not of a field.
        expect(screen.getByRole('alert').parentElement?.tagName).toBe('FORM')
        for (const label of ['当前密码', '新密码', '确认新密码']) expect(errorUnder(label)).toBeUndefined()
      } else {
        expect(errorUnder(where)).toBe(line)
      }
    }
  })
})

describe('the dictionaries', () => {
  it('give the English and Chinese password copy the same parameters', () => {
    const slots = (text: string) => [...text.matchAll(/\{(\w+)\}/gu)].map(match => match[1]).sort()
    for (const key of Object.keys(zh) as (keyof typeof zh)[]) {
      expect(slots(en[key]), key).toEqual(slots(zh[key]))
    }
  })
})
