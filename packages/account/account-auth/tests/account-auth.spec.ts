/**
 * The seam's own vocabulary: the failure it refuses to explain, and the one
 * error it does explain.
 */

import { describe, expect, it } from 'vitest'
import { WeakSecretError, type AuthenticationOutcome } from '../src/index.ts'

describe('the sign-in outcome', () => {
  it('gives a failure no field to branch on', () => {
    const failure: AuthenticationOutcome = { ok: false }
    // An unknown login name, a wrong secret, a locked account, and a suspended
    // account are one value here, so no caller can build a probe out of them.
    expect(Object.keys(failure)).toEqual(['ok'])
  })
})

describe('WeakSecretError', () => {
  it('names what was wanted, so a form can say it', () => {
    const error = new WeakSecretError('at least 12 characters')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('WeakSecretError')
    expect(error.requirement).toBe('at least 12 characters')
    expect(error.message).toBe('the proposed secret does not satisfy the policy: at least 12 characters')
  })
})
