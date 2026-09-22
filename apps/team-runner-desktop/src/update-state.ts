/**
 * What the shell knows about its release stream, and the channels that carry
 * it to the Runner page. Shared by the main process, the preload bridge, and
 * the browser package that renders the control.
 * @module @deepseek-ai/dsh-team-runner-desktop/update-state
 */

/** Channel names of the update bridge between the shell and its page. */
export const UPDATE_IPC = {
  check: 'dsh-team-desktop:update-check',
  install: 'dsh-team-desktop:update-install',
  pause: 'dsh-team-desktop:update-pause',
  state: 'dsh-team-desktop:update-state',
} as const

/**
 * The shell's current position in one update. `available` names a release the
 * decision accepted, `paused` one whose download the member stopped, and
 * `ready` is published after the download and before the application quits to
 * install it.
 */
export interface TeamUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'installing' | 'paused' | 'ready' | 'error'
  /** The offered release, present from `available` onward. */
  readonly version?: string
  /** Whole percent of the download, present while one reports progress. */
  readonly percent?: number
  /** Whether this deployment refuses the installed build until it is updated. */
  readonly required?: boolean
  /** Why the last operation failed; present only with `error`. */
  readonly message?: string
}

/**
 * The bridge the preload script exposes as `window.dshTeamDesktop`. A page
 * served to a plain browser finds no such object and renders no control.
 */
export interface TeamDesktopUpdateApi {
  /** Rejected by the page when it does not know this bridge's calls. */
  readonly protocolVersion: 1
  /**
   * Ask the release stream for a newer version.
   * @returns the state the check settled on.
   */
  check(): Promise<TeamUpdateState>
  /**
   * Download the offered release and restart into it. The window closes when
   * the installer takes over, so this call resolves only on failure.
   * @returns nothing; the outcome arrives through the state subscription.
   */
  install(): Promise<void>
  /**
   * Stop the download in flight. What was fetched is not kept, so a later
   * install starts the transfer again.
   * @returns when the download has been told to stop.
   */
  pause(): Promise<void>
  /**
   * Observe every state the shell publishes.
   * @param listener - called with each published state.
   * @returns a function that stops the subscription.
   */
  subscribe(listener: (state: TeamUpdateState) => void): () => void
}
