/**
 * What a Session's office-deliverable choice is, and what other faces may read
 * of it.
 *
 * The kind is declared here rather than beside the Host registration because
 * the browser reads it too: a composer control and a Host fold have to agree
 * on the same projection key and the same value, and only one of them can
 * import the Host module that registers it.
 * @module @deepseek-ai/dsh-office/types
 */

/**
 * The office document kind a conversation should produce.
 *
 * `none` is where every Session starts: no format is imposed and the office
 * prompt section is absent. `amec-ppt` is a PowerPoint built from the
 * deployment's own AMEC template rather than from a blank deck.
 */
export type OfficeKind = 'none' | 'word' | 'ppt' | 'amec-ppt' | 'excel'

/** Every kind a picker offers, in display order; excludes the `none` clear-state. */
export const OFFICE_KINDS = ['word', 'ppt', 'amec-ppt', 'excel'] as const satisfies readonly Exclude<OfficeKind, 'none'>[]

/**
 * Whether a value is one of the offerable office kinds (the `none` clear-state excluded).
 * @param value - the candidate to test.
 * @returns whether `value` is an offerable {@link OfficeKind}.
 */
export function isOfficeKind(value: unknown): value is Exclude<OfficeKind, 'none'> {
  return typeof value === 'string' && (OFFICE_KINDS as readonly string[]).includes(value)
}

/** The Session's office choice, recorded whole so a fold recovers exactly it. */
export interface OfficeChoice {
  /** Format version of this record; a build that does not know it refuses the log. */
  readonly version: 1
  /** The chosen kind, or `none` when the Session imposes no format. */
  readonly kind: OfficeKind
}
