/**
 * The addresses this package serves.
 *
 * `/team/confirm/<id>` is fixed because a Runner builds that link from a
 * transaction id it just received. The console it sends an unsigned browser to
 * is named here too, so the redirect and the application agree on one address.
 * @module @deepseek-ai/dsh-team-shell/paths
 */

/**
 * The device confirmation page; the transaction id follows as a path segment.
 * No trailing slash, because that is what a prefix route matches on.
 */
export const CONFIRM_PREFIX = '/team/confirm'

/** Where a browser with no session signs in: the administration console. */
export const CONSOLE_PATH = '/team/admin/'
