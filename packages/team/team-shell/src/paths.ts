/**
 * The addresses the Team Shell serves.
 *
 * `/team/confirm/<id>` is fixed because a Runner builds that link from a
 * transaction id it just received; the rest are ordinary pages a person
 * reaches from a bookmark or a link.
 * @module @deepseek-ai/dsh-team-shell/paths
 */

/** Sign in to the Control Plane. */
export const LOGIN_PATH = '/team/login'

/** End the current Control Plane session. */
export const LOGOUT_PATH = '/team/logout'

/**
 * The device confirmation page; the transaction id follows as a path segment.
 * No trailing slash, because that is what a prefix route matches on.
 */
export const CONFIRM_PREFIX = '/team/confirm'

/** The administrative pages, one prefix. */
export const ADMIN_PREFIX = '/team/admin'
