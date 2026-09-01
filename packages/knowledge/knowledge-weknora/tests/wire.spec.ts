/**
 * The two envelope readers, which decide whether a decoded body is an answer
 * this build may act on. They answer `undefined` rather than throwing so the
 * caller can say what the failure means in its own vocabulary.
 */

import { describe, expect, it } from 'vitest'
import { errorCode, successData } from '@deepseek-ai/dsh-knowledge-weknora/src/wire.ts'

describe('reading a success envelope', () => {
  it('returns the data array of a successful answer', () => {
    expect(successData({ data: [1, 2], success: true })).toEqual([1, 2])
  })

  it.each([
    ['a non-object', 'ok'],
    ['null', null],
    ['an unsuccessful envelope', { data: [], success: false }],
    ['an envelope with no success flag', { data: [] }],
    ['a successful envelope whose data is not an array', { data: {}, success: true }],
  ])('answers undefined for %s', (_label, body) => {
    expect(successData(body)).toBeUndefined()
  })
})

describe('reading a failure envelope', () => {
  it('returns the nested code, which is where this deployment puts it', () => {
    expect(errorCode({ error: { code: 1003, details: null, message: 'x' }, success: false })).toBe(1003)
  })

  it.each([
    ['a non-object', 'boom'],
    ['null', null],
    ['a body with no error', { success: false }],
    ['an error that is not an object', { error: 'not found' }],
    ['an error that is null', { error: null }],
    ['an error whose code is not a number', { error: { code: 'NOT_FOUND' } }],
  ])('answers undefined for %s', (_label, body) => {
    expect(errorCode(body)).toBeUndefined()
  })
})
