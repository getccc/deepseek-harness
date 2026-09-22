/**
 * The window bridge a desktop shell exposes, and reading it safely.
 *
 * The same page is served to a plain browser and to the desktop shell, and
 * only the shell defines `window.dshTeamDesktop`. Everywhere else this module
 * reports no bridge and the control never renders. This declaration mirrors
 * the shell's own `TeamDesktopUpdateApi`; `protocolVersion` is what a shell
 * older than this page trips on, so neither side has to guess.
 * @module @deepseek-ai/dsh-team-desktop-update/client/desktop-bridge
 */

/** Protocol version this browser half speaks to a shell. */
export const DESKTOP_UPDATE_PROTOCOL = 1

/**
 * Where the shell is in one update. `available` names a release it accepted,
 * `installing` runs the download, `paused` holds one the member stopped, and
 * `ready` is the moment before the application quits into the installer.
 */
export type DesktopUpdatePhase =
  | 'idle' | 'checking' | 'available' | 'installing' | 'paused' | 'ready' | 'error'

/** One state the shell published. */
export interface DesktopUpdateState {
  readonly phase: DesktopUpdatePhase
  /** The offered release, present from `available` onward. */
  readonly version?: string
  /** Whole percent of the download, present while one runs. */
  readonly percent?: number
  /** Whether this deployment refuses the installed build until it is updated. */
  readonly required?: boolean
  /** Why the last operation failed; present only with `error`. */
  readonly message?: string
}

/** What the shell lets its page do about an update. */
export interface DesktopUpdateBridge {
  readonly protocolVersion: number
  /**
   * Ask the release stream for a newer version.
   * @returns the state the check settled on.
   */
  check(): Promise<DesktopUpdateState>
  /**
   * Download the offered release and restart into it.
   * @returns nothing; the window closes when the installer takes over.
   */
  install(): Promise<void>
  /**
   * Stop the download in flight. The bytes already fetched are not kept, so
   * taking the release again starts the transfer over.
   * @returns when the download has been told to stop.
   */
  pause(): Promise<void>
  /**
   * Observe every state the shell publishes.
   * @param listener - called with each published state.
   * @returns a function that stops the subscription.
   */
  subscribe(listener: (state: DesktopUpdateState) => void): () => void
}

/**
 * The shell's bridge, when this page runs inside one that speaks this protocol.
 * @returns the bridge, or undefined in a plain browser and in an older shell.
 */
export function desktopUpdateBridge(): DesktopUpdateBridge | undefined {
  const host = globalThis as { dshTeamDesktop?: DesktopUpdateBridge }
  const bridge = host.dshTeamDesktop
  return bridge?.protocolVersion === DESKTOP_UPDATE_PROTOCOL ? bridge : undefined
}
