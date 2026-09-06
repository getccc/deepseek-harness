/** Which part of the member's day, and which half hour of it, the blank-session headline speaks from. */

/**
 * One stretch of the local day carrying its own greeting.
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

type Digit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'

/** A local hour of the day, two digits, `00` through `23`. */
type Hour = `0${Digit}` | `1${Digit}` | `2${'0' | '1' | '2' | '3'}`

/**
 * One half hour of the local day, named by the wall-clock minute it starts
 * at as `HHMM`; each carries its own tagline under the greeting.
 */
export type HalfHour = `${Hour}${'00' | '30'}`

/** The part and the half hour in force at one moment, and how long the half hour still holds. */
export interface HalfHourWindow {
  /** The stretch whose greeting addresses the moment. */
  part: DayPart
  /** The half hour whose tagline the moment shows. */
  halfHour: HalfHour
  /**
   * Milliseconds until the next half hour begins. Every part boundary falls
   * on a half hour, so the greeting can only change at that moment too.
   */
  endsIn: number
}

const HALF_HOUR_MINUTES = 30

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

/** The part that owns local `minute`, `evening` once the last listed end has passed. */
function partAt(minute: number): DayPart {
  for (const [end, part] of PARTS) if (minute < end) return part
  return 'evening'
}

/**
 * Place one wall-clock moment in the member's day.
 *
 * The clock is the member's own: the headline follows the day they are
 * working through, not the Runner's zone or the Control Plane's.
 * @param now - the local moment to place.
 * @returns the part and half hour that own `now`, and the delay until the next half hour.
 */
export function halfHourAt(now: Date): HalfHourWindow {
  const minute = now.getHours() * 60 + now.getMinutes()
  const elapsed = (minute * 60 + now.getSeconds()) * 1000 + now.getMilliseconds()
  const start = minute - (minute % HALF_HOUR_MINUTES)
  // `start` is below 24:00, so its two padded digits are one of the hours the type spells out.
  const hour = String(Math.floor(start / 60)).padStart(2, '0') as Hour
  return {
    part: partAt(minute),
    halfHour: `${hour}${start % 60 === 0 ? '00' : '30'}`,
    endsIn: (start + HALF_HOUR_MINUTES) * 60_000 - elapsed,
  }
}
