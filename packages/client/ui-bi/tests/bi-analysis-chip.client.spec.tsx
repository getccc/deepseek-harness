// @vitest-environment jsdom
/**
 * The composer BI-analysis chip: it renders for a work Session only, names
 * itself in the member's language, and reports that the capability behind it
 * is not built.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { BiAnalysisChip, type BiAnalysisChipProps } from '../src/client/BiAnalysisChip.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: BiAnalysisChipProps['t'] = makeTranslate(zh, commonZh)

/** Render the chip for a Session of one kind. */
function chip(kind: 'work' | 'chat' = 'work') {
  const sessions = createSnapshotStore({ byId: { s1: { kind } } })
  const props = { sessionId: 's1', useSessions: bindSnapshotSelector(sessions), t }
  return render(<BiAnalysisChip {...props as unknown as BiAnalysisChipProps} />)
}

describe('BiAnalysisChip', () => {
  it('renders nothing in a chat conversation, which has no workspace to analyze', () => {
    expect(chip('chat').container.innerHTML).toBe('')
  })

  it('names itself and says the capability is not built', () => {
    chip()
    const trigger = screen.getByRole('button', { name: 'BI分析' })
    expect(trigger.textContent).toBe('BI分析')
    expect(trigger.getAttribute('title')).toBe('BI分析功能开发中')
    expect(trigger.getAttribute('aria-disabled')).toBe('true')
  })
})
