/**
 * The Remote boundary types the `gmo` namespace answers with.
 *
 * They live on their own subpath because a generated Remote face reads its
 * boundary types from a public non-root export, so a browser can import the
 * fields without importing the Host service that produces them. The scope is
 * declared self-contained rather than imported from `@deepseek-ai/dsh-gmo`, so
 * the generated face names only types this package declares; it mirrors the
 * vocabulary's `GmoScope`, and `parseGmoScope` there is what keeps a recorded
 * value in step with it.
 * @module @deepseek-ai/dsh-api-gmo-controller/types
 */

/** One GMO category a member may pick, as the control draws it. */
export interface GmoChoice {
  /** The stable reference the Session records when this one is chosen. */
  readonly categoryRef: string
  readonly displayName: string
}

/** The Session's GMO scope on the wire: off, or one category with the name the log recorded. */
export type GmoScopeWire =
  | {
    /** Format version of this record. */
    readonly version: 1
    readonly mode: 'off'
  }
  | {
    readonly version: 1
    readonly mode: 'selected'
    readonly category: {
      readonly ref: string
      /** The name as it was recorded, which is what the prompt says. */
      readonly displayName: string
    }
  }

/** What the control reads when it opens. */
export interface GmoScopeView {
  /** Every category this member may analyze right now. */
  readonly choices: readonly GmoChoice[]
  /** The Session's current choice, folded from its log. */
  readonly scope: GmoScopeWire
  /**
   * Whether the chosen category is one the authorized directory no longer
   * holds.
   *
   * Reported rather than dropped: a member whose access changed should be told
   * their choice went stale, not quietly given none.
   */
  readonly unavailable: boolean
}
