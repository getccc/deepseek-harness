/** Which part of the member's day the blank-session greeting speaks from. */

/**
 * One stretch of the local day carrying its own greeting and tagline.
 *
 * `morningSong` is the half hour the office gathers to sing before work
 * begins: it interrupts the morning rather than extending it, which is why
 * the two morning stretches are separate parts.
 */
export type DayPart =
  | 'lateNight'
  | 'earlyMorning'
  | 'morningSong'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'

/** The part in force at one moment, and how long it still holds. */
export interface DayPartWindow {
  /** The stretch that owns the moment. */
  part: DayPart
  /** Milliseconds until the next stretch begins. */
  endsIn: number
}

const MINUTES_PER_DAY = 24 * 60

/**
 * Each part with the local minute it ends at, ascending; a part starts where
 * the one above it ends. `evening` is absent because it is the part that runs
 * from the last end here to midnight.
 */
const PARTS: readonly (readonly [end: number, part: DayPart])[] = [
  [6 * 60, 'lateNight'],
  [8 * 60 + 30, 'earlyMorning'],
  [9 * 60, 'morningSong'],
  [11 * 60 + 30, 'morning'],
  [13 * 60, 'noon'],
  [17 * 60 + 30, 'afternoon'],
]

/**
 * Place one wall-clock moment among the parts of the day.
 *
 * The clock is the member's own: the greeting follows the day they are
 * working through, not the Runner's zone or the Control Plane's.
 * @param now - the local moment to place.
 * @returns the part that owns `now`, and the delay until the next part.
 */
export function dayPartAt(now: Date): DayPartWindow {
  const elapsed = ((now.getHours() * 60 + now.getMinutes()) * 60 + now.getSeconds()) * 1000
    + now.getMilliseconds()
  for (const [end, part] of PARTS) {
    if (elapsed < end * 60_000) return { part, endsIn: end * 60_000 - elapsed }
  }
  return { part: 'evening', endsIn: MINUTES_PER_DAY * 60_000 - elapsed }
}
