// @vitest-environment jsdom
/**
 * The two composer voice controls: they render for a chat Session only, name
 * themselves in the member's language, and report that the capability behind
 * them is not built.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { TranscribeChip, type TranscribeChipProps } from '../src/client/TranscribeChip.tsx'
import { VoiceInputButton, type VoiceInputButtonProps } from '../src/client/VoiceInputButton.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: TranscribeChipProps['t'] = makeTranslate(zh, commonZh)

/** The runtime share both controls read, for a Session of one kind. */
function share(kind: 'work' | 'chat') {
  const sessions = createSnapshotStore({ byId: { s1: { kind } } })
  return { sessionId: 's1', useSessions: bindSnapshotSelector(sessions), t }
}

/** Render the tool-row chip for a Session of one kind. */
function chip(kind: 'work' | 'chat' = 'chat') {
  return render(<TranscribeChip {...share(kind) as unknown as TranscribeChipProps} />)
}

/** Render the trailing microphone for a Session of one kind, locked or not. */
function button(kind: 'work' | 'chat' = 'chat', locked = false) {
  return render(<VoiceInputButton {...{ ...share(kind), locked } as unknown as VoiceInputButtonProps} />)
}

describe('TranscribeChip', () => {
  it('renders nothing outside a chat session', () => {
    expect(chip('work').container.innerHTML).toBe('')
  })

  it('names itself and says the capability is not built', () => {
    chip()
    const trigger = screen.getByRole('button', { name: '录音转写' })
    expect(trigger.textContent).toBe('录音转写')
    expect(trigger.getAttribute('title')).toBe('录音转写功能开发中')
    expect(trigger.getAttribute('aria-disabled')).toBe('true')
  })
})

describe('VoiceInputButton', () => {
  it('renders nothing outside a chat session', () => {
    expect(button('work').container.innerHTML).toBe('')
  })

  it('names itself and says the capability is not built', () => {
    button()
    const trigger = screen.getByRole<HTMLButtonElement>('button', { name: '语音输入' })
    expect(trigger.getAttribute('title')).toBe('语音输入功能开发中')
    expect(trigger.getAttribute('aria-disabled')).toBe('true')
    expect(trigger.disabled).toBe(false)
  })

  it('follows the composer into its locked state, like the controls beside it', () => {
    button('chat', true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '语音输入' }).disabled).toBe(true)
  })
})
