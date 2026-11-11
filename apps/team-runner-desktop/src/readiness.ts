/**
 * When the Runner's answer to its entry path means the browser page can load.
 *
 * The Runner binds its port before the Team login route is mounted, and in
 * that window it answers `404` with an empty body. A shell that accepted any
 * response below `500` loaded that empty page into the window — a blank
 * white surface that nothing refreshed, because the navigation itself had
 * succeeded.
 * @module
 */

/**
 * Decide whether one HTTP status from the Runner's entry path marks it ready.
 * A navigation is answered `303` to the login page; a non-navigation probe
 * such as Node's `fetch` is answered `405` once the same route exists; an
 * already signed-in browser reaches `200`. Everything else — the pre-mount
 * `404` included — means the page must not be loaded yet.
 * @param status - the HTTP status the entry path answered.
 * @returns whether the Runner serves its entry path.
 */
export function runnerReady(status: number): boolean {
  return status === 200 || status === 303 || status === 405
}

/** Readiness announced by one owned child, independent of other local listeners. */
export class RunnerReadiness {
  private state: 'starting' | 'announced' | 'port-in-use' | 'stopped' = 'starting'

  constructor(private readonly entryUrl: string) {}

  /** Whether this child completed application startup and announced its entry URL. */
  get announced(): boolean { return this.state === 'announced' }

  /** Whether this child's listener failed because another process owns its port. */
  get portInUse(): boolean { return this.state === 'port-in-use' }

  /**
   * Read one complete line from the child's stdout or stderr.
   * @param line - a line without its trailing newline.
   */
  observe(line: string): void {
    if (this.state === 'stopped' || this.state === 'port-in-use') return
    if (line.includes('EADDRINUSE') && line.includes(new URL(this.entryUrl).host)) this.state = 'port-in-use'
    else if (line === `dsh web: ${this.entryUrl}`) this.state = 'announced'
  }

  /** End readiness when the child closes, retaining a diagnosed port conflict. */
  stop(): void {
    if (this.state !== 'port-in-use') this.state = 'stopped'
  }

  /**
   * Accept an HTTP answer only after this child announced its own startup.
   * @param status - the HTTP status from the entry URL.
   * @returns whether the shell may navigate to the listener.
   */
  ready(status: number): boolean { return this.announced && runnerReady(status) }
}

/**
 * Decide whether a loaded Runner page requires another readiness poll.
 * Request refusals retain their rendered feedback, including sign-in errors.
 * A missing route or server failure can indicate that the Runner is restarting.
 * @param status - the HTTP status of the completed local navigation.
 * @returns whether the shell should replace the page with Runner recovery.
 */
export function runnerPageNeedsRecovery(status: number): boolean {
  return status === 404 || status >= 500
}
