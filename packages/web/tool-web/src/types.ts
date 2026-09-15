/**
 * Pure types of the per-session web switch: the one home of the `web/access`
 * event and the `webAccess` projection declarations, free of this package's
 * host-side value imports so `./client` can project them into browser
 * programs with zero duplication.
 * @module @deepseek-ai/dsh-tool-web/types
 */

/**
 * The `webAccess` projection's wire value: whether the Session's agent is
 * offered `web_search`/`web_fetch`, as the last logged `web/access` value.
 * `null` when the log records none, which is a composition whose `tool-web`
 * row declares no `sessionSwitch`; a client renders no switch for it.
 */
export interface WebAccessProjection {
  enabled: boolean | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Whether the model is offered the web tools from this point on:
     * log-only, whole-value replace, last one wins. Written by the `/web`
     * command, and once per log by a `tool-web` row mounting a
     * `sessionSwitch` when it meets an agent whose log records none, so the
     * deployment's initial value is stated by the log rather than by
     * configuration. Model-visible: the folded value decides whether the
     * `web_search`/`web_fetch` schemas and their guidance reach the request.
     */
    'web/access': { enabled: boolean }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    /** Host fold state of the web switch: the same value the wire carries. */
    webAccess: WebAccessProjection
  }
  interface SessionProjectionMap {
    /** The web switch folded from `web/access` events, `null` where no switch exists. */
    webAccess: WebAccessProjection
  }
}
