import { describe, expect, it } from 'vitest'
import { dayPartAt } from '../src/client/day-parts.ts'

/** One local wall-clock reading on an ordinary day. */
function at(hours: number, minutes: number, seconds = 0, ms = 0): Date {
  return new Date(2026, 8, 2, hours, minutes, seconds, ms)
}

describe('the parts of a member day', () => {
  it('gives every minute of the day to exactly one part', () => {
    const parts = ([
      [0, 0], [5, 59], [6, 0], [8, 29], [8, 30], [8, 59], [9, 0], [11, 29],
      [11, 30], [12, 59], [13, 0], [17, 29], [17, 30], [23, 59],
    ] as const).map(([hours, minutes]) => dayPartAt(at(hours, minutes)).part)

    expect(parts).toEqual([
      'lateNight', 'lateNight',
      'earlyMorning', 'earlyMorning',
      'morningSong', 'morningSong',
      'morning', 'morning',
      'noon', 'noon',
      'afternoon', 'afternoon',
      'evening', 'evening',
    ])
  })

  it('reports the wait to the next part, and to midnight from the last one', () => {
    expect(dayPartAt(at(8, 29, 59, 500)).endsIn).toBe(500)
    expect(dayPartAt(at(9, 0)).endsIn).toBe(150 * 60_000)
    expect(dayPartAt(at(23, 59, 59)).endsIn).toBe(1_000)
  })
})
