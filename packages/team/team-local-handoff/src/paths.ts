/**
 * The three fixed local addresses the handoff serves.
 *
 * They are fixed rather than configurable because the Control Plane's redirect
 * target is registered against them: a deployment that renamed one would break
 * every already-bound computer.
 * @module @deepseek-ai/dsh-team-local-handoff/paths
 */

/** Begins a binding: opens a transaction and shows the pairing code. */
export const START_PATH = '/team/start'

/** The daily entry: unlock, silently re-issue, or send the member to bind. */
export const OPEN_PATH = '/team/open'

/** Where the Control Plane sends the browser back with an authorization code. */
export const CALLBACK_PATH = '/team/callback'
