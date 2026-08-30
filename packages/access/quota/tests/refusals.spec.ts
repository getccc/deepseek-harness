/**
 * The two failures the seam declares, and the word lists a store builds its
 * column constraints from.
 *
 * A consumer matches on `reason`, and a store renders these arrays into SQL,
 * so both are behaviour rather than documentation.
 */

import { describe, expect, it } from 'vitest'
import {
  RESERVATION_REFUSALS,
  ReservationRefusedError,
  ReservationId,
  SETTLEMENT_KINDS,
  UnknownReservationError,
} from '../src/index.ts'

describe('the failures a caller matches on', () => {
  it('carries the refusal word, not only a message', () => {
    for (const reason of RESERVATION_REFUSALS) {
      const failure = new ReservationRefusedError(reason)
      expect(failure.reason).toBe(reason)
      expect(failure.name).toBe('ReservationRefusedError')
      expect(failure.message).toContain(reason)
      expect(failure).toBeInstanceOf(Error)
    }
  })

  it('names the reservation a settlement could not find', () => {
    const failure = new UnknownReservationError(ReservationId('r-1'))
    expect(failure.reservationId).toBe('r-1')
    expect(failure.name).toBe('UnknownReservationError')
    expect(failure.message).toContain('r-1')
  })
})

describe('the word lists a store renders into SQL', () => {
  it('lists each word once, so a rendered constraint has no repeats', () => {
    for (const list of [RESERVATION_REFUSALS, SETTLEMENT_KINDS]) {
      expect(new Set(list).size).toBe(list.length)
    }
  })

  it('keeps the three settlement kinds apart', () => {
    // Collapsing `released` into an estimate of zero would lose the
    // distinction an invoice reconciliation needs.
    expect([...SETTLEMENT_KINDS].sort()).toEqual(['estimated', 'released', 'reported'])
  })
})
