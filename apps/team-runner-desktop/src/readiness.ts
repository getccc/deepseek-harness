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
