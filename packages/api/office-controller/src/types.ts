/**
 * The Remote boundary types the `office` namespace answers with.
 *
 * The wire shape is declared self-contained here — the kind union and the
 * choice envelope both — rather than imported from `@deepseek-ai/dsh-office`,
 * so the generated Remote face names only types this package declares. It
 * mirrors the vocabulary's `OfficeKind`/`OfficeChoice`; `parseOfficeChoice`
 * from the vocabulary is what keeps a recorded choice in step with it.
 * @module @deepseek-ai/dsh-api-office-controller/types
 */

/** The office document kind a conversation should produce, as the wire carries it. */
export type OfficeKind = 'none' | 'word' | 'ppt' | 'amec-ppt' | 'excel'

/** The Session's office choice on the wire. */
export interface OfficeChoiceWire {
  /** Format version of this record. */
  readonly version: 1
  /** The chosen kind, or `none` when the Session imposes no format. */
  readonly kind: OfficeKind
}

/** What the picker reads when it opens: the Session's current office choice. */
export interface OfficeChoiceView {
  /** The Session's choice, folded from its log. */
  readonly choice: OfficeChoiceWire
}
