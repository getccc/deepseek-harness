/**
 * The Remote boundary type the `webAccess` namespace answers with, declared
 * self-contained so the generated Remote face names only a type this package
 * declares rather than following the switch into `@deepseek-ai/dsh-tool-web`,
 * whose Session-event module augmentation the analyzer must not load.
 * @module @deepseek-ai/dsh-api-web-access-controller/types
 */

/** The Session's web switch as it now stands. */
export interface WebAccessView {
  /** Whether the Session's agent is offered `web_search` and `web_fetch`. */
  readonly enabled: boolean
}
