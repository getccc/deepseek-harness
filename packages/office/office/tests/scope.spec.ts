/**
 * The office choice vocabulary: the fold that recovers a Session's choice from
 * its log, and the validator that reads one back off a wire.
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  DEFAULT_OFFICE_CHOICE, foldOfficeChoice, isOfficeKind, OFFICE_KINDS, parseOfficeChoice,
} from '@deepseek-ai/dsh-office'

/** One recorded office choice event. */
function chose(kind: string): SessionEvent {
  return { type: 'office/kind', data: { version: 1, kind } } as unknown as SessionEvent
}

describe('foldOfficeChoice', () => {
  it('is none when the log records nothing', () => {
    expect(foldOfficeChoice([])).toEqual(DEFAULT_OFFICE_CHOICE)
    expect(foldOfficeChoice([{ type: 'other' } as unknown as SessionEvent])).toEqual(DEFAULT_OFFICE_CHOICE)
  })

  it('takes the last recorded choice', () => {
    expect(foldOfficeChoice([chose('word'), chose('welinkin-ppt')])).toEqual({ version: 1, kind: 'welinkin-ppt' })
  })

  it('folds only the first end events, for a rewind read', () => {
    expect(foldOfficeChoice([chose('word'), chose('excel')], 1)).toEqual({ version: 1, kind: 'word' })
  })
})

describe('parseOfficeChoice', () => {
  it('accepts every offered kind and the none clear-state', () => {
    for (const kind of [...OFFICE_KINDS, 'none']) {
      expect(parseOfficeChoice({ version: 1, kind })).toEqual({ version: 1, kind })
    }
  })

  it('rejects a wrong version, an unknown kind, and a non-object', () => {
    expect(parseOfficeChoice({ version: 2, kind: 'word' })).toBeUndefined()
    expect(parseOfficeChoice({ version: 1, kind: 'pdf' })).toBeUndefined()
    expect(parseOfficeChoice(null)).toBeUndefined()
    expect(parseOfficeChoice('word')).toBeUndefined()
  })
})

describe('isOfficeKind', () => {
  it('knows the offered kinds from everything else', () => {
    expect(isOfficeKind('ppt')).toBe(true)
    expect(isOfficeKind('none')).toBe(false)
    expect(isOfficeKind('pdf')).toBe(false)
    expect(isOfficeKind(7)).toBe(false)
  })
})
