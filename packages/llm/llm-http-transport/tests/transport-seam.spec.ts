/**
 * The failure a caller matches on, and the closed operation list.
 *
 * Both are the seam's whole surface beyond types: a caller decides whether to
 * retry from the reason, and a Control Plane refuses an operation by not
 * finding it here.
 */

import { describe, expect, it } from 'vitest'
import { TRANSPORT_OPERATIONS, TransportFailedError } from '../src/index.ts'

describe('the failure a caller matches on', () => {
  it('carries the reason, so retrying is a decision rather than a guess', () => {
    for (const reason of ['refused', 'unreachable', 'not-bound'] as const) {
      const failure = new TransportFailedError(reason)
      expect(failure.reason).toBe(reason)
      expect(failure.name).toBe('TransportFailedError')
      expect(failure).toBeInstanceOf(Error)
    }
  })

  it('includes a detail when there is one, and reads cleanly when there is not', () => {
    expect(new TransportFailedError('unreachable', 'connect ECONNREFUSED').message)
      .toBe('transport failed: unreachable (connect ECONNREFUSED)')
    expect(new TransportFailedError('not-bound').message).toBe('transport failed: not-bound')
  })
})

describe('the operation list', () => {
  it('is closed, and lists each operation once', () => {
    // A transport that took an arbitrary path would be one a caller could
    // point anywhere, which is what the seam exists to prevent.
    expect(new Set(TRANSPORT_OPERATIONS).size).toBe(TRANSPORT_OPERATIONS.length)
    expect(TRANSPORT_OPERATIONS).toContain('chat.completions')
  })
})
